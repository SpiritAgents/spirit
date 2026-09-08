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
import { publishExtension } from "./publish.js";

const USAGE = `Usage: extension-toolkit <command> [path]

Commands:
  init [target-dir]        Scaffold a new extension (wizard or flags; run
                           with -h for the full option list)
  check [dir]              Validate an extension package directory (or an
                           installed extension with .spirit/extension.json)
  pack [dir]               Pack an extension directory into a distributable
                           <name>-<version>.zip (runs check first)
  publish [dir] <marketplace-dir>
                           Publish an extension into a marketplace registry:
                           upsert the marketplace.json entry and copy the
                           content its source needs (runs check first)
  marketplace check [dir]  Validate a marketplace registry (registry CI)

Publish options:
  --source <local|npm>     Entry source: local copies the full package into
                           extensions/<name>/ (default); npm pins name@version
                           from package.json and copies only the declared icon
  --dry-run                Print the planned entry and actions without
                           writing anything

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
    options: {
      help: { type: "boolean", short: "h", default: false },
      source: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
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

  if (command === "publish") {
    const marketplaceArg = rest[1];
    if (marketplaceArg === undefined) {
      process.stderr.write(`error: publish needs a target marketplace directory.\n\n${USAGE}`);
      return 1;
    }
    const source = values.source ?? "local";
    if (source !== "local" && source !== "npm") {
      process.stderr.write(`error: --source must be "local" or "npm", got: ${values.source}\n`);
      return 1;
    }
    const marketplaceDir = path.resolve(marketplaceArg);
    try {
      const result = await publishExtension(path.resolve(rest[0] ?? "."), marketplaceDir, {
        source,
        dryRun: values["dry-run"],
      });
      const sourceLabel =
        result.sourceKind === "npm" && typeof result.entry.source !== "string"
          ? `npm ${result.entry.source.package}`
          : "local";
      const upsertLabel = result.replacedExisting
        ? `${result.dryRun ? "replace" : "replaced"} the existing entry (reviewStatus "${result.entry.reviewStatus}")`
        : `${result.dryRun ? "append" : "appended"} a new entry (reviewStatus "${result.entry.reviewStatus}")`;
      const contentLabel = result.contentAlreadyInPlace
        ? `content already in place at ${result.contentDirRelative}`
        : result.copiedFiles.length > 0
          ? result.dryRun
            ? `would copy ${result.copiedFiles.length} file(s) to ${result.contentDirRelative}`
            : `${result.copiedFiles.length} file(s) copied to ${result.contentDirRelative}`
          : "no content files";
      if (result.dryRun) {
        process.stdout.write(
          `Would publish ${result.entry.name}@${result.entry.version} to ${marketplaceDir}\n` +
            `  source: ${sourceLabel}\n` +
            `  upsert: ${upsertLabel}\n` +
            `  content: ${contentLabel}\n` +
            `  entry:\n${JSON.stringify(result.entry, null, 2)}\n`,
        );
        return 0;
      }
      process.stdout.write(
        `Published ${result.entry.name}@${result.entry.version} to ${marketplaceDir} (${sourceLabel}; ${upsertLabel}; ${contentLabel})\n`,
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
