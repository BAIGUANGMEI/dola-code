import { MAX_AGENT_STEPS, MAX_HISTORY_MESSAGES } from "./constants.js";
import { createContentRouter, splitAssistantContent } from "./agent/content-router.js";
import { createSystemPrompt } from "./prompts.js";
import { compressToolResultForModel } from "./session/tool-summary.js";
import { toolDefinitions } from "./tools/schema.js";
import { createOutput } from "./tui/output.js";
import { estimateMessageTokens, estimateToolTokens } from "./utils/tokens.js";

export function createInitialMessages(cwd) {
  return [{ role: "system", content: createSystemPrompt(cwd) }];
}

export async function runAgent({ messages, client, callTool, ui = createOutput(), stats = null, toolLogs = [], turnLogs = [] }) {
  const turn = createTurnStats();

  for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
    turn.steps = step;
    trimConversation(messages);
    const context = estimateContext(messages);
    const spinner = ui.requestStart({ step, context });
    let spinnerStopped = false;
    const stopSpinner = () => {
      if (spinnerStopped) return;
      spinner.stop();
      spinnerStopped = true;
    };
    let response;
    let answerStarted = false;
    let answerOutput = false;
    let notesStarted = false;
    const answerStart = () => {
      if (!answerStarted) {
        stopSpinner();
        ui.answerStart();
        answerStarted = true;
        answerOutput = true;
      }
    };
    const answerEnd = () => {
      if (!answerStarted) return;
      ui.answerEnd();
      answerStarted = false;
    };
    const notesStart = () => {
      if (!notesStarted) {
        stopSpinner();
        ui.notesStart();
        notesStarted = true;
      }
    };
    const notesEnd = () => {
      if (!notesStarted) return;
      ui.notesEnd();
      notesStarted = false;
    };
    let reasoningNotesOpen = false;
    let contentMode = "pending";
    let pendingContent = "";
    let contentRoutedAsNotes = false;
    const pendingContentLimit = 160;
    const contentRouter = createContentRouter({
      onAnswerStart: answerStart,
      onAnswerDelta: (text) => ui.answerDelta(text),
      onAnswerEnd: answerEnd,
      onNotesStart: notesStart,
      onNotesDelta: (text) => {
        turn.notes += text;
        ui.notesDelta(text);
      },
      onNotesEnd: notesEnd
    });
    const writeContentDelta = (text) => {
      if (reasoningNotesOpen) {
        notesEnd();
        reasoningNotesOpen = false;
      }
      if (contentMode === "notes") {
        notesStart();
        contentRoutedAsNotes = true;
        turn.notes += text;
        ui.notesDelta(text);
        return;
      }
      if (contentMode === "answer") {
        contentRouter.write(text);
        return;
      }

      pendingContent += text;
      if (pendingContent.length >= pendingContentLimit) flushPendingContentAsAnswer();
    };
    const flushPendingContentAsAnswer = () => {
      if (!pendingContent) return;
      contentMode = "answer";
      contentRouter.write(pendingContent);
      pendingContent = "";
    };
    const flushPendingContentAsNotes = () => {
      if (contentMode === "answer") {
        contentRouter.closeAnswer();
      }
      contentMode = "notes";
      if (!pendingContent) return;
      notesStart();
      contentRoutedAsNotes = true;
      turn.notes += pendingContent;
      ui.notesDelta(pendingContent);
      pendingContent = "";
    };
    try {
      response = await client.chatCompletions({
        messages,
        tools: toolDefinitions,
        onContentDelta: (text) => {
          writeContentDelta(text);
        },
        onReasoningDelta: (text) => {
          if (pendingContent) {
            flushPendingContentAsNotes();
            contentMode = "pending";
          }
          if (answerStarted) {
            contentRouter.closeAnswer();
          }
          if (!notesStarted) {
            stopSpinner();
            ui.notesStart();
            notesStarted = true;
          }
          reasoningNotesOpen = true;
          turn.notes += text;
          ui.notesDelta(text);
        },
        onToolCallDelta: () => {
          flushPendingContentAsNotes();
        }
      });
    } finally {
      stopSpinner();
      const hasToolCalls = response?.message?.tool_calls?.length;
      if (pendingContent) {
        if (hasToolCalls) {
          flushPendingContentAsNotes();
        } else {
          flushPendingContentAsAnswer();
        }
      }
      contentRouter.flush();
      notesEnd();
      answerEnd();
    }

    const { message: assistant, usage, elapsedMs } = response;
    const split = splitAssistantContent(assistant.content || "");
    if (split.changed) {
      assistant.content = split.answer;
      if (split.notes && !turn.notes.includes(split.notes)) {
        turn.notes += `${turn.notes ? "\n\n" : ""}${split.notes}`;
      }
    }
    recordTurnUsage(turn, usage);
    stats?.record({ usage, elapsedMs });
    ui.requestEnd({ elapsedMs, usage, context, stats });

    const reasoning = extractVisibleReasoning(assistant);
    if (reasoning && !turn.notes.includes(reasoning)) {
      turn.notes += reasoning;
      ui.reasoning(reasoning);
    }

    messages.push(assistant);

    const toolCalls = assistant.tool_calls || [];
    if (toolCalls.length === 0) {
      const log = finishTurn({ turn, turnLogs, ui, reason: "completed" });
      if (!answerOutput) outputFinalAnswer({ ui, content: assistant.content });
      return log;
    }

    if (assistant.content && !contentRoutedAsNotes) {
      turn.notes += `${turn.notes ? "\n\n" : ""}Assistant step ${step} note:\n${assistant.content}`;
    }

    for (const toolCall of toolCalls) {
      const toolEvent = await handleToolCall({ messages, toolCall, callTool, ui, toolLogs });
      turn.tools.push(toolEvent);
    }
  }

  ui.warn(`Reached max agent steps (${MAX_AGENT_STEPS}); paused this turn.`);
  return finishTurn({ turn, turnLogs, ui, reason: "max_steps" });
}

function createTurnStats() {
  return {
    startedAt: Date.now(),
    steps: 0,
    tools: [],
    notes: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };
}

function finishTurn({ turn, turnLogs, ui, reason }) {
  const elapsedMs = Date.now() - turn.startedAt;
  const log = {
    id: turnLogs.length + 1,
    reason,
    steps: turn.steps,
    tools: turn.tools,
    notes: turn.notes,
    promptTokens: turn.promptTokens,
    completionTokens: turn.completionTokens,
    totalTokens: turn.totalTokens,
    elapsedMs
  };
  turn.id = log.id;
  turnLogs.push(log);
  ui.turnEnd({ turn, reason });
  return log;
}

function outputFinalAnswer({ ui, content }) {
  if (!content) return;
  ui.answerStart();
  ui.answerDelta(content);
  ui.answerEnd();
}

function recordTurnUsage(turn, usage) {
  if (!usage) return;
  turn.promptTokens += usage.prompt_tokens ?? usage.input_tokens ?? 0;
  turn.completionTokens += usage.completion_tokens ?? usage.output_tokens ?? 0;
  turn.totalTokens += usage.total_tokens ?? 0;
}

function estimateContext(messages) {
  return {
    messages: messages.length,
    estimatedTokens: estimateMessageTokens(messages) + estimateToolTokens(toolDefinitions)
  };
}

function extractVisibleReasoning(message) {
  const value = message.reasoning_content ?? message.reasoning ?? message.thinking;
  if (!value) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function trimConversation(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return;

  const system = messages[0];
  const recent = messages.slice(-(MAX_HISTORY_MESSAGES - 1));
  messages.splice(0, messages.length, system, ...recent);
  console.log(`[context] Trimmed conversation to the latest ${messages.length} messages.`);
}

async function handleToolCall({ messages, toolCall, callTool, ui, toolLogs }) {
  const name = toolCall.function?.name;
  const startedAt = Date.now();
  const logId = toolLogs.length + 1;
  let toolArgs;
  try {
    toolArgs = parseToolArgs(toolCall.function?.arguments);
  } catch (error) {
    const result = { ok: false, error: error.message, raw_arguments: toolCall.function?.arguments };
    const elapsedMs = Date.now() - startedAt;
    const event = { id: logId, name: name || "unknown", args: {}, result, ok: false, elapsedMs };
    toolLogs.push(event);
    ui.toolResult(result, { elapsedMs, logId });
    pushToolResult(messages, toolCall.id, name, result);
    return event;
  }

  ui.toolStart(name, toolArgs);

  let result;
  try {
    result = await callTool(name, toolArgs);
  } catch (error) {
    result = { ok: false, error: error.message };
  }

  const elapsedMs = Date.now() - startedAt;
  const event = { id: logId, name, args: toolArgs, result, ok: result?.ok !== false, elapsedMs };
  toolLogs.push(event);
  ui.toolResult(result, { elapsedMs, logId });
  pushToolResult(messages, toolCall.id, name, result);
  return event;
}

function parseToolArgs(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid tool JSON arguments: ${error.message}`);
  }
}

function pushToolResult(messages, toolCallId, name, result) {
  messages.push({
    role: "tool",
    tool_call_id: toolCallId,
    content: compressToolResultForModel({ name, result })
  });
}
