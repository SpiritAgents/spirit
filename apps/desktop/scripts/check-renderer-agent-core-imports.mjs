#!/usr/bin/env node
/**
 * The Desktop renderer may only do value imports from agent-core's renderer-safe subpaths.
 * A value import of the main entry @spiritagent/agent-core pulls in the AI SDK / Node dependency chain.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const desktopSrc = join(repoRoot, "apps", "desktop", "src");

/** agent-core subpaths allowed for value import (must have zero transitive Node dependencies). */
const RENDERER_SAFE_AGENT_CORE_SUBPATHS = new Set([
  "reasoning-effort",
  "shell-tool-result",
  "code-completion-to-monaco",
  "code-completion-delete-diff",
  "model-thinking-controls",
  "model-service-tier",
]);

const RENDERER_SCAN_ROOTS = ["components", "hooks", "lib", "App.tsx"];

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]@spiritagent\/agent-core(?:\/([^'"]+))?['"]/gu;

function collectSourceFiles(entryPath) {
  const stat = statSync(entryPath);
  if (stat.isFile() && /\.(tsx?|mts)$/u.test(entryPath)) {
    return [entryPath];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(entryPath)) {
    files.push(...collectSourceFiles(join(entryPath, name)));
  }
  return files;
}

function isTypeOnlyImport(line) {
  return /^\s*import\s+type\s+/u.test(line);
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/u);
  const violations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("@spiritagent/agent-core")) {
      continue;
    }
    if (isTypeOnlyImport(line)) {
      continue;
    }

    for (const match of line.matchAll(IMPORT_RE)) {
      const subpath = match[1];
      if (!subpath) {
        violations.push({
          file: relative(repoRoot, filePath),
          line: index + 1,
          reason: "value import from the @spiritagent/agent-core main entry is not allowed",
        });
        continue;
      }
      if (!RENDERER_SAFE_AGENT_CORE_SUBPATHS.has(subpath)) {
        violations.push({
          file: relative(repoRoot, filePath),
          line: index + 1,
          reason: `subpath "${subpath}" is not in the renderer-safe allowlist`,
        });
      }
    }
  }

  return violations;
}

const files = RENDERER_SCAN_ROOTS.flatMap((entry) => collectSourceFiles(join(desktopSrc, entry)));

const violations = files.flatMap(scanFile);

if (violations.length > 0) {
  console.error("renderer agent-core import check failed:\n");
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line} — ${item.reason}`);
  }
  process.exit(1);
}

console.log("renderer agent-core import check passed");
