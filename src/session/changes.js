import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { workspacePath } from "../tools/workspace.js";
import { createUnifiedDiff } from "../utils/diff.js";

export function createChangeTracker({ cwd, changes: initialChanges = [] }) {
  const changes = initialChanges.map(normalizeChange).filter(Boolean);

  return {
    async capture(pathValue) {
      return captureFile({ cwd, pathValue });
    },

    record({ toolName, args, before, after, diff }) {
      if (!before || !after) return null;
      if (sameSnapshot(before, after)) return null;

      const change = {
        id: nextChangeId(changes),
        toolName,
        action: inferAction({ toolName, before }),
        path: after.path,
        before,
        after,
        diff: diff || createUnifiedDiff({
          oldText: before.exists ? before.content : "",
          newText: after.exists ? after.content : "",
          filePath: after.path
        }),
        bytesBefore: before.exists ? Buffer.byteLength(before.content, "utf8") : 0,
        bytesAfter: after.exists ? Buffer.byteLength(after.content, "utf8") : 0,
        argsSummary: summarizeArgs(args),
        createdAt: new Date().toISOString(),
        undoneAt: null
      };
      changes.push(change);
      return publicChange(change);
    },

    list() {
      return changes.map(publicChange);
    },

    get(id) {
      const change = changes.find((item) => item.id === id);
      return change ? publicChange(change) : null;
    },

    async undo({ id = null, force = false } = {}) {
      const change = id
        ? changes.find((item) => item.id === id)
        : [...changes].reverse().find((item) => !item.undoneAt);
      if (!change) return { ok: false, error: "No tracked changes to undo." };
      if (change.undoneAt) return { ok: false, error: `Change #${change.id} is already undone.` };
      return undoChange({ cwd, change, force });
    },

    clear() {
      changes.splice(0);
    },

    snapshot() {
      return changes.map((change) => ({
        ...change,
        before: { ...change.before },
        after: { ...change.after }
      }));
    }
  };
}

async function captureFile({ cwd, pathValue }) {
  const file = workspacePath(cwd, pathValue);
  const exists = existsSync(file);
  return {
    file,
    path: relative(cwd, file) || ".",
    exists,
    content: exists ? await readFile(file, "utf8") : ""
  };
}

async function undoChange({ cwd, change, force }) {
  const current = await captureFile({ cwd, pathValue: change.path });
  if (!force && !sameSnapshot(current, change.after)) {
    return {
      ok: false,
      conflict: true,
      path: change.path,
      error: "Current file content no longer matches the tracked change. Refusing to overwrite newer edits."
    };
  }

  const target = workspacePath(cwd, change.path);
  const oldText = current.exists ? current.content : "";
  const newText = change.before.exists ? change.before.content : "";
  if (change.before.exists) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, change.before.content, "utf8");
  } else if (current.exists) {
    await unlink(target);
  }

  change.undoneAt = new Date().toISOString();
  return {
    ok: true,
    path: change.path,
    changeId: change.id,
    restored: change.before.exists ? "previous content" : "file removed",
    diff: createUnifiedDiff({ oldText, newText, filePath: change.path })
  };
}

function sameSnapshot(left, right) {
  return left.exists === right.exists && left.content === right.content;
}

function inferAction({ toolName, before }) {
  if (toolName === "write_file") return before.exists ? "overwrite" : "create";
  if (toolName === "edit_file") return "edit";
  return "change";
}

function summarizeArgs(args = {}) {
  if (args.find) {
    return {
      replace_all: Boolean(args.replace_all),
      find_chars: String(args.find).length,
      replace_chars: String(args.replace ?? "").length
    };
  }
  if (args.content !== undefined) {
    return {
      content_chars: String(args.content).length
    };
  }
  return {};
}

function publicChange(change) {
  return {
    id: change.id,
    toolName: change.toolName,
    action: change.action,
    path: change.path,
    bytesBefore: change.bytesBefore,
    bytesAfter: change.bytesAfter,
    argsSummary: change.argsSummary,
    createdAt: change.createdAt,
    undoneAt: change.undoneAt,
    diff: change.diff
  };
}

function normalizeChange(change) {
  if (!change || typeof change !== "object") return null;
  if (!change.before || !change.after) return null;
  const before = normalizeSnapshot(change.before);
  const after = normalizeSnapshot(change.after);
  return {
    id: Number.isInteger(change.id) && change.id > 0 ? change.id : 0,
    toolName: String(change.toolName || "unknown"),
    action: String(change.action || "change"),
    path: String(change.path || after.path || ""),
    before,
    after,
    diff: String(change.diff || ""),
    bytesBefore: normalizeBytes(change.bytesBefore),
    bytesAfter: normalizeBytes(change.bytesAfter),
    argsSummary: change.argsSummary && typeof change.argsSummary === "object" ? change.argsSummary : {},
    createdAt: change.createdAt || new Date().toISOString(),
    undoneAt: change.undoneAt || null
  };
}

function normalizeSnapshot(snapshot) {
  return {
    file: String(snapshot.file || ""),
    path: String(snapshot.path || ""),
    exists: Boolean(snapshot.exists),
    content: String(snapshot.content || "")
  };
}

function normalizeBytes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nextChangeId(changes) {
  return changes.reduce((max, change) => Math.max(max, change.id || 0), 0) + 1;
}
