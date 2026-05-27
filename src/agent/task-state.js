const INSPECT_TOOLS = new Set(["list_files", "read_file", "search_files"]);
const EDIT_TOOLS = new Set(["write_file", "edit_file"]);
const VERIFY_COMMANDS = [
  "test",
  "check",
  "lint",
  "build",
  "typecheck",
  "tsc",
  "pytest",
  "vitest",
  "jest",
  "npm run",
  "pnpm",
  "yarn",
  "node --check"
];

export function createTaskState({ prompt = "" } = {}) {
  const acceptanceCriteria = inferAcceptanceCriteria(prompt);
  const requiresVerification = shouldRequireVerification(prompt);
  return {
    id: `task-${Date.now()}`,
    prompt,
    status: "planning",
    acceptanceCriteria,
    requiresVerification,
    phases: {
      inspected: false,
      edited: false,
      verified: false,
      failed: false
    },
    toolEvents: [],
    failures: [],
    verification: [],
    selfCheckRequested: false,
    recoveryPlan: null
  };
}

export function observeToolEvent(task, event) {
  task.toolEvents.push(summarizeToolEvent(event));
  if (INSPECT_TOOLS.has(event.name)) {
    task.phases.inspected = true;
    task.status = task.phases.edited ? "editing" : "inspecting";
  }
  if (EDIT_TOOLS.has(event.name)) {
    task.phases.edited = true;
    task.requiresVerification = true;
    task.status = "editing";
  }
  if (event.name === "run_command" && isVerificationCommand(event.args?.command)) {
    task.phases.verified = event.ok;
    task.verification.push({
      command: event.args?.command || "",
      ok: event.ok,
      exitCode: event.result?.exit_code,
      error: event.result?.error
    });
    task.status = event.ok ? "verified" : "diagnosing";
  }
  if (!event.ok) {
    task.phases.failed = true;
    task.status = "diagnosing";
    task.failures.push({
      tool: event.name,
      args: event.args,
      error: event.result?.error || event.result?.stderr || "unknown failure"
    });
  }
}

export function evaluateFinalReadiness(task, answer = "") {
  const missing = [];
  if (!task.phases.inspected && looksLikeCodeTask(task.prompt)) missing.push("inspect repository files before final answer");
  if (task.requiresVerification && !task.phases.verified) missing.push("run verification or explain why verification is blocked");
  if (task.failures.length && !mentionsFailure(answer)) missing.push("diagnose or report unresolved tool failure");
  if (!answer.trim()) missing.push("produce a user-facing final answer");

  if (!missing.length) {
    task.status = task.phases.verified ? "completed" : "completed-unverified";
    return { ok: true, missing: [] };
  }

  return {
    ok: false,
    missing,
    followUp: createFollowUpPrompt({ task, missing })
  };
}

export function createRecoveryPlan(task) {
  const nextSteps = [];
  if (!task.phases.inspected) nextSteps.push("Inspect the files most relevant to the request.");
  if (task.phases.edited && !task.phases.verified) nextSteps.push("Run the smallest relevant verification command.");
  if (task.failures.length) nextSteps.push("Diagnose the last failed tool call and choose a smaller next action.");
  if (!nextSteps.length) nextSteps.push("Summarize current state, ask for confirmation, and continue from the latest tool result.");

  task.status = "paused";
  task.recoveryPlan = {
    reason: "max_steps",
    nextSteps,
    createdAt: new Date().toISOString()
  };
  return task.recoveryPlan;
}

export function renderTaskStatus(task) {
  return [
    `status=${task.status}`,
    `criteria=${task.acceptanceCriteria.length}`,
    `inspect=${yesNo(task.phases.inspected)}`,
    `edit=${yesNo(task.phases.edited)}`,
    `verify=${yesNo(task.phases.verified)}`,
    `failures=${task.failures.length}`
  ].join(" ");
}

function createFollowUpPrompt({ task, missing }) {
  task.selfCheckRequested = true;
  task.status = "self-check";
  return [
    "Task gate self-check failed. Continue the task before giving the final answer.",
    "",
    "Missing requirements:",
    ...missing.map((item) => `- ${item}`),
    "",
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "If verification cannot be run, explain the blocker and use available tools to gather enough evidence. Do not provide final answer until this is addressed."
  ].join("\n");
}

function inferAcceptanceCriteria(prompt) {
  const text = String(prompt || "");
  const criteria = ["Answer the user's request directly."];
  if (looksLikeCodeTask(text)) criteria.push("Inspect relevant repository files before making claims.");
  if (/(修复|bug|错误|失败|报错|fix|error|fail|broken)/i.test(text)) criteria.push("Identify the failure cause and verify the fix.");
  if (/(实现|新增|优化|重构|修改|添加|支持|implement|add|optimi[sz]e|refactor|change)/i.test(text)) criteria.push("Apply focused changes and summarize changed files.");
  if (shouldRequireVerification(text)) criteria.push("Run a relevant test/check/build command, or state why it could not be run.");
  return [...new Set(criteria)];
}

function shouldRequireVerification(prompt) {
  return /(修复|bug|测试|失败|报错|构建|检查|实现|新增|重构|修改|fix|test|fail|error|build|check|lint|implement|add|refactor|change)/i.test(String(prompt || ""));
}

function looksLikeCodeTask(prompt) {
  return /(代码|文件|项目|仓库|函数|组件|测试|构建|tool|agent|tui|readme|src|package|code|file|repo|test|build|function|component)/i.test(String(prompt || ""));
}

function isVerificationCommand(command = "") {
  const lower = String(command).toLowerCase();
  return VERIFY_COMMANDS.some((marker) => lower.includes(marker));
}

function mentionsFailure(answer) {
  return /(失败|错误|阻塞|无法|未运行|failed|error|blocked|could not|unable)/i.test(String(answer || ""));
}

function summarizeToolEvent(event) {
  return {
    id: event.id,
    name: event.name,
    ok: event.ok,
    elapsedMs: event.elapsedMs,
    path: event.result?.path || event.args?.path,
    command: event.args?.command
  };
}

function yesNo(value) {
  return value ? "yes" : "no";
}
