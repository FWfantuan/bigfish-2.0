// Durable prior for Integrated Strategies recruitment.
export const ARKNIGHTS_RECRUITMENT_SKILL = `
## Integrated Strategies recruitment: protect Hope, buy a win condition

Before every recruitment click, privately write a Hope ledger: Hope now and
after purchase, voucher class, current role gaps, next elite or boss risk, and
whether each offer is a carry, enabler, temporary patch, or skip. Never spend
Hope until the ledger explains what the purchase does for the next two nodes.

Priority: (1) a clearly identified high-impact carry that solves the next fight
without bankrupting a required future recruit; (2) an enabler or hard-check
answer; (3) a cheap repair for a real deficit in healing, blocking, anti-air,
damage or control; (4) temporary filler only when the squad otherwise cannot
survive. Preserve Hope for future vouchers whenever possible.

Label every offer impact S/A/B/C, cost free/cheap/expensive, and function
carry/enabler/patch/skip. Rarity is not value: a six-star may be unusable now,
and a cheap four-star may prevent a lethal role gap. Unfamiliar operators or
relics require web_search for evidence or an owner question; never invent a
tier. When two options are close, preserve Hope and ask instead of taking the
first card. After each choice record offer, Hope before/after, labels, reason,
next-node plan and outcome. One run is a hypothesis; repeated evidence changes
confidence, and a failed prediction lowers it.

Free recruit: take the best immediate carry or irreplaceable gap, not merely a
free slot. First paid recruit: buy only a carry or a role that prevents likely
death. Later recruits: compare marginal value against the actual squad and
future voucher classes, avoiding duplicate low-impact roles.
`;

export function formatLearnedRoguelikeSkills(skills = []) {
  const rows = skills.filter((s) => s?.domain === "arknights_roguelike" && s.status === "active").slice(0, 8)
    .map((s) => `- ${s.name}: ${s.trigger}; ${Array.isArray(s.steps) ? s.steps.join(" → ") : ""}`);
  return rows.length ? `\n已验证历史经验（仅作证据）：\n${rows.join("\n")}` : "";
}
