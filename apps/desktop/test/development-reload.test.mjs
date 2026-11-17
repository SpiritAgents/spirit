import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

import {
  developmentNativeSources,
  developmentRuntimeFingerprint,
  developmentRestartWatchDirs,
  workbenchRuntimePackageNames,
} from "../scripts/dev-reload-graph.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const fixtureDirs = [];

afterEach(() => {
  for (const directory of fixtureDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime restart watches cover the Workbench domain graph", () => {
  const names = workbenchRuntimePackageNames(repoRoot);
  for (const name of [
    "@spiritagent/api",
    "@spiritagent/automations",
    "@spiritagent/code-completion",
    "@spiritagent/config",
    "@spiritagent/extensions",
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
    "@spiritagent/github",
    "@spiritagent/brand",
    "@spiritagent/icons",
    "@spiritagent/ui",
    "@spiritagent/web",
  ]) {
    assert.ok(!names.includes(name), `${name} should not be a Workbench runtime dependency`);
  }

  const dirs = developmentRestartWatchDirs(desktopRoot, repoRoot);
  assert.ok(dirs.includes(path.join(desktopRoot, "dist-electron")));
  assert.ok(dirs.includes(path.join(repoRoot, "packages", "extensions", "dist")));
  assert.ok(!dirs.includes(path.join(repoRoot, "packages", "github", "dist")));
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
  assert.match(script, /--only(?:\s|$)/u);

  const dryRunScript = script.replace("turbo watch build", "turbo run build");
  const output = execFileSync(`${dryRunScript} --dry=json`, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true,
  });
  const report = JSON.parse(output.slice(output.indexOf("{")));
  const packages = report.tasks.map((task) => task.package);
  assert.ok(packages.includes("@spiritagent/workbench"));
  assert.ok(!packages.includes("@spiritagent/web"));
});

test("development restart fingerprints only settled runtime changes", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-dev-reload-"));
  fixtureDirs.push(fixture);
  const output = path.join(fixture, "dist");
  fs.mkdirSync(path.join(output, "host"), { recursive: true });
  const runtimeFile = path.join(output, "host", "service.js");
  fs.writeFileSync(runtimeFile, "export const version = 1;\n");
  fs.writeFileSync(path.join(output, "host", "service.d.ts"), "export declare const version: 1;\n");
  fs.writeFileSync(path.join(output, "host", "service.js.map"), "first map");

  const initial = developmentRuntimeFingerprint([output]);
  assert.ok(initial);

  fs.writeFileSync(runtimeFile, "export const version = 1;\n");
  fs.writeFileSync(path.join(output, "host", "service.d.ts"), "export declare const version: 2;\n");
  fs.writeFileSync(path.join(output, "host", "service.js.map"), "second map");
  assert.equal(developmentRuntimeFingerprint([output]), initial);

  fs.rmSync(output, { recursive: true });
  assert.equal(developmentRuntimeFingerprint([output]), undefined);

  fs.mkdirSync(path.join(output, "host"), { recursive: true });
  fs.writeFileSync(runtimeFile, "export const version = 1;\n");
  assert.equal(developmentRuntimeFingerprint([output]), initial);

  fs.writeFileSync(runtimeFile, "export const version = 2;\n");
  assert.notEqual(developmentRuntimeFingerprint([output]), initial);
});

test("native restart fingerprints follow sources instead of linked output bytes", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-dev-native-reload-"));
  fixtureDirs.push(fixture);
  const output = path.join(fixture, "dist");
  fs.mkdirSync(output, { recursive: true });
  const linkedOutput = path.join(output, "spirit_desktop_appkit.node");
  fs.writeFileSync(linkedOutput, "first linked bytes");
  const nativeSource = path.join(fixture, "appkit.mm");
  fs.writeFileSync(nativeSource, "void SpiritBridge() {}\n");

  const initial = developmentRuntimeFingerprint([output], [nativeSource]);
  fs.writeFileSync(linkedOutput, "different linked bytes");
  assert.equal(developmentRuntimeFingerprint([output], [nativeSource]), initial);

  fs.writeFileSync(nativeSource, "void SpiritBridge() { /* changed */ }\n");
  assert.notEqual(developmentRuntimeFingerprint([output], [nativeSource]), initial);

  const sources = developmentNativeSources(desktopRoot);
  for (const source of sources) {
    assert.ok(fs.existsSync(source), `${source} must be a real native build input`);
  }
});
