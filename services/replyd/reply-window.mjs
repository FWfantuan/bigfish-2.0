export function inspectMessage(message, botQq) {
  const segments = Array.isArray(message.raw?.message) ? message.raw.message : [];
  const mentions = segments
    .filter((part) => part?.type === "at")
    .map((part) => String(part?.data?.qq || ""));
  const hasImage = segments.some((part) => part?.type === "image");
  const hasReply = segments.some((part) => part?.type === "reply");
  const visibleText = String(message.text || "").replace(/\[图片\]|\[表情\]/g, "").trim();
  return {
    mentions,
    atBot: mentions.includes(String(botQq)),
    atOther: mentions.some((qq) => qq && qq !== String(botQq)),
    hasImage,
    pureImage: hasImage && !visibleText,
    hasReply,
    visibleText,
  };
}

export function normalizeFollowupDecision(value) {
  if (!value || typeof value !== "object") return { shouldReply: false, content: "", reason: "" };
  return {
    shouldReply: value.should_reply === true,
    content: typeof value.content === "string" ? value.content.trim() : "",
    reason: typeof value.reason === "string" ? value.reason.trim() : "",
  };
}

export function isSimilarReply(content, previous, threshold = 0.65) {
  const normalize = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const left = normalize(content);
  const right = normalize(previous);
  if (!left || !right) return false;
  if (left === right) return true;
  let shared = 0;
  const counts = new Map();
  for (const char of right) counts.set(char, (counts.get(char) || 0) + 1);
  for (const char of left) {
    const count = counts.get(char) || 0;
    if (count > 0) {
      shared += 1;
      counts.set(char, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length) >= threshold;
}
