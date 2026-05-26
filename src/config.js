import process from "node:process";
import { resolveStoredConfig } from "./settings/store.js";

export function parseArgs(argv) {
  const args = new Set(argv);
  return {
    profile: valueAfter(argv, "--profile") || valueAfter(argv, "-p") || "",
    contextWindow: numberAfter(argv, "--context-window"),
    maxOutputTokens: numberAfter(argv, "--max-output-tokens"),
    assumeYes: args.has("--yes") || args.has("-y"),
    debug: args.has("--debug"),
    compactOutput: args.has("--compact-output") || args.has("--quiet"),
    verboseOutput: args.has("--verbose"),
    stream: !args.has("--no-stream"),
    shouldInit: args.has("--init"),
    shouldPrintHelp: args.has("--help") || args.has("-h"),
    shouldPrintVersion: args.has("--version") || args.has("-v")
  };
}

export function createConfig({ cwd = process.cwd(), argv = process.argv.slice(2) } = {}) {
  const flags = parseArgs(argv);
  const stored = resolveStoredConfig({ cwd, profileName: flags.profile });

  return {
    ...flags,
    cwd,
    ...stored,
    contextWindow: flags.contextWindow || stored.contextWindow,
    maxOutputTokens: flags.maxOutputTokens || stored.maxOutputTokens
  };
}

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return "";
  return argv[index + 1] || "";
}

function numberAfter(argv, name) {
  const raw = valueAfter(argv, name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
