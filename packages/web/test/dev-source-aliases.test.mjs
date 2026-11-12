import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { workspaceSourceAliases } from "../vite.config.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const aliases = workspaceSourceAliases();

function resolveSource(importee) {
  const clean = importee.replace(/\?.*$/u, "");
  for (const alias of aliases) {
    if (alias.find.test(clean)) return clean.replace(alias.find, alias.replacement);
  }
  return undefined;
}

function sourceExists(resolved) {
  return [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.css`,
    `${resolved}.json`,
    path.join(resolved, "index.ts"),
    path.join(resolved, "index.tsx"),
  ].some((candidate) => candidate && fs.existsSync(candidate));
}

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(filePath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [filePath] : [];
  });
}

test("wildcard package exports resolve GitHub presentation modules to source", () => {
  for (const subpath of [
    "pull-request-url",
    "pull-request-checks-pages",
    "pull-request-conversation-pages",
  ]) {
    const resolved = resolveSource(`@spiritagent/github/${subpath}`);
    assert.equal(resolved, path.join(repoRoot, "packages", "github", "src", subpath));
    assert.ok(sourceExists(resolved));
  }
});

test("renderer workspace imports stay on source HMR or explicit static packages", () => {
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["'](@spiritagent\/[^"']+)["']/gu;
  const imports = new Set();
  for (const filePath of collectSourceFiles(path.join(webRoot, "src"))) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const match of content.matchAll(importPattern)) imports.add(match[1]);
  }

  assert.ok(imports.size > 50);
  for (const importee of imports) {
    if (
      importee === "@spiritagent/product" ||
      importee === "@spiritagent/brand" ||
      importee.startsWith("@spiritagent/brand/")
    ) {
      continue;
    }
    const resolved = resolveSource(importee);
    assert.ok(resolved, `${importee} must have a development source alias`);
    assert.ok(sourceExists(resolved), `${importee} must resolve to an existing source file`);
  }
});
