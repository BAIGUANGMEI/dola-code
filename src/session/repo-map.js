import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { AUTO_CONTEXT_FILE_CHARS, AUTO_CONTEXT_MAX_CHARS } from "../constants.js";
import { truncate } from "../utils/text.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".dola-code",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "__pycache__"
]);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".css",
  ".html"
]);

export async function buildRepoMap({ cwd, maxFiles = 300, maxSymbols = 180 } = {}) {
  const files = await collectFiles({ cwd, dir: cwd, maxFiles });
  const symbols = [];

  for (const file of files) {
    if (!isSourceFile(file.path)) continue;
    try {
      const content = await readFile(join(cwd, file.path), "utf8");
      for (const symbol of extractSymbols({ path: file.path, content })) {
        symbols.push(symbol);
        if (symbols.length >= maxSymbols) break;
      }
    } catch {
      // Ignore unreadable or non-text files in the project index.
    }
    if (symbols.length >= maxSymbols) break;
  }

  return {
    createdAt: new Date().toISOString(),
    files,
    symbols,
    rendered: renderRepoMap({ files, symbols })
  };
}

export async function buildAutoContext({ cwd, prompt, memory, repoMap }) {
  const relevantFiles = await findRelevantFiles({ cwd, prompt, repoMap });
  const blocks = [];

  if (memory?.summary) {
    blocks.push(`Long-task memory:\n${memory.summary}`);
  }

  blocks.push(repoMap.rendered);

  if (relevantFiles.length) {
    blocks.push(`Relevant files selected for this task:\n${relevantFiles.map(renderRelevantFile).join("\n\n")}`);
  }

  return truncate(blocks.join("\n\n"), AUTO_CONTEXT_MAX_CHARS);
}

export async function findRelevantFiles({ cwd, prompt, repoMap, limit = 5 }) {
  const terms = extractQueryTerms(prompt);
  if (!terms.length) return [];

  const scored = repoMap.files
    .filter((file) => isSourceFile(file.path))
    .map((file) => ({
      ...file,
      score: scoreFile({ file, terms, symbols: repoMap.symbols.filter((symbol) => symbol.path === file.path) })
    }))
    .filter((file) => file.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);

  const results = [];
  for (const file of scored) {
    try {
      const content = await readFile(join(cwd, file.path), "utf8");
      results.push({
        path: file.path,
        score: file.score,
        symbols: repoMap.symbols.filter((symbol) => symbol.path === file.path).slice(0, 12),
        content: truncate(content, AUTO_CONTEXT_FILE_CHARS)
      });
    } catch {
      results.push({ path: file.path, score: file.score, symbols: [], content: "" });
    }
  }
  return results;
}

export function renderRepoMap({ files, symbols }) {
  const rows = [];
  rows.push("Repo map:");
  rows.push(...files.slice(0, 120).map((file) => `- ${file.path}${file.size ? ` (${file.size}B)` : ""}`));
  if (files.length > 120) rows.push(`- ... ${files.length - 120} more files`);

  rows.push("");
  rows.push("Symbol map:");
  if (symbols.length) {
    rows.push(...symbols.slice(0, 120).map((symbol) => `- ${symbol.name} (${symbol.kind}) ${symbol.path}:${symbol.line}`));
    if (symbols.length > 120) rows.push(`- ... ${symbols.length - 120} more symbols`);
  } else {
    rows.push("- no source symbols detected yet");
  }
  return rows.join("\n");
}

async function collectFiles({ cwd, dir, maxFiles }) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= maxFiles) break;
    if (entry.name.startsWith(".") && ![".gitignore"].includes(entry.name)) {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...await collectFiles({ cwd, dir: full, maxFiles: maxFiles - files.length }));
      continue;
    }
    const info = await stat(full);
    files.push({
      path: normalizePath(relative(cwd, full)),
      size: info.size
    });
  }
  return files.slice(0, maxFiles);
}

function extractSymbols({ path, content }) {
  const symbols = [];
  const lines = content.split(/\r?\n/);
  const ext = extname(path).toLowerCase();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const js = line.match(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*=>/);
    const py = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)|^\s*class\s+([A-Za-z_]\w*)/);
    const json = line.match(/^\s*"([^"]+)":\s*[{[]/);
    const md = line.match(/^(#{1,6})\s+(.+)$/);

    const match = ext === ".py" ? py : ext === ".json" ? json : ext === ".md" ? md : js;
    if (!match) continue;
    const name = match[1] || match[2] || match[3];
    if (!name) continue;
    symbols.push({
      name: String(name).trim(),
      kind: inferSymbolKind({ line, ext }),
      path,
      line: index + 1
    });
  }
  return symbols;
}

function inferSymbolKind({ line, ext }) {
  if (ext === ".md") return "heading";
  if (ext === ".json") return "json";
  if (/\bclass\b/.test(line)) return "class";
  if (/\bfunction\b|^\s*(?:async\s+)?def\s+/.test(line)) return "function";
  return "symbol";
}

function extractQueryTerms(prompt) {
  const lower = String(prompt || "").toLowerCase();
  const ascii = lower.match(/[a-z0-9_./-]{3,}/g) || [];
  const cjk = lower.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set([...ascii, ...cjk])]
    .filter((term) => !["the", "and", "for", "with", "this", "that", "src"].includes(term))
    .slice(0, 30);
}

function scoreFile({ file, terms, symbols }) {
  const haystack = `${file.path}\n${symbols.map((symbol) => symbol.name).join("\n")}`.toLowerCase();
  return terms.reduce((score, term) => {
    if (haystack.includes(term)) return score + (file.path.toLowerCase().includes(term) ? 4 : 2);
    const compactTerm = term.replace(/[-_/]/g, "");
    const compactHaystack = haystack.replace(/[-_/]/g, "");
    return compactTerm.length >= 4 && compactHaystack.includes(compactTerm) ? score + 1 : score;
  }, 0);
}

function renderRelevantFile(file) {
  const symbols = file.symbols.length
    ? `symbols: ${file.symbols.map((symbol) => `${symbol.name}@${symbol.line}`).join(", ")}\n`
    : "";
  return `${file.path} score=${file.score}\n${symbols}\`\`\`text\n${file.content}\n\`\`\``;
}

function isSourceFile(path) {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase());
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}
