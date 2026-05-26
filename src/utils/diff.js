import { truncate } from "./text.js";

export function createUnifiedDiff({ oldText = "", newText = "", filePath = "file", maxChars = 12_000 }) {
  if (oldText === newText) return "";

  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const context = 3;
  const oldStart = Math.max(0, prefix - context);
  const newStart = Math.max(0, prefix - context);
  const oldEnd = Math.min(oldLines.length, oldLines.length - suffix + context);
  const newEnd = Math.min(newLines.length, newLines.length - suffix + context);
  const header = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -${oldStart + 1},${oldEnd - oldStart} +${newStart + 1},${newEnd - newStart} @@`
  ];

  const body = [];
  const beforeContextEnd = prefix;
  for (let i = oldStart; i < beforeContextEnd; i += 1) {
    body.push(` ${oldLines[i]}`);
  }
  for (let i = prefix; i < oldLines.length - suffix; i += 1) {
    body.push(`-${oldLines[i]}`);
  }
  for (let i = prefix; i < newLines.length - suffix; i += 1) {
    body.push(`+${newLines[i]}`);
  }
  for (let i = newLines.length - suffix; i < newEnd; i += 1) {
    body.push(` ${newLines[i]}`);
  }

  return truncate([...header, ...body].join("\n"), maxChars);
}
