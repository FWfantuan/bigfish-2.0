import assert from "node:assert/strict";
import test from "node:test";
import { parseDecisionText } from "../dsh.mjs";

test("parses JSON wrapped in markdown fences", () => {
  const parsed = parseDecisionText('```json\n{"action":"wait","reason":"还没有合适机会"}\n```');
  assert.equal(parsed.action, "wait");
});

test("extracts JSON from incidental prose", () => {
  const parsed = parseDecisionText('决定如下：{"action":"private_message","target_qq":"1"}');
  assert.equal(parsed.target_qq, "1");
});
