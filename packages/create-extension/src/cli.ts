#!/usr/bin/env node
/**
 * create-extension CLI (npm create @spiritagent/extension). Thin shell:
 * argument parsing, wizard-vs-flags decision, result printing. The scaffolding
 * itself lives in init.ts.
 *
 * Output uses process.stdout/stderr.write directly: the repo lints
 * console.log out of packages, and explicit streams give exact control.
 */

import path from "node:path";
import { parseArgs } from "node:util";

import { initExtension } from "./init.js";
import { parseCapabilitiesFlag, promptForInitOptions } from "./prompts.js";

const USAGE = `Usage: create-extension [target-dir] [options]

Options:
  --name <name>            Extension name (kebab-case)
  --display-name <name>    Display name (default: derived from the name)
  --description <text>     One-line description
  --capabilities <list>    Comma-separated capability ids: skills, rules, mcp,
                           hooks, tools, desktop-css, desktop-settings-page,
                           system-prompt
  -y, --yes                Skip the confirmation prompt
  -h, --help               Show this help

Without --name, an interactive wizard collects the missing options (TTY only).
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      name: { type: "string" },
      "display-name": { type: "string" },
      description: { type: "string" },
      capabilities: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const targetDir = path.resolve(positionals[0] ?? values.name ?? ".");
  const capabilities = values.capabilities
    ? parseCapabilitiesFlag(values.capabilities)
    : undefined;

  const interactive = process.stdout.isTTY && (!values.name || capabilities === undefined);
  if (!interactive && !values.name) {
    process.stderr.write(`Missing --name (no TTY for the wizard).\n\n${USAGE}`);
    return 1;
  }

  const options = interactive
    ? await promptForInitOptions({
        ...(values.name ? { name: values.name } : {}),
        ...(values["display-name"] ? { displayName: values["display-name"] } : {}),
        ...(values.description ? { description: values.description } : {}),
        ...(capabilities ? { capabilities } : {}),
        ...(values.yes ? { skipConfirmation: true } : {}),
      })
    : {
        name: values.name ?? "",
        ...(values["display-name"] ? { displayName: values["display-name"] } : {}),
        ...(values.description ? { description: values.description } : {}),
        capabilities: capabilities ?? [],
      };

  const result = await initExtension({ ...options, targetDir });

  process.stdout.write(
    `Created ${result.targetDir}:\n${result.filesWritten.map((file) => `  ${file}`).join("\n")}\n\n` +
      `Registry entry snippet (hand to your marketplace registry):\n${JSON.stringify(result.registryEntry, null, 2)}\n`,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
