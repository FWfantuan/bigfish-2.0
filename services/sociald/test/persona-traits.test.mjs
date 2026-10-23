import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { buildPrompt } from "../prompt.mjs";

test("proactive social prompt includes slowly evolved expression traits", () => {
  const prompt = buildPrompt({
    config: {
      persona: {
        name: "大肥鱼",
        style: "灵动、嘴贫、心软",
        interests: ["游戏"],
        boundaries: ["不编造事实"],
      },
    },
    state: {
      self: { mood: "curious", focus: "看看群", desires: [] },
      groups: { "1": { memories: [], messages: [] } },
      memories: [],
      actions: [],
    },
    groupId: "1",
    brainContext: {
      self: { traits: { humor: 0.7, caution: 0.72 } },
      goals: [],
      facts: [],
      skills: [],
      reflections: [],
    },
  });
  assert.match(prompt, /humor: 0\.70/);
  assert.match(prompt, /caution: 0\.72/);
  assert.match(prompt, /只影响语气/);
});

test("core persona stays compact and keeps the Nailong trigger explicit", async () => {
  const agents = await readFile("AGENTS.md", "utf8");
  const nailongFiles = await readdir("data/memes/nailong");
  assert.ok(Buffer.byteLength(agents, "utf8") < 12_000);
  assert.match(agents, /“龙来”.*bigfish_send_meme/s);
  assert.match(agents, /arknights-gameplay-runtime/);
  assert.match(agents, /bigfish-media-and-tools/);
  assert.ok(nailongFiles.length > 0);
});
