import pc from "picocolors";
import { formatTokenCount, formatUsage } from "../utils/tokens.js";
import { truncate } from "../utils/text.js";
import { formatSessionStats } from "../session/stats.js";
import { createMarkdownStreamRenderer, renderMarkdown } from "./markdown.js";

export function createOutput({
  color = process.stdout.isTTY && !process.env.NO_COLOR,
  compact = false,
  verbose = false
} = {}) {
  const palette = createPalette(color);
  const paint = (name, text) => palette[name]?.(String(text)) ?? String(text);
  const line = () => console.log(paint("dim", "-".repeat(Math.min(process.stdout.columns || 80, 96))));
  let activeNotes = null;
  let activeAnswer = null;

  return {
    banner({ model, baseUrl, cwd }) {
      line();
      console.log(`${paint("bold", "Dola Code")} ${paint("dim", "terminal coding agent")}`);
      console.log(formatColumns([
        ["model", model],
        ["base", baseUrl],
        ["cwd", cwd]
      ], paint));
      console.log(paint("dim", "Type /help for commands, /status for session, /exit to quit."));
      line();
    },

    status({ state, messages, estimatedTokens, stats }) {
      console.log(paint("dim", formatStickyStatus({ state, messages, estimatedTokens, stats })));
    },

    prompt({ state, messages, estimatedTokens, stats }) {
      console.log("");
      console.log(paint("dim", formatStickyStatus({ state, messages, estimatedTokens, stats })));
      return `${paint("green", "dola")} ${paint("dim", ">")} `;
    },

    turnStart({ input }) {
      console.log("");
      line();
      console.log(`${paint("bold", "User Request")} ${paint("dim", truncateSingleLine(input, 140))}`);
      line();
    },

    turnEnd({ turn, reason }) {
      const toolSummary = turn.tools.length
        ? turn.tools.map((tool) => `${tool.name}:${tool.ok ? "ok" : "failed"}:${tool.elapsedMs}ms`).join(", ")
        : "none";
      const log = turn.id ? ` details=/turn-log ${turn.id}` : "";
      console.log(paint("dim", `Turn Summary folded reason=${reason} steps=${turn.steps} tools=${toolSummary} tokens=${turn.totalTokens} elapsed=${Date.now() - turn.startedAt}ms${log}`));
    },

    turnLog(log) {
      if (!log) {
        this.warn("Turn log not found.");
        return;
      }
      const toolSummary = log.tools.length
        ? log.tools.map((tool) => `${tool.name}:${tool.ok ? "ok" : "failed"}:${tool.elapsedMs}ms`).join(", ")
        : "none";
      this.panel(`Turn Log ${log.id}`, [
        `${paint("dim", "reason".padEnd(12))} ${log.reason}`,
        `${paint("dim", "steps".padEnd(12))} ${log.steps}`,
        `${paint("dim", "tools".padEnd(12))} ${toolSummary}`,
        `${paint("dim", "tokens".padEnd(12))} prompt=${log.promptTokens} completion=${log.completionTokens} total=${log.totalTokens}`,
        `${paint("dim", "elapsed".padEnd(12))} ${log.elapsedMs}ms`,
        `${paint("dim", "notes".padEnd(12))} ${truncate(log.notes || "", 8000)}`
      ]);
    },

    usage(stats) {
      console.log(`${paint("cyan", "Session Usage")} ${formatSessionStats(stats)}`);
    },

    autoContext({ repoMap, autoContext }) {
      const chars = String(autoContext || "").length;
      console.log(paint("dim", `Auto Context repo_files=${repoMap.files.length} symbols=${repoMap.symbols.length} chars=${chars}`));
    },

    repoMap(repoMap) {
      this.panel("Repo Map", [
        `${paint("dim", "created".padEnd(10))} ${repoMap.createdAt}`,
        `${paint("dim", "files".padEnd(10))} ${repoMap.files.length}`,
        `${paint("dim", "symbols".padEnd(10))} ${repoMap.symbols.length}`,
        "",
        truncate(repoMap.rendered, 12_000)
      ]);
    },

    memory(entries) {
      if (!entries.length) {
        this.info("No stage memory yet.");
        return;
      }
      this.panel("Stage Memory", entries.slice(-12).map((entry) => [
        `${paint("dim", `#${String(entry.id).padEnd(3)}`)} steps=${entry.steps} tokens=${entry.tokens} tools=${entry.tools}`,
        `task: ${entry.prompt}`,
        entry.answer ? `result: ${entry.answer}` : "result: -"
      ].join("\n")));
    },

    profiles(profiles, activeProfile) {
      this.panel("Profiles", profiles.map((profile) => {
        const active = profile.name === activeProfile ? paint("green", "*") : " ";
        const scopes = [
          profile.global ? "global" : "",
          profile.project ? "project" : ""
        ].filter(Boolean).join("+") || "default";
        return `${active} ${profile.name.padEnd(18)} ${paint("dim", scopes)}`;
      }));
    },

    changes(changes) {
      if (!changes.length) {
        this.info("No tracked file changes in this session.");
        return;
      }
      this.panel("Changes", changes.map((change) => {
        const status = change.undoneAt ? paint("dim", "undone") : paint("green", "active");
        const size = `${formatBytes(change.bytesBefore)} -> ${formatBytes(change.bytesAfter)}`;
        return [
          paint("dim", `#${String(change.id).padEnd(3)}`),
          status.padEnd(14),
          change.action.padEnd(9),
          size.padEnd(18),
          change.path
        ].join(" ");
      }));
      console.log(paint("dim", "Use /changes <id> to inspect a diff, /undo [id] to revert."));
      console.log("");
    },

    change(change) {
      if (!change) {
        this.warn("Change not found.");
        return;
      }
      const status = change.undoneAt ? "undone" : "active";
      this.panel(`Change ${change.id}`, [
        `${paint("dim", "status".padEnd(12))} ${status}`,
        `${paint("dim", "action".padEnd(12))} ${change.action}`,
        `${paint("dim", "path".padEnd(12))} ${change.path}`,
        `${paint("dim", "bytes".padEnd(12))} ${formatBytes(change.bytesBefore)} -> ${formatBytes(change.bytesAfter)}`,
        `${paint("dim", "created".padEnd(12))} ${change.createdAt}`,
        `${paint("dim", "undone".padEnd(12))} ${change.undoneAt || "-"}`
      ]);
      if (change.diff) this.diff(change.diff);
      console.log("");
    },

    undoResult(result) {
      if (!result?.ok) {
        this.warn(result?.error || "Undo failed.");
        if (result?.conflict) {
          console.log(paint("dim", "Use /changes <id> to inspect it. /undo <id> --force can overwrite the current file state."));
        }
        return;
      }
      console.log(`${paint("green", "Undo ok")} change=#${result.changeId} path=${result.path} restored=${result.restored}`);
      if (result.diff) this.diff(result.diff);
      console.log("");
    },

    tools(tools) {
      this.panel("Tools", tools.map((tool) => {
        const fn = tool.function;
        return `${paint("green", fn.name.padEnd(14))} ${fn.description}`;
      }));
    },

    panel(title, rows) {
      console.log("");
      console.log(paint("cyan", title));
      line();
      for (const row of rows) console.log(row);
      line();
      console.log("");
    },

    config(rows) {
      this.panel("Configuration", rows.map(([key, value]) => `${paint("dim", key.padEnd(8))} ${value}`));
    },

    context(rows) {
      this.panel("Context", rows.map(([key, value]) => `${paint("dim", key.padEnd(16))} ${value}`));
    },

    toolsLegacy(tools) {
      console.log(`\n${paint("cyan", "[tools]")}`);
      for (const tool of tools) {
        const fn = tool.function;
        console.log(`${paint("green", fn.name)} - ${fn.description}`);
      }
      console.log("");
    },

    section(title) {
      console.log(`\n${paint("cyan", `[${title}]`)}`);
    },

    info(message) {
      console.log(`${paint("cyan", "[info]")} ${message}`);
    },

    warn(message) {
      console.log(`${paint("yellow", "[warn]")} ${message}`);
    },

    error(message) {
      console.error(`${paint("red", "[error]")} ${message}`);
    },

    assistant(text) {
      if (!text) return;
      console.log("");
      console.log(paint("green", "Answer"));
      line();
      process.stdout.write(renderMarkdown(text, { paint }));
      console.log("");
      line();
      console.log("");
    },

    answerStart() {
      console.log("");
      console.log(paint("green", "Answer"));
      line();
      activeAnswer = createMarkdownStreamRenderer({
        paint,
        write(value) {
          process.stdout.write(value);
        }
      });
    },

    answerDelta(text) {
      if (!activeAnswer) {
        process.stdout.write(renderMarkdown(text, { paint }));
        return;
      }
      activeAnswer.write(text);
    },

    answerEnd() {
      if (activeAnswer) {
        activeAnswer.flush();
        activeAnswer = null;
      }
      console.log("");
      line();
      console.log("");
    },

    reasoning(text) {
      if (!text) return;
      this.notesStart();
      this.notesDelta(text);
      this.notesEnd();
    },

    notesStart() {
      if (activeNotes) return;
      activeNotes = {
        text: "",
        startedAt: Date.now()
      };
      console.log("");
      console.log(`${paint("magenta", "Model Notes")} ${paint("dim", "streaming")}`);
      line();
    },

    notesDelta(text) {
      if (!activeNotes) this.notesStart();
      activeNotes.text += text;
      process.stdout.write(text);
    },

    notesEnd() {
      if (!activeNotes) return;
      const notes = activeNotes;
      activeNotes = null;

      console.log("");
      console.log(paint("dim", `Model Notes complete chars=${notes.text.length} elapsed=${Date.now() - notes.startedAt}ms`));
    },

    toolStart(name, args) {
      console.log("");
      console.log(`${paint("yellow", "Tool")} ${paint("bold", name)}`);
      if (!compact) {
        console.log(paint("dim", truncate(JSON.stringify(args, null, 2), verbose ? 4000 : 1200)));
      }
    },

    toolResult(result, meta = {}) {
      const ok = result?.ok === false ? "failed" : "ok";
      const label = ok === "ok" ? paint("green", "Result ok") : paint("red", "Result failed");
      const summary = summarizeToolResult(result);
      const elapsed = meta.elapsedMs !== undefined ? ` elapsed=${meta.elapsedMs}ms` : "";
      const log = meta.logId ? ` details=/tool-log ${meta.logId}` : "";
      console.log(`${label} ${summary}${elapsed}${log}`);
      if (result?.diff) {
        this.diff(result.diff);
      }
      if (verbose && !compact) {
        console.log(paint("dim", truncate(JSON.stringify(result), verbose ? 8000 : 2500)));
      }
      console.log("");
    },

    toolLog(log) {
      if (!log) {
        this.warn("Tool log not found.");
        return;
      }
      this.panel(`Tool Log ${log.id}`, [
        `${paint("dim", "tool".padEnd(10))} ${log.name}`,
        `${paint("dim", "status".padEnd(10))} ${log.ok ? "ok" : "failed"}`,
        `${paint("dim", "elapsed".padEnd(10))} ${log.elapsedMs}ms`,
        `${paint("dim", "args".padEnd(10))} ${truncate(JSON.stringify(log.args, null, 2), 4000)}`,
        `${paint("dim", "result".padEnd(10))} ${truncate(JSON.stringify(log.result, null, 2), 8000)}`
      ]);
      if (log.result?.diff) this.diff(log.result.diff);
    },

    diff(diffText) {
      if (!diffText) return;
      console.log(paint("cyan", "Diff"));
      line();
      for (const lineText of diffText.split(/\r?\n/)) {
        if (lineText.startsWith("+") && !lineText.startsWith("+++")) {
          console.log(paint("green", lineText));
        } else if (lineText.startsWith("-") && !lineText.startsWith("---")) {
          console.log(paint("red", lineText));
        } else {
          console.log(paint("dim", lineText));
        }
      }
      line();
    },

    requestStart({ step, context }) {
      const details = `step=${step} messages=${context.messages} est_context_tokens=${context.estimatedTokens}`;
      console.log("");
      console.log(`${paint("cyan", "Model Step")} ${details}`);
      return createSpinner(`waiting for model`, paint);
    },

    requestEnd({ elapsedMs, usage, context, stats }) {
      const elapsed = `${elapsedMs}ms`;
      const estimated = `est_context_tokens=${context.estimatedTokens}`;
      if (verbose) {
        console.log(`${paint("cyan", "Usage")} ${formatUsage(usage)} ${estimated} elapsed=${elapsed}`);
        if (stats) this.usage(stats);
      } else {
        console.log(paint("dim", `Model Step complete ${formatUsage(usage)} ${estimated} elapsed=${elapsed}`));
      }
    }
  };
}

function createPalette(color) {
  if (!color) {
    const plain = (value) => value;
    return {
      dim: plain,
      bold: plain,
      cyan: plain,
      green: plain,
      yellow: plain,
      red: plain,
      magenta: plain
    };
  }

  return {
    dim: pc.dim,
    bold: pc.bold,
    cyan: pc.cyan,
    green: pc.green,
    yellow: pc.yellow,
    red: pc.red,
    magenta: pc.magenta
  };
}

function formatStickyStatus({ state, messages, estimatedTokens, stats }) {
  const mode = `${state.platform}/${state.region}/${state.service}`;
  const approval = state.assumeYes ? "auto" : "ask";
  const total = stats.totalTokens || stats.promptTokens + stats.completionTokens;
  const context = state.contextWindow ? `${formatTokenCount(estimatedTokens)}/${formatTokenCount(state.contextWindow)}` : formatTokenCount(estimatedTokens);
  return [
    `model ${state.model}`,
    `profile ${state.profile || state.activeProfile || "default"}`,
    `mode ${mode}`,
    `perm ${approval}`,
    `msgs ${messages}`,
    `ctx~ ${context}`,
    `used ${formatTokenCount(total)}`
  ].join("  |  ");
}

function formatColumns(rows, paint) {
  return rows.map(([key, value]) => `${paint("dim", key.padEnd(6))} ${value}`).join("\n");
}

function truncateSingleLine(text, limit) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  if (line.length <= limit) return line;
  return `${line.slice(0, limit - 15)}...`;
}

function summarizeToolResult(result) {
  if (!result) return "";
  if (result.cancelled) return "cancelled";
  if (result.path) return `path=${result.path}${result.change_id ? ` change=#${result.change_id}` : ""}`;
  if (result.exit_code !== undefined) return `exit=${result.exit_code}`;
  if (result.entries) return `entries=${result.entries.length} omitted=${result.omitted}`;
  if (result.output) return `output_chars=${result.output.length}`;
  if (result.error) return result.error;
  return "";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function createSpinner(label, paint) {
  if (!process.stdout.isTTY) {
    console.log(`${paint("dim", "[status]")} ${label}...`);
    return { stop() {} };
  }

  const frames = ["-", "\\", "|", "/"];
  let index = 0;
  let stopped = false;
  process.stdout.write(`${paint("dim", "[status]")} ${label} ${frames[index]}`);
  const timer = setInterval(() => {
    if (stopped) return;
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${paint("dim", "[status]")} ${label} ${frames[index]}`);
  }, 120);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write(`\r${" ".repeat(label.length + 20)}\r`);
    }
  };
}
