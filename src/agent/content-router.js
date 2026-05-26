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
  let mode = "unknown";
  let answerOpen = false;
  let notesOpen = false;
  let lineStart = true;
  let pendingHeading = "";

  return {
    write(chunk) {
      for (const char of String(chunk || "")) routeChar(char);
    },

    flush() {
      flushPendingHeading();
      closeNotes();
      closeAnswer();
    },

    closeAnswer() {
      closeAnswer();
    }
  };

  function routeChar(char) {
    if (lineStart || pendingHeading) {
      pendingHeading += char;
      const rawLine = pendingHeading.replace(/\r?\n$/, "");
      if (char === "\n") {
        routePendingLine(rawLine);
        pendingHeading = "";
        lineStart = true;
        return;
      }
      if (isPotentialHeading(rawLine)) return;
      flushPendingHeading();
      return;
    }

    routeText(char);
    lineStart = char === "\n";
  }

  function routePendingLine(rawLine) {
    const heading = parseSectionHeading(rawLine);
    if (heading) {
      switchMode(heading.type);
      return;
    }
    routeText(`${rawLine}\n`);
  }

  function flushPendingHeading() {
    if (!pendingHeading) return;
    routeText(pendingHeading);
    lineStart = pendingHeading.endsWith("\n");
    pendingHeading = "";
  }

  function routeText(text) {
    if (mode === "unknown") mode = "answer";
    if (mode === "notes") {
      openNotes();
      onNotesDelta(text);
      return;
    }
    openAnswer();
    onAnswerDelta(text);
  }

  function switchMode(type) {
    if (type === "notes") {
      closeAnswer();
      openNotes();
      mode = "notes";
      return;
    }
    closeNotes();
    openAnswer();
    mode = "answer";
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

function isPotentialHeading(line) {
  const label = normalizeHeading(line);
  if (!label) return true;
  if (label.length > 40) return false;
  return [...NOTE_LABELS, ...ANSWER_LABELS].some((heading) => heading.startsWith(label));
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
