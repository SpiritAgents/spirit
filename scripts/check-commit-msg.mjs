#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Looks like `type:` / `type(scope):` / `type!:` — space after `:` is not part of the shape.
const CONVENTIONAL_LIKE = /^[a-z][a-z0-9-]*(\([^)]*\))?!?:/;

export function conventionalSpacingErrors(firstLine) {
  if (!CONVENTIONAL_LIKE.test(firstLine)) {
    return [];
  }

  const errors = [];
  const colon = firstLine.indexOf(":");
  if (colon >= 0 && firstLine[colon + 1] !== " ") {
    errors.push("put a space after ':' (feat: xxx, not feat:xxx)");
  }

  const scopeOpen = firstLine.indexOf("(");
  if (scopeOpen >= 0 && scopeOpen < colon) {
    const scopeClose = firstLine.indexOf(")", scopeOpen + 1);
    if (scopeClose > scopeOpen && scopeClose < colon) {
      const scope = firstLine.slice(scopeOpen + 1, scopeClose);
      if (/,[^ ]/.test(scope)) {
        errors.push("put a space after ',' in a multi-scope list (a, b, not a,b)");
      }
    }
  }

  return errors;
}

function main(argv) {
  const messageFile = argv[2];
  if (!messageFile) {
    console.error("check-commit-msg: commit message file is required");
    process.exit(1);
  }

  let text;
  try {
    text = readFileSync(messageFile, "utf8");
  } catch (error) {
    console.error(
      `check-commit-msg: failed to read ${messageFile} (${error instanceof Error ? error.message : error})`,
    );
    process.exit(1);
  }

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const errors = conventionalSpacingErrors(firstLine);
  if (errors.length === 0) {
    return;
  }

  for (const error of errors) {
    console.error(`check-commit-msg: ${error}`);
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main(process.argv);
}
