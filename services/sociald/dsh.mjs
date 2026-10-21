import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DSH_BIN = resolve("node_modules/@deepseek-ai/dsh/lib/bin.js");

export function parseDecisionText(text) {
  const clean = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [clean];
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(clean.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export class DshDecisionMaker {
  constructor(config) {
    this.config = config;
    const configuredBin = config.bin ? resolve(config.bin) : DSH_BIN;
    this.bin = existsSync(configuredBin) ? configuredBin : null;
  }

  async decide({ prompt, sessionId, timeoutMs, onEvent }) {
    if (!this.bin) throw new Error(`DSH entry not found: ${DSH_BIN}; run pnpm install`);
    const args = [this.bin, "--profile", this.config.profile, "--json"];
    if (sessionId) args.push("--session-id", sessionId);
    args.push(prompt);
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let finalText = "";
    let discoveredSession = "";
    let errorMessage = "";
    let finishedOnFinal = false;
    let finalTimer = null;

    const inspectLine = (line) => {
      if (!line.trim().startsWith("{")) return;
      try {
        const event = JSON.parse(line);
        if (typeof onEvent === "function") {
          void Promise.resolve(onEvent(event)).catch(() => undefined);
        }
        if (event.type === "session" && event.sessionId) discoveredSession = event.sessionId;
        if (event.type === "final" && typeof event.text === "string") {
          finalText = event.text;
          if (!finishedOnFinal) {
            finishedOnFinal = true;
            // Some tool plugins keep their process alive after the turn. The
            // terminal `final` event is the completion signal; stop after a
            // short flush instead of waiting for the full task timeout.
            finalTimer = setTimeout(() => child.kill(), 250);
          }
        }
        if (event.type === "status" && event.reason?.kind === "error") {
          errorMessage = event.reason.error?.message || "unknown DSH error";
        }
      } catch {
        // Ignore non-event and partial output.
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      stdoutBuffer += chunk;
      for (let newline = stdoutBuffer.indexOf("\n"); newline >= 0; newline = stdoutBuffer.indexOf("\n")) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        inspectLine(line);
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const code = await new Promise((resolveCode) => child.on("close", resolveCode));
    clearTimeout(timer);
    if (finalTimer) clearTimeout(finalTimer);
    if (stdoutBuffer.trim()) inspectLine(stdoutBuffer);

    if ((!finishedOnFinal && code !== 0) || errorMessage) {
      throw new Error(errorMessage || stderr.trim() || `DSH exited with ${code}`);
    }
    return { decision: parseDecisionText(finalText || stdout), raw: finalText || stdout, sessionId: discoveredSession };
  }
}

export async function loadEnvironmentFiles(paths) {
  for (const path of paths) {
    try {
      const content = await readFile(resolve(path), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]] !== undefined) continue;
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export { DSH_BIN };
