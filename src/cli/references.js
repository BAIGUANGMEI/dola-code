import { readFile, readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
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
    }
  }

  if (blocks.length === 0) return prompt;

  ui.info(`Attached ${blocks.length} @ reference${blocks.length === 1 ? "" : "s"} to the prompt.`);
  return `${prompt}\n\nReferenced workspace content:\n${blocks.join("\n\n")}`;
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
