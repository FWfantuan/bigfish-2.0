import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const dshHome = process.env.DSH_HOME || resolve(homedir(), ".dsh");
const qqPlugin = resolve(
  dshHome,
  "profiles/bigfish017/node_modules/@yachangchang/dsh-qq-bridge/dist/plugin.js",
);
const qqSecurity = resolve(
  dshHome,
  "profiles/bigfish017/node_modules/@yachangchang/dsh-qq-bridge/dist/security.js",
);
const browserPlugins = ["bigfish017", "bigfish-worker"].map((profile) =>
  resolve(dshHome, `profiles/${profile}/node_modules/@yeesy369/dsh-browser-playwright/lib/index.js`),
);

async function patch(path, marker, replace) {
  const source = await readFile(path, "utf8");
  if (source.includes(marker)) {
    console.log(`already patched: ${path}`);
    return;
  }
  const next = replace(source);
  if (next === source) throw new Error(`patch target not found: ${path}`);
  await writeFile(path, next, "utf8");
  console.log(`patched: ${path}`);
}

await patch(
  qqPlugin,
  "Apply the base entry once so a profile patch can start the",
  (source) =>
    source.replace(
      "    const settings = await installQqBridgeSettings(ctx, entry, (next) => runtime.reconcile(next));\n    if (settings === undefined)",
      [
        "    const settings = await installQqBridgeSettings(ctx, entry, (next) => runtime.reconcile(next));",
        "    // Apply the base entry once so a profile patch can start the bridge",
        "    // without opening the Web UI on DSH 0.1.7.",
        "    await runtime.reconcile(entry);",
        "    if (settings === undefined)",
      ].join("\n"),
    ),
);

await patch(
  qqSecurity,
  "BIGFISH_ALLOWED_GROUPS",
  (source) =>
    source.replace(
      [
        "    allow(evt) {",
        "        if (this.opts.mode === 'open')",
        "            return true;",
        "        const adminId = this.opts.adminId ?? this.opts.adminQq;",
        "        return evt.user_id === adminId || this.opts.allowlist.includes(evt.user_id);",
        "    }",
      ].join("\n"),
      [
        "    allow(evt) {",
        "        const adminId = this.opts.adminId ?? this.opts.adminQq;",
        "        if (evt.message_type === 'private')",
        "            return evt.user_id === adminId;",
        "        if (evt.message_type === 'group') {",
        "            const groupAllowlist = String(process.env.BIGFISH_ALLOWED_GROUPS ?? '')",
        "                .split(',')",
        "                .map((value) => value.trim())",
        "                .filter(Boolean);",
        "            if (groupAllowlist.length > 0 && !groupAllowlist.includes(String(evt.group_id)))",
        "                return false;",
        "            const botQq = String(process.env.BIGFISH_BOT_QQ ?? '');",
        "            const segments = Array.isArray(evt.message) ? evt.message : [];",
        "            const addressed = (botQq && segments.some((part) => part?.type === 'at'",
        "                && String(part?.data?.qq) === botQq))",
        "                || (botQq && String(evt.raw_message ?? '').includes(`[CQ:at,qq=${botQq}]`));",
        "            if (!addressed)",
        "                return false;",
        "        }",
        "        if (this.opts.mode === 'open')",
        "            return true;",
        "        return evt.user_id === adminId || this.opts.allowlist.includes(evt.user_id);",
        "    }",
      ].join("\n"),
    ),
);

for (const browserPlugin of browserPlugins) {
  await patch(
    browserPlugin,
    "typeof settings?.register !== 'function'",
    (source) =>
      source.replace(
        "export function apply(ctx, config) {\n    const settings = ctx.get('settings');\n    const scope = settings.register(name, Config, {",
        [
          "export function apply(ctx, config) {",
          "    const settings = ctx.get('settings');",
          "    // DSH profiles expose a minimal settings context without register().",
          "    if (typeof settings?.register !== 'function') {",
          "        ctx.plugin(PlaywrightBrowserRuntime, config);",
          "        return;",
          "    }",
          "    const scope = settings.register(name, Config, {",
        ].join("\n"),
      ),
  );
}
