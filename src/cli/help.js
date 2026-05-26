import { DEFAULT_BASE_URL } from "../constants.js";

export function printBanner({ model, baseUrl, cwd }) {
  console.log("Dola Code");
  console.log(`model: ${model}`);
  console.log(`base:  ${baseUrl}`);
  console.log(`cwd:   ${cwd}`);
  console.log("Type /help for commands, /exit to quit.\n");
}

export function printHelp(model) {
  console.log(`
Commands:
  /help           Show help
  /init           Run guided setup and save a global or project profile
  /config         Show active model/base URL and masked API key status
  /context        Show context estimate, configured window, and fill ratio
  /doctor         Send a minimal request without tools
  /repo-map       Rebuild and show project file/symbol map
  /memory         Show long-task stage memory
  /profile        Show active profile
  /profile list   List global/project profiles
  /profile use <name>
                  Switch active profile and persist that choice
  /limits         Show context window and max output token settings
  /status         Show config, context, and session usage together
  /session        Show persisted session state and file path
  /session save   Save the current session immediately
  /session clear  Clear conversation, memory, logs, changes, and persisted state
  /theme          Show current terminal output mode
  /changes [id]   Show tracked file changes, or inspect one diff
  /undo [id]      Revert the latest active change, or a specific change
                  Add --force only when you want to overwrite local drift
  /turn-log <id>  Expand folded model notes and turn summary
  /tool-log <id>  Expand a folded tool call result
  /tools          List available workspace tools
  /usage          Show cumulative token usage for this session
  /model <name>   Switch model and persist it to the active profile
  /cwd            Show workspace directory
  /compact        Keep system prompt and the latest 20 messages
  /clear          Clear conversation context
  /exit           Quit

Prompt shortcuts:
  @path           Attach a workspace file or directory listing to the next prompt
  !command        Run a shell command with the same approval gate as tool calls

Configuration:
  Guided setup stores profiles in ~/.dola-code/config.json or .dola-code/config.json
  Default Base URL: ${DEFAULT_BASE_URL}
  Active model: ${model}

Startup flags:
  --init          Run setup before opening the interactive session
  --yes, -y       Auto-approve file writes and shell commands
  --debug         Print request metadata and raw response snippets
  --profile <name>  Start with a specific profile
  --context-window <tokens>  Override configured context window
  --max-output-tokens <tokens>  Override configured max output tokens
  --compact-output  Hide verbose tool arguments/results
  --verbose       Show larger tool arguments/results
  --no-stream     Disable streaming model output
`);
}
