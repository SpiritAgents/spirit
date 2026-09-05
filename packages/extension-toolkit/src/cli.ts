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

import { checkExtensionPackage, type CheckFinding } from "./check-package.js";

const USAGE = `Usage: extension-toolkit <command> [path]

Commands:
  check [dir]  Validate an extension package directory (or an installed
               extension with .spirit/extension.json)

Options:
  -h, --help   Show this help
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
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
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

  process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
  return 1;
}

process.exitCode = await main();
