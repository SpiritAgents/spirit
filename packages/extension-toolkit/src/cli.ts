#!/usr/bin/env node
/**
 * extension-toolkit CLI. Thin shell over the command modules: argument
 * parsing, output, exit codes. oxlint-style contract for CI: findings on
 * stdout, one per line, non-zero exit when any finding exists.
 *
 * Output uses process.stdout/stderr.write directly: the repo lints
 * console.log out of packages, and explicit streams give exact control.
 */

import path from "node:path";
import { parseArgs } from "node:util";

import { checkMarketplaceRegistry } from "./check-marketplace.js";
import { checkExtensionPackage, type CheckFinding } from "./check-package.js";
import { runInitCommand } from "./cli-init.js";
import { packExtension } from "./pack.js";

const USAGE = `Usage: extension-toolkit <command> [path]

Commands:
  init [target-dir]        Scaffold a new extension (wizard or flags; run
                           with -h for the full option list)
  check [dir]              Validate an extension package directory (or an
                           installed extension with .spirit/extension.json)
  pack [dir]               Pack an extension directory into a distributable
                           <name>-<version>.zip (runs check first)
  marketplace check [dir]  Validate a marketplace registry (registry CI)

Options:
  -h, --help               Show this help
`;

function printFindings(findings: CheckFinding[]): number {
  for (const finding of findings) {
    process.stdout.write(`${finding.path}: ${finding.message}\n`);
  }
  if (findings.length > 0) {
    process.stdout.write(`error: ${findings.length} finding(s)\n`);
    return 1;
  }
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // init delegates raw args: create-extension owns its flags, and strict
  // parsing here would reject them.
  if (argv[0] === "init") {
    return runInitCommand(argv.slice(1));
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h", default: false } },
  });

  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    process.stdout.write(USAGE);
    return command === undefined && !values.help ? 1 : 0;
  }

  if (command === "check") {
    const target = path.resolve(rest[0] ?? ".");
    return printFindings(await checkExtensionPackage(target));
  }

  if (command === "marketplace" && rest[0] === "check") {
    const target = path.resolve(rest[1] ?? ".");
    return printFindings(await checkMarketplaceRegistry(target));
  }

  if (command === "pack") {
    const target = path.resolve(rest[0] ?? ".");
    try {
      const result = await packExtension(target, process.cwd());
      process.stdout.write(
        `Wrote ${result.zipPath} (${result.fileCount} files, ${result.name}@${result.version})\n`,
      );
      return 0;
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  process.stderr.write(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
  return 1;
}

process.exitCode = await main();
