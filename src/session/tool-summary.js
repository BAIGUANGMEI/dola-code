import { TOOL_RESULT_CONTEXT_CHARS } from "../constants.js";
import { truncate } from "../utils/text.js";

export function compressToolResultForModel({ name, result }) {
  if (!result) return "{}";

  const compact = {
    ok: result.ok !== false
  };

  if (result.cancelled) compact.cancelled = true;
  if (result.error) compact.error = result.error;
  if (result.path) compact.path = result.path;
  if (result.change_id) compact.change_id = result.change_id;
  if (result.exit_code !== undefined) compact.exit_code = result.exit_code;
  if (result.replacements !== undefined) compact.replacements = result.replacements;
  if (result.bytes !== undefined) compact.bytes = result.bytes;

  if (result.entries) {
    compact.entries = result.entries.slice(0, 80);
    compact.omitted = result.omitted || 0;
  }

  if (result.content) {
    compact.content = truncate(result.content, contentLimitForTool(name));
    if (result.total_lines !== undefined) compact.total_lines = result.total_lines;
    if (result.start_line !== undefined) compact.start_line = result.start_line;
    if (result.end_line !== undefined) compact.end_line = result.end_line;
  }

  if (result.output) compact.output = truncate(result.output, contentLimitForTool(name));
  if (result.stdout) compact.stdout = truncate(result.stdout, contentLimitForTool(name));
  if (result.stderr) compact.stderr = truncate(result.stderr, 2_000);
  if (result.diff) compact.diff = truncate(result.diff, 6_000);

  return truncate(JSON.stringify(compact), TOOL_RESULT_CONTEXT_CHARS);
}

function contentLimitForTool(name) {
  if (name === "read_file") return 8_000;
  if (name === "search_files") return 8_000;
  if (name === "run_command") return 6_000;
  return 4_000;
}
