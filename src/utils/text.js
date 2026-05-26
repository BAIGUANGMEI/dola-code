import { MAX_TOOL_OUTPUT } from "../constants.js";

export function truncate(value, limit = MAX_TOOL_OUTPUT) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated ${text.length - limit} chars]`;
}

export function maskSecret(value) {
  if (!value) return "missing";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}
