import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import process from "node:process";
import { MAX_FILE_CHARS } from "../constants.js";
import { createUnifiedDiff } from "../utils/diff.js";
import { truncate } from "../utils/text.js";

export function workspacePath(cwd, pathValue = ".") {
  const target = isAbsolute(pathValue) ? resolve(pathValue) : resolve(cwd, pathValue);
  const rel = relative(cwd, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return target;
  throw new Error(`Path escapes workspace: ${pathValue}`);
}

export async function listFiles({ cwd, params }) {
  const dir = workspacePath(cwd, params.path || ".");
  const entries = await readdir(dir, { withFileTypes: true });
  const maxEntries = Math.min(Number(params.max_entries || 100), 500);
  const rows = [];

  for (const entry of entries.slice(0, maxEntries)) {
    const full = join(dir, entry.name);
    const info = await stat(full);
    rows.push({
      name: entry.name + (entry.isDirectory() ? "/" : ""),
      type: entry.isDirectory() ? "directory" : "file",
      size: info.size,
      modified: info.mtime.toISOString()
    });
  }

  return {
    path: relative(cwd, dir) || ".",
    entries: rows,
    omitted: Math.max(0, entries.length - rows.length)
  };
}

export async function readTextFile({ cwd, params }) {
  const file = workspacePath(cwd, params.path);
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, Number(params.start_line || 1));
  const end = Math.min(lines.length, Number(params.end_line || lines.length));
  const selected = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");

  return {
    path: relative(cwd, file),
    start_line: start,
    end_line: end,
    total_lines: lines.length,
    content: truncate(selected, MAX_FILE_CHARS)
  };
}

export async function searchFiles({ cwd, params }) {
  const searchPath = workspacePath(cwd, params.path || ".");
  const rgArgs = ["--line-number", "--color", "never"];
  if (params.glob) rgArgs.push("--glob", params.glob);
  rgArgs.push("--", params.query, searchPath);

  return new Promise((resolvePromise) => {
    execFile("rg", rgArgs, { cwd, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error && error.code !== 1) {
        resolvePromise({ ok: false, error: error.message, stderr: truncate(stderr) });
        return;
      }
      resolvePromise({ ok: true, output: truncate(stdout || "No matches.") });
    });
  });
}

export async function writeTextFile({ cwd, params, confirm }) {
  const file = workspacePath(cwd, params.path);
  const action = existsSync(file) ? "overwrite" : "create";
  const original = existsSync(file) ? await readFile(file, "utf8") : "";
  const diff = createUnifiedDiff({
    oldText: original,
    newText: params.content,
    filePath: relative(cwd, file)
  });
  const approved = await confirm(`Allow ${action} ${relative(cwd, file)}?`);
  if (!approved) return { ok: false, cancelled: true };

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, params.content, "utf8");
  return { ok: true, path: relative(cwd, file), bytes: Buffer.byteLength(params.content, "utf8"), diff };
}

export async function editTextFile({ cwd, params, confirm }) {
  const file = workspacePath(cwd, params.path);
  const original = await readFile(file, "utf8");
  const occurrences = original.split(params.find).length - 1;
  if (occurrences === 0) throw new Error("Find text was not found.");
  if (!params.replace_all && occurrences > 1) {
    throw new Error(`Find text occurs ${occurrences} times. Set replace_all=true or use a more specific fragment.`);
  }

  const approved = await confirm(`Allow edit ${relative(cwd, file)} (${occurrences} replacement${occurrences === 1 ? "" : "s"})?`);
  if (!approved) return { ok: false, cancelled: true };

  const updated = params.replace_all ? original.split(params.find).join(params.replace) : original.replace(params.find, params.replace);
  const diff = createUnifiedDiff({
    oldText: original,
    newText: updated,
    filePath: relative(cwd, file)
  });
  await writeFile(file, updated, "utf8");
  return { ok: true, path: relative(cwd, file), replacements: params.replace_all ? occurrences : 1, diff };
}

export async function runShellCommand({ cwd, params, confirm }) {
  const command = params.command;
  const approved = await confirm(`Allow shell command: ${command}?`);
  if (!approved) return { ok: false, cancelled: true };

  const timeout = Math.min(Number(params.timeout_ms || 120_000), 600_000);
  return new Promise((resolvePromise) => {
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-Command", command]
      : ["-lc", command];

    execFile(shell, shellArgs, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolvePromise({
        ok: !error,
        exit_code: error?.code ?? 0,
        error: error?.message,
        stdout: truncate(stdout),
        stderr: truncate(stderr)
      });
    });
  });
}
