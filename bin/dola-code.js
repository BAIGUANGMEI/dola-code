#!/usr/bin/env node

import { runCli } from "../src/cli/session.js";

runCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
