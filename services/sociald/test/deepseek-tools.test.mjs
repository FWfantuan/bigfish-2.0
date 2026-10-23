import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  bigFishAggregateProjectionUsage,
  bigFishNormalizeTokenUsage,
  bigFishReadDeepSeekBalance,
} from "../../../patches/qq-deepseek-usage-tool.snippet.js";
import { bigFishResolveDeepSeekTipQr } from "../../../patches/qq-deepseek-tip-tool.snippet.js";

test("DeepSeek balance response is normalized without exposing the API key", async () => {
  const result = await bigFishReadDeepSeekBalance({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.authorization, "Bearer test-key");
      return {
        ok: true,
        async json() {
          return {
            is_available: true,
            balance_infos: [{
              currency: "CNY",
              total_balance: "12.34",
              granted_balance: "2.00",
              topped_up_balance: "10.34",
            }],
          };
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.currency, "CNY");
  assert.equal(result.totalBalance, "12.34");
});

test("token usage aggregates provider buckets and context pressure separately", () => {
  const usage = bigFishNormalizeTokenUsage({
    uncachedInputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
  }, {
    pressureTokens: 180,
    contextWindow: 1000000,
  });
  assert.equal(usage.totalTokens, 165);
  assert.equal(usage.contextPressureTokens, 180);
  assert.equal(usage.contextWindowTokens, 1000000);
});

test("projection usage sums persisted DSH sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bigfish-token-usage-"));
  try {
    await writeFile(join(directory, "one.json"), JSON.stringify({
      record: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 10, outputTokens: 5 } } } } },
    }));
    await writeFile(join(directory, "two.json"), JSON.stringify({
      rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 7, cacheReadTokens: 3 } } } },
    }));
    const result = await bigFishAggregateProjectionUsage(directory);
    assert.equal(result.totalTokens, 25);
    assert.equal(result.sessionCount, 2);
    assert.equal(result.sessionsWithUsage, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("support QR is resolved only from the private support directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "bigfish-support-"));
  try {
    assert.equal(await bigFishResolveDeepSeekTipQr({ root }), null);
    const support = join(root, "data", "support");
    await mkdir(support, { recursive: true });
    const qr = join(support, "deepseek-tip-qr.png");
    await writeFile(qr, Buffer.from("test-image"));
    assert.equal(await bigFishResolveDeepSeekTipQr({ root }), qr);
    assert.equal(
      await bigFishResolveDeepSeekTipQr({ root, configuredPath: "C:\\outside\\pay.png" }),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
