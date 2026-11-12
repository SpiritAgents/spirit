import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  developmentRestartWatchDirs,
  workbenchRuntimePackageNames,
} from "../scripts/dev-reload-graph.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

test("runtime restart watches cover the Workbench domain graph", () => {
  const names = workbenchRuntimePackageNames(repoRoot);
  for (const name of [
    "@spiritagent/api",
    "@spiritagent/automations",
    "@spiritagent/code-completion",
    "@spiritagent/config",
    "@spiritagent/extensions",
    "@spiritagent/github",
    "@spiritagent/hooks",
    "@spiritagent/http",
    "@spiritagent/i18n",
    "@spiritagent/instructions",
    "@spiritagent/lsp",
    "@spiritagent/mcp",
    "@spiritagent/permissions",
    "@spiritagent/process",
    "@spiritagent/remote-control",
    "@spiritagent/sessions",
    "@spiritagent/tasks",
    "@spiritagent/tools",
    "@spiritagent/workbench",
    "@spiritagent/workspace",
  ]) {
    assert.ok(names.includes(name), `${name} must restart Electron after its dist changes`);
  }

  for (const name of [
    "@spiritagent/brand",
    "@spiritagent/icons",
    "@spiritagent/ui",
    "@spiritagent/web",
  ]) {
    assert.ok(!names.includes(name), `${name} should remain on the Vite source path`);
  }

  const dirs = developmentRestartWatchDirs(desktopRoot, repoRoot);
  assert.ok(dirs.includes(path.join(desktopRoot, "dist-electron")));
  assert.ok(dirs.includes(path.join(repoRoot, "packages", "github", "dist")));
  assert.ok(dirs.includes(path.join(repoRoot, "packages", "instructions", "dist")));
  assert.ok(dirs.includes(path.join(repoRoot, "packages", "tasks", "dist")));
  assert.ok(dirs.includes(path.join(repoRoot, "packages", "tools", "dist")));
  assert.ok(dirs.includes(path.join(repoRoot, "packages", "workbench", "dist")));
});

test("development package watching does not rebuild the production renderer", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  const script = manifest.scripts["watch:packages"];
  assert.match(script, /--filter=@spiritagent\/workbench\.\.\./u);
  assert.match(script, /--filter=!@spiritagent\/web(?:\s|$)/u);
});
