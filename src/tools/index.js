import {
  editTextFile,
  listFiles,
  readTextFile,
  runShellCommand,
  searchFiles,
  writeTextFile
} from "./workspace.js";

export function createToolRunner({ cwd, confirm, changeTracker = null }) {
  return async function callTool(name, params) {
    const context = { cwd, params, confirm };
    const trackable = name === "write_file" || name === "edit_file";
    const before = trackable ? await changeTracker?.capture(params.path) : null;
    let result;

    switch (name) {
      case "list_files":
        return listFiles(context);
      case "read_file":
        return readTextFile(context);
      case "search_files":
        return searchFiles(context);
      case "write_file":
        result = await writeTextFile(context);
        break;
      case "edit_file":
        result = await editTextFile(context);
        break;
      case "run_command":
        return runShellCommand(context);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    if (result?.ok !== false && before) {
      const after = await changeTracker.capture(params.path);
      const change = changeTracker.record({
        toolName: name,
        args: params,
        before,
        after,
        diff: result.diff
      });
      if (change) result.change_id = change.id;
    }
    return result;
  };
}
