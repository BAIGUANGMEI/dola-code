import { VERSION } from "../constants.js";
import { truncate } from "../utils/text.js";

export class ModelArkClient {
  constructor({ apiKey, baseUrl, model, debug = false, stream = true, maxOutputTokens = null }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.debug = debug;
    this.stream = stream;
    this.maxOutputTokens = maxOutputTokens;
  }

  setModel(model) {
    this.model = model;
  }

  setConfig({ apiKey = this.apiKey, baseUrl = this.baseUrl, model = this.model, maxOutputTokens = this.maxOutputTokens }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.maxOutputTokens = maxOutputTokens;
  }

  async chatCompletions({ messages, tools, temperature = 0.2, maxOutputTokens = this.maxOutputTokens, onContentDelta, onReasoningDelta }) {
    if (!this.apiKey) {
      throw new Error("Missing API key. Run /init to save one in ~/.dola-code/config.json or .dola-code/config.json.");
    }

    const payload = {
      model: this.model,
      messages,
      temperature,
      stream: this.stream
    };
    if (maxOutputTokens) payload.max_tokens = maxOutputTokens;

    if (this.stream) {
      payload.stream_options = { include_usage: true };
    }

    if (tools) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    if (this.debug) {
      console.error(`[debug] POST ${this.baseUrl}/chat/completions`);
      console.error(`[debug] model=${this.model} messages=${messages.length} tools=${tools?.length ?? 0}`);
    }

    const startedAt = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "user-agent": `dola-code/${VERSION}`
      },
      body: JSON.stringify(payload)
    });

    const elapsedMs = Date.now() - startedAt;

    if (this.stream && response.ok && isEventStream(response)) {
      return parseStreamResponse({
        response,
        elapsedStartedAt: startedAt,
        debug: this.debug,
        onContentDelta,
        onReasoningDelta
      });
    }

    const body = await parseResponse(response);

    if (this.debug) {
      console.error(`[debug] status=${response.status}`);
      console.error(`[debug] response=${truncate(JSON.stringify(body), 3000)}`);
    }

    if (!response.ok) {
      throw createModelError(response.status, body);
    }

    const message = body.choices?.[0]?.message;
    if (!message) throw new Error(`Unexpected model response: ${truncate(JSON.stringify(body))}`);
    return { message, usage: body.usage, elapsedMs, raw: body };
  }
}

function isEventStream(response) {
  return response.headers.get("content-type")?.includes("text/event-stream");
}

async function parseStreamResponse({ response, elapsedStartedAt, debug, onContentDelta, onReasoningDelta }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage;
  const message = {
    role: "assistant",
    content: "",
    tool_calls: []
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        if (debug) console.error(`[debug] bad stream chunk=${data}`);
        continue;
      }

      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      applyDelta(message, choice.delta || {}, { onContentDelta, onReasoningDelta });
    }
  }

  if (!message.content) delete message.content;
  if (!message.tool_calls.length) delete message.tool_calls;
  return {
    message,
    usage,
    elapsedMs: Date.now() - elapsedStartedAt,
    raw: { stream: true }
  };
}

function applyDelta(message, delta, callbacks) {
  if (delta.role) message.role = delta.role;

  const content = delta.content;
  if (content) {
    message.content = `${message.content || ""}${content}`;
    callbacks.onContentDelta?.(content);
  }

  const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
  if (reasoning) {
    const key = delta.reasoning_content !== undefined ? "reasoning_content" : delta.reasoning !== undefined ? "reasoning" : "thinking";
    message[key] = `${message[key] || ""}${reasoning}`;
    callbacks.onReasoningDelta?.(reasoning);
  }

  for (const toolCall of delta.tool_calls || []) {
    const index = toolCall.index ?? message.tool_calls.length;
    const current = message.tool_calls[index] || {
      id: toolCall.id,
      type: toolCall.type || "function",
      function: { name: "", arguments: "" }
    };
    if (toolCall.id) current.id = toolCall.id;
    if (toolCall.type) current.type = toolCall.type;
    if (toolCall.function?.name) current.function.name += toolCall.function.name;
    if (toolCall.function?.arguments) current.function.arguments += toolCall.function.arguments;
    message.tool_calls[index] = current;
  }
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function createModelError(status, body) {
  const errorCode = body.error?.code;
  if (errorCode === "InvalidSubscription") {
    return new Error(
      `Model request failed (${status}): InvalidSubscription\n\n` +
      `The API key was accepted, but this endpoint requires an active Coding Plan subscription.\n` +
      `If you are using normal BytePlus ModelArk model invocation, run /init and choose a Model API /api/v3 endpoint.\n` +
      `If you intentionally use Coding Plan, check the subscription, account, region, and API key.\n\n` +
      `Original response: ${truncate(JSON.stringify(body))}`
    );
  }

  return new Error(`Model request failed (${status}): ${truncate(JSON.stringify(body))}`);
}
