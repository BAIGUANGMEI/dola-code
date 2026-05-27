import { AUTO_COMPACT_MESSAGE_LIMIT, COMPACT_KEEP_MESSAGES } from "../constants.js";
import { truncate } from "../utils/text.js";
import { estimateMessageTokens } from "../utils/tokens.js";

const ENTRY_SCHEMA_VERSION = 2;
const FACT_SCHEMA_VERSION = 1;
const DEFAULT_FACT_TTL_DAYS = 14;

export function createSessionMemory({
  maxEntries = 24,
  maxFacts = 80,
  entries: initialEntries = [],
  facts: initialFacts = []
} = {}) {
  const entries = initialEntries.slice(-maxEntries).map(normalizeEntry).filter(Boolean);
  const facts = normalizeFacts(initialFacts.length ? initialFacts : factsFromLegacyEntries(entries));

  return {
    addTurn({ prompt, turn, toolEvents = [], answer = "" }) {
      const now = new Date().toISOString();
      const entry = {
        schemaVersion: ENTRY_SCHEMA_VERSION,
        id: nextEntryId(entries),
        scope: "session",
        taskId: `turn-${nextEntryId(entries)}`,
        createdAt: now,
        lastSeenAt: now,
        prompt: summarizeText(prompt, 220),
        answer: summarizeText(answer, 360),
        tools: toolEvents.map((tool) => `${tool.name}:${tool.ok ? "ok" : "failed"}`).join(", ") || "none",
        tokens: turn?.totalTokens || 0,
        steps: turn?.steps || 0,
        sources: sourcesFromTools(toolEvents)
      };
      entries.push(entry);
      if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);

      upsertFact({
        facts,
        fact: createFact({
          scope: "session",
          kind: "turn-result",
          text: entry.answer || entry.prompt,
          source: { type: "turn", id: entry.id },
          confidence: entry.answer ? 0.72 : 0.5,
          now
        }),
        maxFacts
      });

      for (const source of entry.sources) {
        upsertFact({
          facts,
          fact: createFact({
            scope: "project",
            kind: source.kind || "tool-observation",
            text: source.text,
            source,
            confidence: source.confidence ?? 0.8,
            now
          }),
          maxFacts
        });
      }

      return entry;
    },

    get entries() {
      return entries.slice();
    },

    get facts() {
      return facts.map(publicFact);
    },

    clear() {
      entries.splice(0);
      facts.splice(0);
    },

    get summary() {
      return renderMemory({ entries, facts, budgetChars: 5_000 });
    },

    render({ budgetChars = 5_000, scope = "all" } = {}) {
      return renderMemory({ entries, facts, budgetChars, scope });
    },

    compactSummary(messages) {
      return createCompactSummary({ messages, memoryEntries: entries, facts });
    }
  };
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
  const summary = memory?.compactSummary(messages) || createCompactSummary({ messages, memoryEntries: [], facts: [] });
  messages.splice(0, messages.length, system, {
    role: "system",
    content: summary
  }, ...recent);
  return true;
}

export function createCompactSummary({ messages, memoryEntries = [], facts = [] }) {
  const compacted = messages.slice(1, -COMPACT_KEEP_MESSAGES);
  const rows = [];
  rows.push("Compact summary schema=v2");
  rows.push("Rules: facts include source, recency, confidence, and stale status. Prefer current files/tools when facts may have changed.");
  rows.push("");
  rows.push(JSON.stringify({
    schemaVersion: 2,
    compactedMessages: Math.max(0, compacted.length),
    estimatedTokensBeforeCompaction: estimateMessageTokens(messages),
    createdAt: new Date().toISOString()
  }, null, 2));

  const memory = renderMemory({ entries: memoryEntries, facts, budgetChars: 6_000 });
  if (memory) {
    rows.push("");
    rows.push(memory);
  }

  const recentFacts = compacted
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message, index) => ({
      id: `compact-${index + 1}`,
      role: message.role,
      text: summarizeText(message.content || "", 240),
      source: { type: "message", role: message.role },
      confidence: 0.45
    }));

  if (recentFacts.length) {
    rows.push("");
    rows.push("Compacted exchange facts:");
    rows.push(JSON.stringify(recentFacts, null, 2));
  }

  return truncate(rows.join("\n"), 10_000);
}

function renderMemory({ entries, facts, budgetChars, scope = "all" }) {
  const selectedFacts = rankFacts(facts, scope).slice(0, 16);
  const rows = ["Memory schema=v2"];

  if (selectedFacts.length) {
    rows.push("Facts:");
    for (const fact of selectedFacts) {
      rows.push(`- id=${fact.id} scope=${fact.scope} kind=${fact.kind} confidence=${fact.confidence.toFixed(2)} stale=${String(isFactStale(fact))}`);
      rows.push(`  source=${formatSource(fact.source)} lastSeen=${fact.lastSeenAt}`);
      rows.push(`  text=${fact.text}`);
    }
  }

  const selectedEntries = entries.slice(-8);
  if (selectedEntries.length) {
    rows.push("");
    rows.push("Recent task entries:");
    for (const entry of selectedEntries) {
      rows.push(`- #${entry.id} scope=${entry.scope} task=${entry.taskId} steps=${entry.steps} tokens=${entry.tokens} tools=${entry.tools}`);
      rows.push(`  task=${entry.prompt}`);
      if (entry.answer) rows.push(`  result=${entry.answer}`);
    }
  }

  return truncate(rows.join("\n"), budgetChars);
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const now = new Date().toISOString();
  return {
    schemaVersion: entry.schemaVersion || 1,
    id: Number.isInteger(entry.id) ? entry.id : 0,
    scope: entry.scope || "session",
    taskId: entry.taskId || `turn-${entry.id || 0}`,
    createdAt: entry.createdAt || now,
    lastSeenAt: entry.lastSeenAt || entry.createdAt || now,
    prompt: summarizeText(entry.prompt, 220),
    answer: summarizeText(entry.answer, 360),
    tools: String(entry.tools || "none"),
    tokens: Number.isFinite(Number(entry.tokens)) ? Number(entry.tokens) : 0,
    steps: Number.isFinite(Number(entry.steps)) ? Number(entry.steps) : 0,
    sources: Array.isArray(entry.sources) ? entry.sources : []
  };
}

function createFact({ scope, kind, text, source, confidence, now }) {
  const normalizedSource = normalizeSource(source);
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    id: factId({ kind, text, source: normalizedSource }),
    scope,
    kind,
    text: summarizeText(text, 500),
    source: normalizedSource,
    confidence: clampConfidence(confidence),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: expiresAt(now),
    stale: false
  };
}

function upsertFact({ facts, fact, maxFacts }) {
  if (!fact.text) return;
  const existing = facts.find((item) => item.id === fact.id);
  if (existing) {
    existing.text = fact.text;
    existing.confidence = Math.max(existing.confidence, fact.confidence);
    existing.lastSeenAt = fact.lastSeenAt;
    existing.expiresAt = fact.expiresAt;
    existing.stale = false;
    return;
  }
  facts.push(fact);
  if (facts.length > maxFacts) {
    facts.sort((left, right) => factRank(right) - factRank(left));
    facts.splice(maxFacts);
  }
}

function normalizeFacts(facts) {
  return facts.map(normalizeFact).filter(Boolean);
}

function normalizeFact(fact) {
  if (!fact || typeof fact !== "object") return null;
  const now = new Date().toISOString();
  return {
    schemaVersion: fact.schemaVersion || FACT_SCHEMA_VERSION,
    id: fact.id || factId({ kind: fact.kind, text: fact.text, source: fact.source }),
    scope: fact.scope || "session",
    kind: fact.kind || "note",
    text: summarizeText(fact.text, 500),
    source: normalizeSource(fact.source),
    confidence: clampConfidence(fact.confidence ?? 0.5),
    createdAt: fact.createdAt || now,
    lastSeenAt: fact.lastSeenAt || fact.createdAt || now,
    expiresAt: fact.expiresAt || expiresAt(fact.createdAt || now),
    stale: Boolean(fact.stale) || isExpired(fact.expiresAt)
  };
}

function factsFromLegacyEntries(entries) {
  return entries
    .filter((entry) => entry.answer || entry.prompt)
    .map((entry) => createFact({
      scope: entry.scope || "session",
      kind: "legacy-turn",
      text: entry.answer || entry.prompt,
      source: { type: "turn", id: entry.id },
      confidence: entry.answer ? 0.55 : 0.35,
      now: entry.lastSeenAt || entry.createdAt || new Date().toISOString()
    }));
}

function sourcesFromTools(toolEvents) {
  const sources = [];
  for (const tool of toolEvents) {
    const result = tool.result || {};
    const args = tool.args || {};
    if (result.path || args.path) {
      sources.push({
        type: "tool",
        id: tool.id,
        tool: tool.name,
        path: result.path || args.path,
        kind: tool.name === "read_file" ? "file-observation" : "file-change",
        confidence: tool.ok ? 0.85 : 0.4,
        text: summarizeToolObservation(tool)
      });
    } else if (tool.name === "run_command") {
      sources.push({
        type: "tool",
        id: tool.id,
        tool: tool.name,
        kind: "command-observation",
        confidence: tool.ok ? 0.75 : 0.45,
        text: summarizeToolObservation(tool)
      });
    }
  }
  return sources.filter((source) => source.text);
}

function summarizeToolObservation(tool) {
  const result = tool.result || {};
  if (result.path) return `${tool.name} ${tool.ok ? "succeeded" : "failed"} on ${result.path}`;
  if (tool.args?.path) return `${tool.name} ${tool.ok ? "succeeded" : "failed"} on ${tool.args.path}`;
  if (result.exit_code !== undefined) return `command exit=${result.exit_code} ${summarizeText(result.stdout || result.stderr || result.error || "", 220)}`;
  if (result.error) return `${tool.name} failed: ${result.error}`;
  return `${tool.name} ${tool.ok ? "succeeded" : "failed"}`;
}

function rankFacts(facts, scope) {
  return facts
    .filter((fact) => scope === "all" || fact.scope === scope)
    .map((fact) => ({ ...fact, stale: isFactStale(fact) }))
    .sort((left, right) => factRank(right) - factRank(left));
}

function factRank(fact) {
  const stalePenalty = isFactStale(fact) ? 0.35 : 1;
  return fact.confidence * stalePenalty + recencyScore(fact.lastSeenAt);
}

function recencyScore(iso) {
  const ageMs = Date.now() - Date.parse(iso || 0);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.2;
  const ageDays = ageMs / 86_400_000;
  return Math.max(0, 0.25 - ageDays * 0.02);
}

function isFactStale(fact) {
  return Boolean(fact.stale) || isExpired(fact.expiresAt);
}

function isExpired(expiresAtValue) {
  return expiresAtValue ? Date.parse(expiresAtValue) < Date.now() : false;
}

function expiresAt(now) {
  return new Date(Date.parse(now) + DEFAULT_FACT_TTL_DAYS * 86_400_000).toISOString();
}

function normalizeSource(source = {}) {
  if (!source || typeof source !== "object") return { type: "unknown" };
  return {
    type: source.type || "unknown",
    id: source.id,
    tool: source.tool,
    path: source.path
  };
}

function formatSource(source) {
  const parts = [source.type || "unknown"];
  if (source.id !== undefined) parts.push(`#${source.id}`);
  if (source.tool) parts.push(source.tool);
  if (source.path) parts.push(source.path);
  return parts.join(":");
}

function publicFact(fact) {
  return {
    ...fact,
    stale: isFactStale(fact)
  };
}

function factId({ kind, text, source }) {
  const raw = `${kind || "fact"}:${source?.type || ""}:${source?.id || ""}:${source?.path || ""}:${summarizeText(text, 80)}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return `fact-${Math.abs(hash)}`;
}

function nextEntryId(entries) {
  return entries.reduce((max, entry) => Math.max(max, entry.id || 0), 0) + 1;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}

function summarizeText(text, limit) {
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), limit).replace(/\n/g, " ");
}
