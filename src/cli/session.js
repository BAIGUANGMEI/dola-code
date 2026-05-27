import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { VERSION } from "../constants.js";
import { createInitialMessages, runAgent } from "../agent.js";
import { ModelArkClient } from "../client/modelark.js";
import { createConfig } from "../config.js";
import { doctor } from "../doctor.js";
import { createReferenceCompleter, expandFileReferences } from "./references.js";
import { listProfiles, persistModelSelection, readLocalConfig, resolveStoredConfig, setActiveProfile } from "../settings/store.js";
import { runConfigWizard } from "../settings/wizard.js";
import { createChangeTracker } from "../session/changes.js";
import { compactMessagesWithSummary, createSessionMemory, maybeAutoCompact } from "../session/memory.js";
import { buildAutoContext, buildRepoMap } from "../session/repo-map.js";
import { createSessionStats } from "../session/stats.js";
import { deleteSession, readSession, sessionPathForCwd, writeSession } from "../session/store.js";
import { createOutput } from "../tui/output.js";
import { createToolRunner } from "../tools/index.js";
import { toolDefinitions } from "../tools/schema.js";
import { maskSecret } from "../utils/text.js";
import { estimateMessageTokens } from "../utils/tokens.js";
import { printHelp } from "./help.js";

export async function runCli({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const config = createConfig({ cwd, argv });

  if (config.shouldPrintVersion) {
    console.log(`dola-code ${VERSION}`);
    return;
  }

  if (config.shouldPrintHelp) {
    printHelp(config.model);
    return;
  }

  const rl = readline.createInterface({
    input,
    output,
    completer: createReferenceCompleter({ cwd: config.cwd })
  });
  const ui = createOutput({
    compact: config.compactOutput,
    verbose: config.verboseOutput
  });
  let activeConfig = config;

  if ((!activeConfig.hasLocalConfig && !activeConfig.hasGlobalConfig) || activeConfig.shouldInit) {
    const reason = activeConfig.shouldInit ? "Requested setup." : "No global or project config found.";
    console.log(`${reason} Starting guided setup.`);
    const stored = await runConfigWizard({
      cwd: activeConfig.cwd,
      rl,
      existingConfig: activeConfig
    });
    const resolved = resolveStoredConfig({ cwd: activeConfig.cwd, profileName: stored.profile });
    activeConfig = { ...activeConfig, ...resolved };
  }

  const state = {
    model: activeConfig.model,
    baseUrl: activeConfig.baseUrl,
    cwd: activeConfig.cwd,
    apiKey: activeConfig.apiKey,
    provider: activeConfig.provider,
    platform: activeConfig.platform,
    region: activeConfig.region,
    service: activeConfig.service,
    configSource: activeConfig.configSource,
    assumeYes: activeConfig.assumeYes,
    profile: activeConfig.profile,
    activeProfile: activeConfig.activeProfile,
    contextWindow: activeConfig.contextWindow,
    maxOutputTokens: activeConfig.maxOutputTokens
  };

  const client = new ModelArkClient({
    apiKey: activeConfig.apiKey,
    baseUrl: activeConfig.baseUrl,
    model: activeConfig.model,
    debug: activeConfig.debug,
    stream: activeConfig.stream,
    maxOutputTokens: activeConfig.maxOutputTokens
  });

  const confirm = async (question) => {
    if (activeConfig.assumeYes) return true;
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  };

  const persistedSession = await loadPersistedSession(activeConfig.cwd, ui);
  const restoredMessages = restoreMessages({
    cwd: activeConfig.cwd,
    messages: persistedSession?.messages
  });
  const changeTracker = createChangeTracker({
    cwd: activeConfig.cwd,
    changes: persistedSession?.changes
  });
  const callTool = createToolRunner({
    cwd: activeConfig.cwd,
    confirm,
    changeTracker,
    onCommandOutput: (event) => ui.commandOutput(event)
  });
  const messages = restoredMessages;
  const stats = createSessionStats(persistedSession?.stats);
  const memory = createSessionMemory({ entries: persistedSession?.memoryEntries });
  let repoMap = await refreshRepoMap({ cwd: activeConfig.cwd, ui, silent: true });
  const toolLogs = Array.isArray(persistedSession?.toolLogs) ? persistedSession.toolLogs : [];
  const turnLogs = Array.isArray(persistedSession?.turnLogs) ? persistedSession.turnLogs : [];
  const sessionPath = sessionPathForCwd(activeConfig.cwd);
  if (persistedSession) {
    ui.info(`Restored persisted session: messages=${messages.length} memory=${memory.entries.length} changes=${changeTracker.list().length}`);
  }
  let sessionCreatedAt = persistedSession?.createdAt;
  const persistSession = async () => {
    const saved = await writeSession(activeConfig.cwd, {
      createdAt: sessionCreatedAt,
      profile: state.profile || state.activeProfile,
      model: state.model,
      messages,
      memoryEntries: memory.entries,
      stats: stats.snapshot(),
      toolLogs,
      turnLogs,
      changes: changeTracker.snapshot()
    });
    sessionCreatedAt = saved.createdAt;
    return saved;
  };
  const printConfig = () => {
    ui.config([
      ["model", state.model],
      ["base", state.baseUrl],
      ["cwd", state.cwd],
      ["mode", `${state.platform}/${state.region}/${state.service}`],
      ["profile", state.profile || state.activeProfile],
      ["context", state.contextWindow],
      ["max_out", state.maxOutputTokens],
      ["source", state.configSource],
      ["key", maskSecret(state.apiKey)]
    ]);
  };

  ui.banner(state);

  try {
    while (true) {
      const prompt = await askPrompt(rl, ui, {
        state,
        messages: messages.length,
        estimatedTokens: estimateMessageTokens(messages),
        stats
      });
      if (prompt === null) break;
      const trimmed = prompt.trim();
      if (!trimmed) continue;

      if (trimmed === "/exit" || trimmed === "/quit") break;
      if (trimmed === "/help") {
        printHelp(state.model);
        continue;
      }
      if (trimmed === "/init") {
        const stored = await runConfigWizard({
          cwd: state.cwd,
          rl,
          existingConfig: resolveStoredConfig({ cwd: state.cwd, profileName: state.profile })
        });
        const resolved = resolveStoredConfig({ cwd: state.cwd, profileName: stored.profile });
        applyStoredConfig({ state, client, stored: resolved });
        activeConfig = { ...activeConfig, ...resolved };
        await persistSession();
        console.log("Configuration reloaded.");
        continue;
      }
      if (trimmed === "/config") {
        printConfig();
        continue;
      }
      if (trimmed === "/status") {
        printConfig();
        printContext(messages, ui, state);
        ui.usage(stats);
        ui.info(`Stage memory entries: ${memory.entries.length}`);
        ui.info(`Session file: ${sessionPath}`);
        continue;
      }
      if (trimmed === "/doctor") {
        await doctor({ client, printConfig });
        continue;
      }
      if (trimmed === "/usage") {
        ui.usage(stats);
        continue;
      }
      if (trimmed === "/limits") {
        ui.config([
          ["profile", state.profile || state.activeProfile],
          ["context", state.contextWindow],
          ["max_out", state.maxOutputTokens],
          ["override", "--context-window / --max-output-tokens"]
        ]);
        continue;
      }
      if (trimmed === "/profile") {
        ui.config([
          ["active", state.profile || state.activeProfile],
          ["source", state.configSource]
        ]);
        continue;
      }
      if (trimmed === "/profile list") {
        ui.profiles(listProfiles({ cwd: state.cwd }), state.profile || state.activeProfile);
        continue;
      }
      if (trimmed.startsWith("/profile use ")) {
        const profileName = trimmed.slice("/profile use ".length).trim();
        if (!profileName) {
          ui.warn("Usage: /profile use <name>");
          continue;
        }
        const profiles = listProfiles({ cwd: state.cwd });
        if (!profiles.some((profile) => profile.name === profileName)) {
          ui.warn(`Profile "${profileName}" does not exist. Run /init to create it first.`);
          continue;
        }
        setActiveProfile({ cwd: state.cwd, scope: readLocalConfig(state.cwd) ? "project" : "global", profileName });
        const resolved = resolveStoredConfig({ cwd: state.cwd, profileName });
        applyStoredConfig({ state, client, stored: resolved });
        activeConfig = { ...activeConfig, ...resolved };
        await persistSession();
        console.log(`Profile switched to ${profileName}`);
        continue;
      }
      if (trimmed === "/changes" || trimmed.startsWith("/changes ")) {
        const args = parseChangeArgs(trimmed);
        if (args.invalid) {
          ui.warn("Usage: /changes [id]");
        } else if (args.id) {
          ui.change(changeTracker.get(args.id));
        } else {
          ui.changes(changeTracker.list());
        }
        continue;
      }
      if (trimmed === "/undo" || trimmed.startsWith("/undo ")) {
        const args = parseUndoArgs(trimmed);
        if (args.invalid) {
          ui.warn("Usage: /undo [id] [--force]");
        } else {
          const result = await changeTracker.undo(args);
          ui.undoResult(result);
          await persistSession();
        }
        continue;
      }
      if (trimmed === "/reject" || trimmed.startsWith("/reject ")) {
        const args = parseUndoArgs(trimmed.replace(/^\/reject/, "/undo"));
        if (args.invalid) {
          ui.warn("Usage: /reject [id] [--force]");
        } else {
          const result = await changeTracker.undo(args);
          ui.undoResult(result);
          await persistSession();
        }
        continue;
      }
      if (trimmed === "/accept" || trimmed.startsWith("/accept ")) {
        const args = parseChangeArgs(trimmed.replace(/^\/accept/, "/changes"));
        if (args.invalid) {
          ui.warn("Usage: /accept [id]");
        } else {
          const result = changeTracker.accept({ id: args.id });
          ui.acceptResult(result);
          await persistSession();
        }
        continue;
      }
      if (trimmed === "/tools") {
        ui.tools(toolDefinitions);
        continue;
      }
      if (trimmed === "/timeline") {
        ui.timeline(toolLogs);
        continue;
      }
      if (trimmed === "/repo-map") {
        repoMap = await refreshRepoMap({ cwd: state.cwd, ui });
        ui.repoMap(repoMap);
        continue;
      }
      if (trimmed === "/memory") {
        ui.memory(memory.entries);
        continue;
      }
      if (trimmed === "/session") {
        ui.config([
          ["path", sessionPath],
          ["messages", messages.length],
          ["memory", memory.entries.length],
          ["changes", changeTracker.list().length],
          ["tool_logs", toolLogs.length],
          ["turn_logs", turnLogs.length]
        ]);
        continue;
      }
      if (trimmed === "/session save") {
        await persistSession();
        ui.info(`Session saved to ${sessionPath}`);
        continue;
      }
      if (trimmed === "/session clear") {
        messages.splice(0, messages.length, ...createInitialMessages(state.cwd));
        memory.clear();
        stats.reset();
        toolLogs.splice(0);
        turnLogs.splice(0);
        changeTracker.clear();
        sessionCreatedAt = undefined;
        await deleteSession(state.cwd);
        await persistSession();
        ui.info("Session cleared and persisted.");
        continue;
      }
      if (trimmed.startsWith("/tool-log")) {
        const id = Number(trimmed.split(/\s+/)[1]);
        if (!Number.isInteger(id)) {
          ui.warn("Usage: /tool-log <id>");
          continue;
        }
        ui.toolLog(toolLogs.find((log) => log.id === id));
        continue;
      }
      if (trimmed.startsWith("/turn-log")) {
        const id = Number(trimmed.split(/\s+/)[1]);
        if (!Number.isInteger(id)) {
          ui.warn("Usage: /turn-log <id>");
          continue;
        }
        ui.turnLog(turnLogs.find((log) => log.id === id));
        continue;
      }
      if (trimmed === "/theme") {
        ui.config([
          ["color", process.env.NO_COLOR ? "disabled" : "auto"],
          ["compact", String(config.compactOutput)],
          ["verbose", String(config.verboseOutput)],
          ["stream", String(config.stream)],
          ["compact_flag", "--compact-output"],
          ["verbose_flag", "--verbose"],
          ["stream_off", "--no-stream"]
        ]);
        continue;
      }
      if (trimmed === "/context") {
        printContext(messages, ui, state);
        continue;
      }
      if (trimmed.startsWith("!")) {
        const command = trimmed.slice(1).trim();
        if (!command) {
          ui.warn("Usage: !<shell command>");
          continue;
        }
        const logId = toolLogs.length + 1;
        ui.toolStart("run_command", { command }, { logId });
        const result = await callTool("run_command", { command });
        const log = {
          id: logId,
          name: "run_command",
          args: { command },
          result,
          ok: result?.ok !== false,
          elapsedMs: 0
        };
        toolLogs.push(log);
        ui.toolResult(result, { logId: log.id });
        await persistSession();
        continue;
      }
      if (trimmed === "/cwd") {
        console.log(state.cwd);
        continue;
      }
      if (trimmed === "/clear") {
        messages.splice(1);
        memory.clear();
        await persistSession();
        console.log("Conversation context cleared.");
        continue;
      }
      if (trimmed === "/compact") {
        compactMessagesWithSummary({ messages, memory });
        await persistSession();
        console.log(`Conversation compacted to ${messages.length} messages with a generated summary.`);
        continue;
      }
      if (trimmed.startsWith("/model ")) {
        const model = trimmed.slice("/model ".length).trim();
        state.model = model;
        client.setModel(state.model);
        persistModelSelection({ cwd: state.cwd, profileName: state.profile || state.activeProfile, model });
        await persistSession();
        console.log(`Model switched to ${state.model} and persisted to profile ${state.profile || state.activeProfile}`);
        continue;
      }

      maybeAutoCompact({ messages, memory, ui, contextWindow: state.contextWindow });
      repoMap = await ensureFreshRepoMap({ cwd: state.cwd, repoMap, ui });
      const expandedPrompt = await expandFileReferences({
        prompt,
        cwd: state.cwd,
        ui
      });
      const autoContext = await buildAutoContext({
        cwd: state.cwd,
        prompt,
        memory,
        repoMap
      });
      const promptWithContext = `${expandedPrompt}\n\nAuto context:\n${autoContext}`;
      ui.autoContext({ repoMap, autoContext });
      ui.turnStart({ input: prompt });
      messages.push({ role: "user", content: promptWithContext });
      try {
        const toolStartIndex = toolLogs.length;
        const turn = await runAgent({ messages, client, callTool, ui, stats, toolLogs, turnLogs });
        const answer = latestAssistantContent(messages);
        memory.addTurn({
          prompt,
          turn,
          answer,
          toolEvents: toolLogs.slice(toolStartIndex)
        });
        await persistSession();
      } catch (error) {
        ui.error(error.message);
        await persistSession();
      }
    }
  } finally {
    try {
      await persistSession();
    } catch (error) {
      ui.warn(`Could not persist session: ${error.message}`);
    } finally {
      rl.close();
    }
  }
}

async function loadPersistedSession(cwd, ui) {
  try {
    return await readSession(cwd);
  } catch (error) {
    ui.warn(`Could not restore persisted session: ${error.message}`);
    return null;
  }
}

function restoreMessages({ cwd, messages }) {
  const initial = createInitialMessages(cwd);
  if (!Array.isArray(messages) || messages.length === 0) return initial;

  const restored = messages
    .filter((message) => message && typeof message === "object" && typeof message.role === "string")
    .map((message) => ({ ...message }));
  if (!restored.length) return initial;

  if (restored[0].role === "system") {
    restored[0] = initial[0];
  } else {
    restored.unshift(initial[0]);
  }
  return restored;
}

async function askPrompt(rl, ui, promptState) {
  try {
    return await rl.question(ui.prompt(promptState));
  } catch (error) {
    if (error.code === "ERR_USE_AFTER_CLOSE") return null;
    throw error;
  }
}

function printContext(messages, ui, state = {}) {
  const estimatedTokens = estimateMessageTokens(messages);
  const contextWindow = state.contextWindow || 0;
  const rows = [
    ["messages", messages.length],
    ["estimated_tokens", estimatedTokens]
  ];
  if (contextWindow) {
    rows.push(["context_window", contextWindow]);
    rows.push(["estimated_fill", `${Math.round((estimatedTokens / contextWindow) * 100)}%`]);
  }
  ui.context([
    ...rows
  ]);
}

function applyStoredConfig({ state, client, stored }) {
  state.model = stored.model;
  state.baseUrl = stored.baseUrl;
  state.apiKey = stored.apiKey;
  state.provider = stored.provider;
  state.platform = stored.platform;
  state.region = stored.region;
  state.service = stored.service;
  state.configSource = stored.configSource || "profile";
  state.profile = stored.profile || stored.activeProfile || state.profile;
  state.activeProfile = stored.activeProfile || state.profile;
  state.contextWindow = stored.contextWindow;
  state.maxOutputTokens = stored.maxOutputTokens;
  client.setConfig({
    apiKey: stored.apiKey,
    baseUrl: stored.baseUrl,
    model: stored.model,
    maxOutputTokens: stored.maxOutputTokens
  });
}

async function refreshRepoMap({ cwd, ui, silent = false }) {
  const repoMap = await buildRepoMap({ cwd });
  if (!silent) ui.info(`Repo map refreshed: ${repoMap.files.length} files, ${repoMap.symbols.length} symbols.`);
  return repoMap;
}

async function ensureFreshRepoMap({ cwd, repoMap, ui }) {
  if (repoMap && Date.now() - Date.parse(repoMap.createdAt) < 60_000) return repoMap;
  try {
    return await refreshRepoMap({ cwd, ui, silent: true });
  } catch (error) {
    ui.warn(`Could not refresh repo map: ${error.message}`);
    return repoMap || { files: [], symbols: [], rendered: "Repo map unavailable.", createdAt: new Date().toISOString() };
  }
}

function latestAssistantContent(messages) {
  return [...messages].reverse().find((message) => message.role === "assistant" && message.content)?.content || "";
}

function parseChangeArgs(command) {
  const parts = command.split(/\s+/).slice(1).filter(Boolean);
  if (parts.length === 0) return { id: null, invalid: false };
  if (parts.length > 1) return { id: null, invalid: true };
  const id = Number(parts[0]);
  return Number.isInteger(id) && id > 0
    ? { id, invalid: false }
    : { id: null, invalid: true };
}

function parseUndoArgs(command) {
  const parts = command.split(/\s+/).slice(1);
  const force = parts.includes("--force");
  const idParts = parts.filter((part) => part !== "--force");
  if (idParts.length > 1) return { id: null, force, invalid: true };
  if (idParts.length === 0) return { id: null, force, invalid: false };
  const id = Number(idParts[0]);
  return Number.isInteger(id) && id > 0
    ? { id, force, invalid: false }
    : { id: null, force, invalid: true };
}
