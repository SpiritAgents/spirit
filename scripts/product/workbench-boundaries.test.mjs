import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const domains = [
  "api",
  "automations",
  "code-completion",
  "config",
  "extensions",
  "github",
  "hooks",
  "http",
  "i18n",
  "instructions",
  "lsp",
  "mcp",
  "permissions",
  "process",
  "remote-control",
  "sessions",
  "tasks",
  "tools",
  "web",
  "workbench",
  "workspace",
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(target);
  }
  return files;
}

test("Workbench domains do not depend on Electron", async () => {
  const violations = [];
  for (const domain of domains) {
    for (const file of await sourceFiles(path.join(root, "packages", domain, "src"))) {
      const source = await readFile(file, "utf8");
      if (/import\(["']electron["']\)|from ["']electron["']/.test(source)) {
        violations.push(path.relative(root, file));
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("the Web renderer does not import Node builtins", async () => {
  const violations = [];
  for (const file of await sourceFiles(path.join(root, "packages", "web", "src"))) {
    const source = await readFile(file, "utf8");
    if (/from ["']node:/.test(source) || /import\(["']node:/.test(source)) {
      violations.push(path.relative(root, file));
    }
  }
  assert.deepEqual(violations, []);
});
