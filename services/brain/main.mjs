import { createServer } from "node:http";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../sociald/config.mjs";
import { loadEnvironmentFiles } from "../sociald/dsh.mjs";
import { BrainConsolidator } from "./consolidator.mjs";
import { BrainStore } from "./store.mjs";

await loadEnvironmentFiles([".env", resolve(homedir(), ".dsh/.env")]);
const config = await loadConfig(process.env.BIGFISH_SOCIAL_CONFIG || "config/social.json");
const host = process.env.BIGFISH_BRAIN_HOST || "127.0.0.1";
const port = Number(process.env.BIGFISH_BRAIN_PORT || 15621);
const token = process.env.BIGFISH_BRAIN_TOKEN || "";
const store = new BrainStore(resolve(process.env.BIGFISH_BRAIN_DB || "data/brain/brain.sqlite3"));
const consolidator = new BrainConsolidator(store, config, {
  minimumEvents: Number(process.env.BIGFISH_BRAIN_MIN_EVENTS || 4),
});
const actionTimers = new Map();

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/health") return send(response, 200, { status: "ok", scopes: store.scopesWithUnreflected() });
    if (token && request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: "unauthorized" });
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/v1/context") {
      return send(response, 200, store.context(requiredScope(url), url.searchParams.get("q") || ""));
    }
    if (request.method === "PUT" && url.pathname === "/v1/self") {
      const body = await readJson(request);
      return send(response, 200, store.setSelf(String(body.scope), body));
    }
    if (request.method === "POST" && url.pathname === "/v1/events") {
      const body = await readJson(request);
      return send(response, 201, store.addEvent(String(body.scope), body.kind, body.content, body.success !== false));
    }
    if (request.method === "POST" && url.pathname === "/v1/actions") {
      const body = await readJson(request);
      const action = store.addAction(
        String(body.scope), body.kind, body.payload || {}, body.result || "", body.success !== false, body.goalId || null,
      );
      scheduleActionReflection(String(body.scope));
      return send(response, 201, action);
    }
    if (request.method === "POST" && url.pathname === "/v1/facts") {
      const body = await readJson(request);
      return send(response, 201, store.addFact(String(body.scope), body.text, body));
    }
    if (request.method === "POST" && url.pathname === "/v1/facts/replace") {
      const body = await readJson(request);
      return send(response, 200, store.replaceFacts(
        String(body.scope),
        String(body.source),
        Array.isArray(body.facts) ? body.facts : [],
      ));
    }
    if (request.method === "GET" && url.pathname === "/v1/goals") {
      return send(response, 200, store.goals(requiredScope(url), url.searchParams.get("status") ?? "active"));
    }
    if (request.method === "POST" && url.pathname === "/v1/goals") {
      const body = await readJson(request);
      return send(response, 201, store.upsertGoal(String(body.scope), {
        ...body,
        priority: Number(body.priority || 3),
        dueAt: body.dueAt || null,
      }));
    }
    if (request.method === "POST" && url.pathname === "/v1/goals/dedupe") {
      const scopes = url.searchParams.get("scope")
        ? [url.searchParams.get("scope")]
        : store.allGoalScopes();
      return send(response, 200, { results: scopes.map((scope) => store.deduplicateGoals(scope)) });
    }
    if (request.method === "PATCH" && url.pathname.startsWith("/v1/goals/")) {
      const body = await readJson(request);
      const item = store.updateGoal(url.pathname.slice("/v1/goals/".length), body);
      return send(response, item ? 200 : 404, item || { error: "not found" });
    }
    if (request.method === "GET" && url.pathname === "/v1/skills") {
      return send(response, 200, store.skills(requiredScope(url), url.searchParams.get("all") !== "1"));
    }
    if (request.method === "POST" && url.pathname === "/v1/approvals") {
      const body = await readJson(request);
      return send(response, 201, store.createApproval(String(body.scope), body.action, body.reason, body.payload || {}));
    }
    if (request.method === "GET" && url.pathname === "/v1/approvals") {
      return send(response, 200, store.approvals(requiredScope(url), url.searchParams.get("status") ?? "pending"));
    }
    if (request.method === "PATCH" && url.pathname.startsWith("/v1/approvals/")) {
      const body = await readJson(request);
      const item = store.decideApproval(url.pathname.slice("/v1/approvals/".length), body.approved === true);
      return send(response, item ? 200 : 404, item || { error: "not found" });
    }
    if (request.method === "POST" && url.pathname === "/v1/consolidate") {
      return send(response, 200, { results: await consolidator.consolidateAll(true) });
    }
    if (request.method === "POST" && url.pathname === "/v1/relations/backfill") {
      const body = await readJson(request);
      const scopes = body.scope ? [String(body.scope)] : store.memoryScopes();
      const results = [];
      for (const scope of scopes) {
        try {
          results.push(await consolidator.backfillRelations(scope));
        } catch (error) {
          results.push({ scope, error: error.message });
        }
      }
      return send(response, 200, { results });
    }
    return send(response, 404, { error: "not found" });
  } catch (error) {
    return send(response, 500, { error: error.message });
  }
});

const interval = setInterval(() => {
  void consolidator.consolidateAll().then((results) => {
    if (results.length) console.log(`[brain] consolidated ${results.length} scope(s)`);
  }).catch((error) => console.warn(`[brain] consolidation failed: ${error.message}`));
}, Number(process.env.BIGFISH_BRAIN_INTERVAL_MS || 300000));
interval.unref();

server.listen(port, host, () => console.log(`[brain] listening on http://${host}:${port}`));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function shutdown() {
  clearInterval(interval);
  for (const timer of actionTimers.values()) clearTimeout(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

function scheduleActionReflection(scope) {
  const previous = actionTimers.get(scope);
  if (previous) clearTimeout(previous);
  actionTimers.set(scope, setTimeout(() => {
    actionTimers.delete(scope);
    void consolidator.consolidateScope(scope, true)
      .catch((error) => console.warn(`[brain] action reflection failed: ${error.message}`));
  }, Number(process.env.BIGFISH_BRAIN_ACTION_REFLECT_DELAY_MS || 15000)));
}

function requiredScope(url) {
  const scope = url.searchParams.get("scope");
  if (!scope) throw new Error("scope is required");
  return scope;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request too large");
  }
  return body ? JSON.parse(body) : {};
}

function send(response, status, value) {
  const data = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  response.end(data);
}
