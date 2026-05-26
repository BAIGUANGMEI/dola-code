import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR, SESSION_FILE, SESSION_SCHEMA_VERSION } from "../constants.js";

export function sessionPathForCwd(cwd) {
  return join(cwd, CONFIG_DIR, SESSION_FILE);
}

export async function readSession(cwd) {
  const path = sessionPathForCwd(cwd);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return normalizeSession(JSON.parse(raw));
}

export async function writeSession(cwd, session) {
  const path = sessionPathForCwd(cwd);
  const now = new Date().toISOString();
  const next = normalizeSession({
    ...session,
    schemaVersion: SESSION_SCHEMA_VERSION,
    updatedAt: now,
    createdAt: session.createdAt || now
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function deleteSession(cwd) {
  const path = sessionPathForCwd(cwd);
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeSession(session = {}) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
    profile: stringOrEmpty(session.profile),
    model: stringOrEmpty(session.model),
    messages: normalizeArray(session.messages),
    memoryEntries: normalizeArray(session.memoryEntries),
    stats: session.stats && typeof session.stats === "object" ? session.stats : {},
    toolLogs: normalizeArray(session.toolLogs),
    turnLogs: normalizeArray(session.turnLogs),
    changes: normalizeArray(session.changes)
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringOrEmpty(value) {
  return value === undefined || value === null ? "" : String(value);
}
