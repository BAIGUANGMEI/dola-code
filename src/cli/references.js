import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { MAX_FILE_CHARS } from "../constants.js";
import { workspacePath } from "../tools/workspace.js";
import { truncate } from "../utils/text.js";

const REFERENCE_PATTERN = /(^|\s)@([^\s]+)/g;
const DENIED_REFERENCES = new Set([".env", ".dola-code/config.json", ".dola-code\\config.json"]);

export async function expandFileReferences({ prompt, cwd, ui }) {
  const refs = uniqueReferences(prompt);
  if (refs.length === 0) return prompt;

  const blocks = [];
  for (const ref of refs) {
    try {
      const block = await readReference({ cwd, ref });
      if (block) blocks.push(block);
    } catch (error) {
      ui.warn(`Could not read @${ref}: ${error.message}`);
      const suggestions = suggestReferences({ cwd, query: ref, limit: 6 });
      if (suggestions.length) {
        ui.info(`Did you mean: ${suggestions.map((item) => `@${item}`).join(", ")}`);
      }
    }
  }

  if (blocks.length === 0) return prompt;

  ui.info(`Attached ${blocks.length} @ reference${blocks.length === 1 ? "" : "s"} to the prompt.`);
  return `${prompt}\n\nReferenced workspace content:\n${blocks.join("\n\n")}`;
}

export function createReferenceCompleter({ cwd }) {
  return function complete(line) {
    const token = currentReferenceToken(line);
    if (!token) return [[], line];
    const suggestions = suggestReferences({ cwd, query: token.ref, limit: 30 }).map((item) => `@${item}`);
    return [suggestions.length ? suggestions : [], token.word];
  };
}

export function suggestReferences({ cwd, query = "", limit = 10 }) {
  const normalized = normalizeRef(query);
  const dirPart = normalized.includes("/") ? dirname(normalized) : ".";
  const basePart = normalized.includes("/") ? basename(normalized) : normalized;
  const dir = safeWorkspacePath(cwd, dirPart);
  if (!dir) return [];

  const direct = listDirectoryCandidates({ cwd, dir, dirPart, basePart });
  if (direct.length) return direct.slice(0, limit);

  return fuzzyReferenceCandidates({ cwd, query: normalized, limit });
}

function uniqueReferences(prompt) {
  const refs = [];
  for (const match of prompt.matchAll(REFERENCE_PATTERN)) {
    const ref = match[2].replace(/^["']|["']$/g, "");
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

async function readReference({ cwd, ref }) {
  if (DENIED_REFERENCES.has(ref)) {
    throw new Error("refusing to attach local secret/config file");
  }

  const target = workspacePath(cwd, ref);
  const info = await stat(target);
  if (info.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    const rows = entries.slice(0, 120).map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
    return `@${relative(cwd, target) || "."}\n\`\`\`text\n${rows.join("\n")}\n\`\`\``;
  }

  const content = await readFile(target, "utf8");
  return `@${relative(cwd, target)}\n\`\`\`text\n${truncate(content, MAX_FILE_CHARS)}\n\`\`\``;
}

function currentReferenceToken(line) {
  const match = String(line || "").match(/(^|\s)(@([^\s]*))$/);
  if (!match) return null;
  return {
    word: match[2],
    ref: match[3] || ""
  };
}

function listDirectoryCandidates({ cwd, dir, dirPart, basePart }) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const prefix = dirPart === "." ? "" : `${normalizeRef(dirPart)}/`;
  return entries
    .filter((entry) => entry.name.toLowerCase().startsWith(basePart.toLowerCase()))
    .map((entry) => `${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .filter((ref) => !isDeniedReference(ref))
    .sort((left, right) => left.localeCompare(right));
}

function fuzzyReferenceCandidates({ cwd, query, limit }) {
  const results = [];
  walk(cwd, "", results, 250);
  const terms = query.toLowerCase().split(/[\\/.-]/).filter(Boolean);
  return results
    .map((ref) => ({ ref, score: scoreRef(ref, query, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.ref.localeCompare(right.ref))
    .slice(0, limit)
    .map((item) => item.ref);
}

function walk(root, rel, results, max) {
  if (results.length >= max) return;
  const dir = join(root, rel);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= max) return;
    const ref = normalizeRef(join(rel, entry.name));
    if (isDeniedReference(ref)) continue;
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      results.push(`${ref}/`);
      walk(root, ref, results, max);
    } else {
      results.push(ref);
    }
  }
}

function scoreRef(ref, query, terms) {
  const value = ref.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 1;
  if (value.startsWith(needle)) return 100;
  if (value.includes(needle)) return 60;
  return terms.reduce((score, term) => score + (value.includes(term) ? 10 : 0), 0);
}

function safeWorkspacePath(cwd, ref) {
  try {
    const target = workspacePath(cwd, ref || ".");
    if (!existsSync(target) || !statSync(target).isDirectory()) return null;
    return target;
  } catch {
    return null;
  }
}

function normalizeRef(ref) {
  return String(ref || "").replace(/^["']|["']$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function isDeniedReference(ref) {
  const normalized = normalizeRef(ref).replace(/\/$/, "");
  return DENIED_REFERENCES.has(normalized) || normalized === ".env" || normalized === ".dola-code" || normalized.startsWith(".dola-code/");
}

function shouldSkipDirectory(name) {
  return [".git", ".dola-code", "node_modules", "dist", "build", "coverage", ".next", ".cache"].includes(name);
}
