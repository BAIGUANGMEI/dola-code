export function estimateTokensFromText(text = "") {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export function estimateMessageTokens(messages = []) {
  const serialized = messages.map((message) => {
    const copy = { ...message };
    if (copy.content && copy.content.length > 1000) {
      copy.content = `${copy.content.slice(0, 1000)}...`;
    }
    return copy;
  });
  return estimateTokensFromText(JSON.stringify(serialized));
}

export function estimateToolTokens(tools = []) {
  return estimateTokensFromText(JSON.stringify(tools));
}

export function formatUsage(usage) {
  if (!usage) return "usage unavailable";

  const prompt = usage.prompt_tokens ?? usage.input_tokens;
  const completion = usage.completion_tokens ?? usage.output_tokens;
  const total = usage.total_tokens;
  const parts = [];

  if (prompt !== undefined) parts.push(`prompt=${prompt}`);
  if (completion !== undefined) parts.push(`completion=${completion}`);
  if (total !== undefined) parts.push(`total=${total}`);
  return parts.length ? parts.join(" ") : "usage unavailable";
}

export function formatTokenCount(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
