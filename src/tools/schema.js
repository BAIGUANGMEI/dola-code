export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories under a workspace path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to the workspace root." },
          max_entries: { type: "number", description: "Maximum entries to return. Default 100." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the workspace root." },
          start_line: { type: "number", description: "1-based line to start reading from." },
          end_line: { type: "number", description: "1-based line to stop reading at, inclusive." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search workspace files with ripgrep.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regex pattern to search for." },
          path: { type: "string", description: "Optional path relative to the workspace root." },
          glob: { type: "string", description: "Optional glob filter, such as *.ts." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a workspace text file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the workspace root." },
          content: { type: "string", description: "Full file content to write." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace one exact text fragment in a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the workspace root." },
          find: { type: "string", description: "Exact text to replace. Must occur once unless replace_all is true." },
          replace: { type: "string", description: "Replacement text." },
          replace_all: { type: "boolean", description: "Replace all occurrences. Default false." }
        },
        required: ["path", "find", "replace"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to execute." },
          timeout_ms: { type: "number", description: "Timeout in milliseconds. Default 120000." }
        },
        required: ["command"]
      }
    }
  }
];
