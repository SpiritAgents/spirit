#!/usr/bin/env node
/**
 * create-extension bin (npm create @spiritagent/extension). All logic lives in
 * run-cli.ts so the extension-toolkit CLI can delegate to the same entry.
 */

import { runCreateExtensionCli } from "./run-cli.js";

process.exitCode = await runCreateExtensionCli(process.argv.slice(2));
