import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BrainStore } from "./store.mjs";

const store = new BrainStore(resolve(process.env.BIGFISH_BRAIN_DB || "data/brain/brain.sqlite3"));

const memories = JSON.parse(await readFile("data/memory/livingmemory.json", "utf8"));
for (const item of memories) {
  const groupId = String(item.session_id || "").match(/GroupMessage:(\d+)/)?.[1];
  const scope = groupId ? `group:${groupId}` : "global";
  store.addFact(scope, item.text, {
    confidence: item.confidence || 0.75,
    importance: item.importance || 0.5,
    source: "legacy_livingmemory",
  });
}

const members = JSON.parse(await readFile("data/memory/member_profiles.json", "utf8"));
for (const member of members) {
  const aliases = member.aliases?.length ? `；别名：${member.aliases.join("、")}` : "";
  const characters = (member.characters || [])
    .map((item) => `${item.game}角色${item.name}（${item.server || ""} ${item.region || ""}）`)
    .join("；");
  store.addFact(`group:${member.group_id}`, `群成员${member.nickname}（QQ ${member.qq}）${aliases}${characters ? `；${characters}` : ""}`, {
    confidence: 0.95,
    importance: 0.65,
    source: "legacy_member_identity",
  });
}

try {
  const social = JSON.parse(await readFile("data/social/state.json", "utf8"));
  const scopes = ["global", ...Object.keys(social.groups || {}).map((groupId) => `group:${groupId}`)];
  for (const scope of scopes) {
    store.setSelf(scope, {
      mood: social.self?.mood,
      focus: social.self?.focus,
      desires: social.self?.desires || [],
    });
  }
  if (social.self?.focus) {
    store.createGoal("global", `持续关注：${social.self.focus}`, "由旧社交状态迁移", 3);
  }
} catch {
  // Social state is optional during a fresh install.
}

console.log(JSON.stringify({ memories: memories.length, members: members.length, contexts: store.scopesWithUnreflected().length }));
store.close();
