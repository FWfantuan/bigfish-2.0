import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const EMPTY_STATE = {
  version: 1,
  self: {
    mood: "curious",
    focus: "看看群里发生了什么，再决定是否开口",
    desires: [],
    lastThought: "",
    updatedAt: null,
  },
  memories: [],
  actions: [],
  groups: {},
};

export class SocialState {
  constructor(path = "data/social/state.json") {
    this.path = resolve(path);
    this.value = structuredClone(EMPTY_STATE);
  }

  async load() {
    try {
      this.value = { ...structuredClone(EMPTY_STATE), ...JSON.parse(await readFile(this.path, "utf8")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }
    return this.value;
  }

  group(groupId) {
    const id = String(groupId);
    this.value.groups[id] ||= {
      messages: [],
      memories: [],
      sessionId: null,
      lastMessageAt: 0,
      lastEvaluatedAt: 0,
      lastActionAt: 0,
      nextCheckAt: 0,
    };
    return this.value.groups[id];
  }

  appendMessage(groupId, message) {
    const group = this.group(groupId);
    group.messages.push(message);
    group.messages = group.messages.slice(-120);
    group.lastMessageAt = message.at;
  }

  appendAction(action) {
    this.value.actions.push(action);
    this.value.actions = this.value.actions.slice(-200);
    if (action.groupId) this.group(action.groupId).lastActionAt = action.at;
  }

  remember(scope, content) {
    const item = { scope: String(scope), content: String(content).slice(0, 1200), at: new Date().toISOString() };
    if (scope.startsWith("group:")) {
      const group = this.group(scope.slice(6));
      group.memories.push(item);
      group.memories = group.memories.slice(-80);
    } else {
      this.value.memories.push(item);
      this.value.memories = this.value.memories.slice(-120);
    }
  }

  updateSelf(update) {
    if (!update || typeof update !== "object") return;
    if (typeof update.mood === "string" && update.mood.trim()) this.value.self.mood = update.mood.trim().slice(0, 300);
    if (typeof update.focus === "string" && update.focus.trim()) this.value.self.focus = update.focus.trim().slice(0, 300);
    if (typeof update.desire === "string" && update.desire.trim()) {
      this.value.self.desires = [update.desire.trim().slice(0, 300)];
    }
    this.value.self.updatedAt = new Date().toISOString();
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.value, null, 2)}\n`, "utf8");
    await rename(tmp, this.path);
  }
}
