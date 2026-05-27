export function createMarkdownStreamRenderer({ write, paint }) {
  let buffer = "";
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines = [];

  return {
    write(chunk) {
      buffer += String(chunk ?? "");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const rendered = renderLine(line);
        if (rendered !== null) write(`${rendered}\n`);
      }
    },

    flush() {
      if (buffer) {
        const rendered = renderLine(buffer);
        if (rendered !== null) write(rendered);
        buffer = "";
      }
      if (inCodeBlock) write(renderCodeBlock(codeLines, codeLanguage, paint));
    }
  };

  function renderLine(line) {
    const fence = line.match(/^\s*```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = fence[1] || "";
        codeLines = [];
        return "";
      }
      const rendered = renderCodeBlock(codeLines, codeLanguage, paint);
      inCodeBlock = false;
      codeLanguage = "";
      codeLines = [];
      return rendered;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return null;
    }
    return renderMarkdownLine(line, paint);
  }
}

export function renderMarkdown(text, { paint }) {
  let output = "";
  const renderer = createMarkdownStreamRenderer({
    paint,
    write(value) {
      output += value;
    }
  });
  renderer.write(text);
  renderer.flush();
  return output;
}

function renderMarkdownLine(line, paint) {
  if (!line.trim()) return "";

  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    const prefix = level <= 2 ? "" : `${" ".repeat(level - 2)}`;
    return `${prefix}${paint(level <= 2 ? "bold" : "cyan", renderInline(heading[2], paint))}`;
  }

  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return paint("dim", "-".repeat(Math.min(process.stdout.columns || 80, 96)));
  }

  const quote = line.match(/^(\s*)>\s?(.*)$/);
  if (quote) {
    return `${quote[1]}${paint("dim", "|")} ${paint("dim", renderInline(quote[2], paint))}`;
  }

  const task = line.match(/^(\s*)[-*+]\s+\[([ xX])]\s+(.+)$/);
  if (task) {
    const box = task[2].trim() ? "[x]" : "[ ]";
    return `${task[1]}${paint("cyan", box)} ${renderInline(task[3], paint)}`;
  }

  const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (unordered) {
    return `${unordered[1]}${paint("cyan", "-")} ${renderInline(unordered[2], paint)}`;
  }

  const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
  if (ordered) {
    return `${ordered[1]}${paint("cyan", "1.")} ${renderInline(ordered[2], paint)}`;
  }

  if (looksLikeTableSeparator(line)) return paint("dim", line);
  if (looksLikeTableRow(line)) return renderTableRow(line, paint);

  return renderInline(line, paint);
}

function renderInline(text, paint) {
  const spans = [];
  let index = 0;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+]\([^)]+\))/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) spans.push(text.slice(index, match.index));
    spans.push(renderInlineToken(match[0], paint));
    index = match.index + match[0].length;
  }
  if (index < text.length) spans.push(text.slice(index));
  return spans.join("");
}

function renderInlineToken(token, paint) {
  if (token.startsWith("`")) return paint("cyan", token.slice(1, -1));
  if (token.startsWith("**") || token.startsWith("__")) return paint("bold", token.slice(2, -2));
  if (token.startsWith("*") || token.startsWith("_")) return paint("dim", token.slice(1, -1));

  const link = token.match(/^\[([^\]]+)]\(([^)]+)\)$/);
  if (link) return `${paint("cyan", link[1])} ${paint("dim", `(${link[2]})`)}`;
  return token;
}

function looksLikeTableSeparator(line) {
  return /^\s*\|?[\s:-]+\|[\s|:-]+\|?\s*$/.test(line);
}

function looksLikeTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function renderTableRow(line, paint) {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return `${paint("dim", "|")} ${cells.map((cell) => renderInline(cell.trim(), paint).padEnd(14)).join(paint("dim", " | "))} ${paint("dim", "|")}`;
}

function renderCodeBlock(lines, language, paint) {
  const width = Math.min(process.stdout.columns || 80, 96);
  const title = ` Code${language ? ` ${language}` : ""} `;
  const top = paint("dim", `${title}${"-".repeat(Math.max(0, width - title.length))}`);
  const body = lines.map((line, index) => {
    const number = String(index + 1).padStart(3);
    return `${paint("dim", `${number} |`)} ${paint("dim", line)}`;
  });
  const bottom = paint("dim", "-".repeat(width));
  return [top, ...body, bottom].join("\n");
}
