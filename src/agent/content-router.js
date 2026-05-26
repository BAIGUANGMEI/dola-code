const NOTE_LABELS = new Set([
  "model notes",
  "notes",
  "analysis",
  "thinking",
  "reasoning",
  "plan",
  "turn summary"
]);

const ANSWER_LABELS = new Set([
  "answer",
  "final answer",
  "response"
]);

export function splitAssistantContent(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const sections = [];
  let current = { type: "answer", title: "", lines: [] };
  let sawSection = false;

  for (const line of lines) {
    const heading = parseSectionHeading(line);
    if (heading) {
      sawSection = true;
      sections.push(current);
      current = { type: heading.type, title: heading.label, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);

  if (!sawSection || !sections.some((section) => section.type === "answer")) {
    return { answer: content || "", notes: "", changed: false };
  }

  const notes = [];
  const answers = [];
  for (const section of sections) {
    const text = trimSection(section.lines.join("\n"));
    if (!text) continue;
    if (section.type === "notes") notes.push(text);
    if (section.type === "answer") answers.push(text);
  }

  return {
    answer: answers.join("\n\n"),
    notes: notes.join("\n\n"),
    changed: true
  };
}

export function createContentRouter({ onAnswerStart, onAnswerDelta, onAnswerEnd, onNotesStart, onNotesDelta, onNotesEnd }) {
  let buffer = "";
  let mode = "unknown";
  let answerOpen = false;
  let notesOpen = false;

  return {
    write(chunk) {
      buffer += String(chunk || "");
      drainCompleteLines();
    },

    flush() {
      if (buffer) routeLine(buffer, false);
      buffer = "";
      closeNotes();
      closeAnswer();
    }
  };

  function drainCompleteLines() {
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) routeLine(`${line}\n`, true);
  }

  function routeLine(lineWithMaybeNewline, hasNewline) {
    const rawLine = hasNewline ? lineWithMaybeNewline.slice(0, -1) : lineWithMaybeNewline;
    const heading = parseSectionHeading(rawLine);
    if (heading) {
      if (heading.type === "notes") {
        closeAnswer();
        openNotes();
        mode = "notes";
        return;
      }
      closeNotes();
      openAnswer();
      mode = "answer";
      return;
    }

    if (mode === "unknown") {
      mode = "answer";
      openAnswer();
    }

    if (mode === "notes") {
      openNotes();
      onNotesDelta(lineWithMaybeNewline);
      return;
    }

    openAnswer();
    onAnswerDelta(lineWithMaybeNewline);
  }

  function openAnswer() {
    if (answerOpen) return;
    onAnswerStart();
    answerOpen = true;
  }

  function closeAnswer() {
    if (!answerOpen) return;
    onAnswerEnd();
    answerOpen = false;
  }

  function openNotes() {
    if (notesOpen) return;
    onNotesStart();
    notesOpen = true;
  }

  function closeNotes() {
    if (!notesOpen) return;
    onNotesEnd();
    notesOpen = false;
  }
}

function parseSectionHeading(line) {
  const label = normalizeHeading(line);
  if (!label) return null;
  if (NOTE_LABELS.has(label)) return { type: "notes", label };
  if (ANSWER_LABELS.has(label)) return { type: "answer", label };
  return null;
}

function normalizeHeading(line) {
  let value = String(line || "").trim();
  if (!value) return "";
  value = value.replace(/^#{1,6}\s+/, "");
  value = value.replace(/^\*\*(.+)\*\*$/, "$1");
  value = value.replace(/^__(.+)__$/, "$1");
  value = value.replace(/[:：]\s*$/, "");
  return value.trim().toLowerCase();
}

function trimSection(text) {
  return String(text || "").replace(/^\s+|\s+$/g, "");
}
