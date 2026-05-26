import { AUTO_COMPACT_MESSAGE_LIMIT, COMPACT_KEEP_MESSAGES } from "../constants.js";
import { truncate } from "../utils/text.js";
import { estimateMessageTokens } from "../utils/tokens.js";

export function createSessionMemory({ maxEntries = 24, entries: initialEntries = [] } = {}) {
  const entries = initialEntries.slice(-maxEntries).map(normalizeEntry).filter(Boolean);

  return {
    addTurn({ prompt, turn, toolEvents = [], answer = "" }) {
      const entry = {
        id: nextEntryId(entries),
        createdAt: new Date().toISOString(),
        prompt: summarizeText(prompt, 220),
        answer: summarizeText(answer, 360),
        tools: toolEvents.map((tool) => `${tool.name}:${tool.ok ? "ok" : "failed"}`).join(", ") || "none",
        tokens: turn?.totalTokens || 0,
        steps: turn?.steps || 0
      };
      entries.push(entry);
      if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
      return entry;
    },

    get entries() {
      return entries.slice();
    },

    clear() {
      entries.splice(0);
    },

    get summary() {
      return renderMemory(entries);
    },

    compactSummary(messages) {
      return createCompactSummary({ messages, memoryEntries: entries });
    }
  };
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return {
    id: Number.isInteger(entry.id) ? entry.id : 0,
    createdAt: entry.createdAt || new Date().toISOString(),
    prompt: summarizeText(entry.prompt, 220),
    answer: summarizeText(entry.answer, 360),
    tools: String(entry.tools || "none"),
    tokens: Number.isFinite(Number(entry.tokens)) ? Number(entry.tokens) : 0,
    steps: Number.isFinite(Number(entry.steps)) ? Number(entry.steps) : 0
  };
}

function nextEntryId(entries) {
  return entries.reduce((max, entry) => Math.max(max, entry.id || 0), 0) + 1;
}

export function maybeAutoCompact({ messages, memory, ui, contextWindow = 0 }) {
  const overMessageLimit = messages.length > AUTO_COMPACT_MESSAGE_LIMIT;
  const overTokenLimit = contextWindow > 0 && estimateMessageTokens(messages) > Math.floor(contextWindow * 0.75);
  if (!overMessageLimit && !overTokenLimit) return false;
  compactMessagesWithSummary({ messages, memory });
  ui?.info?.(`Auto compacted conversation to ${messages.length} messages with a generated summary.`);
  return true;
}

export function compactMessagesWithSummary({ messages, memory }) {
  if (messages.length <= COMPACT_KEEP_MESSAGES + 1) return false;

  const system = messages[0];
  const recent = messages.slice(-COMPACT_KEEP_MESSAGES);
  const summary = memory?.compactSummary(messages) || createCompactSummary({ messages, memoryEntries: [] });
  messages.splice(0, messages.length, system, {
    role: "system",
    content: summary
  }, ...recent);
  return true;
}

export function createCompactSummary({ messages, memoryEntries = [] }) {
  const compacted = messages.slice(1, -COMPACT_KEEP_MESSAGES);
  const rows = [];
  rows.push("Compact summary of earlier conversation. Use this as durable context, but prefer current files/tools when facts may have changed.");
  rows.push("");
  rows.push(`Earlier messages compacted: ${Math.max(0, compacted.length)}`);
  rows.push(`Estimated tokens before compaction: ${estimateMessageTokens(messages)}`);

  const memory = renderMemory(memoryEntries);
  if (memory) {
    rows.push("");
    rows.push(memory);
  }

  const recentFacts = compacted
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => `- ${message.role}: ${summarizeText(message.content || "", 240)}`);

  if (recentFacts.length) {
    rows.push("");
    rows.push("Recent compacted exchange highlights:");
    rows.push(...recentFacts);
  }

  return truncate(rows.join("\n"), 8_000);
}

function renderMemory(entries) {
  if (!entries.length) return "";
  const rows = ["Stage memory:"];
  for (const entry of entries.slice(-10)) {
    rows.push(`- #${entry.id} steps=${entry.steps} tokens=${entry.tokens} tools=${entry.tools}`);
    rows.push(`  task: ${entry.prompt}`);
    if (entry.answer) rows.push(`  result: ${entry.answer}`);
  }
  return rows.join("\n");
}

function summarizeText(text, limit) {
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), limit).replace(/\n/g, " ");
}
