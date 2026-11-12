#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const desktopSrc = join(repoRoot, "packages", "web", "src");

const SAFE_SUBPATHS = new Map([
  ["@spiritagent/ui", new Set(["*"])],
  ["@spiritagent/icons", new Set(["*"])],
  ["@spiritagent/brand", new Set(["*"])],
  ["@spiritagent/product", new Set(["*"])],
  ["@spiritagent/i18n", new Set(["*"])],
  ["@spiritagent/remote-control", new Set(["*"])],
  [
    "@spiritagent/api",
    new Set([
      "types",
      "host-api",
      "commands",
      "command-payloads",
      "work-location",
      "local-file-composer-route",
      "workspace-file-reference-query",
      "approval-level",
      "workspace-trust",
      "github",
      "tasks",
      "automations",
      "remote-control",
    ]),
  ],
  ["@spiritagent/instructions", new Set(["skill-paths"])],
  ["@spiritagent/sessions", new Set(["background-task-path"])],
  ["@spiritagent/tools", new Set(["tool-output-archive-path"])],
  ["@spiritagent/tasks", new Set([undefined, "runtime"])],
  [
    "@spiritagent/github",
    new Set([
      "pull-request-url",
      "pull-request-checks-pages",
      "pull-request-conversation-pages",
      "types",
    ]),
  ],
  ["@spiritagent/code-completion", new Set(["monaco", "delete-diff-preview"])],
]);

function collectSourceFiles(entryPath) {
  const stat = statSync(entryPath);
  if (stat.isFile() && /\.(tsx?|mts|d\.ts)$/u.test(entryPath)) {
    return [entryPath];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(entryPath)) {
    const childPath = join(entryPath, name);
    if (childPath === join(desktopSrc, "host")) {
      continue;
    }
    files.push(...collectSourceFiles(childPath));
  }
  return files;
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const violations = [];
  const imports = content.matchAll(
    /(?:from\s+|import\()['"]@spiritagent\/([a-z0-9-]+)(?:\/([^'"]+))?['"]/gu,
  );
  for (const match of imports) {
    const packageName = match[1];
    if (packageName === "agent-core") {
      continue;
    }
    const line = content.slice(0, match.index).split(/\r?\n/u).length;
    const importStart = Math.max(0, content.lastIndexOf("\n", match.index) + 1);
    const isTypeOnly = /^\s*import\s+type\s+/u.test(content.slice(importStart, match.index));
    if (isTypeOnly) {
      continue;
    }
    const allowed = SAFE_SUBPATHS.get(`@spiritagent/${packageName}`);
    const subpath = match[2];
    if (!allowed || (!allowed.has("*") && !allowed.has(subpath))) {
      violations.push({
        file: relative(repoRoot, filePath),
        line,
        reason: `renderer import @spiritagent/${packageName}${subpath ? `/${subpath}` : ""} is not allowed`,
      });
    }
  }
  if (content.includes("apps/desktop/src/host")) {
    violations.push({
      file: relative(repoRoot, filePath),
      line: 1,
      reason: "renderer must not import the Electron host",
    });
  }
  return violations;
}

const violations = collectSourceFiles(desktopSrc).flatMap(scanFile);
if (violations.length > 0) {
  console.error("renderer boundary check failed:\n");
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line} — ${item.reason}`);
  }
  process.exit(1);
}

console.log("renderer boundary check passed");
