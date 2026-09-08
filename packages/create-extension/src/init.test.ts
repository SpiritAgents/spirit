import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { parseExtensionDumpText } from "@spiritagent/extension-toolkit";

import { initExtension, type InitExtensionOptions } from "./init.js";
import { parseCapabilitiesFlag } from "./prompts.js";

const targetDirs: string[] = [];

async function targetDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "create-extension-test-"));
  targetDirs.push(dir);
  return path.join(dir, "my-ext");
}

async function scaffold(
  overrides: Partial<InitExtensionOptions> & { name?: string } = {},
): Promise<{ dir: string; files: Record<string, string> }> {
  const dir = await targetDir();
  const result = await initExtension({
    name: "my-ext",
    capabilities: [],
    targetDir: dir,
    ...overrides,
  });
  const files: Record<string, string> = {};
  for (const relativePath of result.filesWritten) {
    files[relativePath] = await readFile(path.join(dir, ...relativePath.split("/")), "utf8");
  }
  return { dir, files };
}

afterEach(async () => {
  await Promise.all(targetDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("skills + rules scaffold valid files and a consistent dump", async () => {
  const { files } = await scaffold({ capabilities: ["skills", "rules"] });

  const skill = files["skills/my-ext/SKILL.md"];
  assert.ok(skill?.startsWith("---\nname: my-ext\ndescription:"));
  assert.ok(files["rule.md"]?.includes("My Ext Rules"));

  const dump = parseExtensionDumpText(files[".spirit/extension.json"] ?? "");
  assert.equal(dump.name, "my-ext");
  assert.equal(dump.sourceId, "self-declared");
  assert.deepEqual(dump.manifest.requestedCapabilities, ["skills", "rules"]);
  assert.deepEqual(dump.manifest.contributes, { skills: true, rules: true });
});

test("tools scaffold a main module with a handler and matching declaration", async () => {
  const { files } = await scaffold({ capabilities: ["tools"] });

  assert.ok(files["index.mjs"]?.includes("export const tools"));
  // The host refuses to activate a module without an activate export.
  assert.ok(files["index.mjs"]?.includes("export function activate"));
  const packageJson = JSON.parse(files["package.json"] ?? "{}");
  assert.equal(packageJson.main, "index.mjs");

  const dump = parseExtensionDumpText(files[".spirit/extension.json"] ?? "");
  assert.deepEqual(dump.manifest.requestedCapabilities, ["tool-definitions", "tool-execution"]);
  const tools = (dump.manifest.contributes as { tools: Array<{ name: string }> }).tools;
  assert.equal(tools[0]?.name, "hello");
});

test("desktop css and settings page merge into one desktop contribution", async () => {
  const { files } = await scaffold({ capabilities: ["desktop-css", "desktop-settings-page"] });

  const dump = parseExtensionDumpText(files[".spirit/extension.json"] ?? "");
  assert.deepEqual(dump.manifest.requestedCapabilities, ["desktop-ui"]);
  assert.deepEqual(dump.manifest.contributes, {
    desktop: { css: [{ path: "styles.css" }], settingsPage: { title: "My Ext" } },
  });
  assert.ok(files["styles.css"]?.includes("My Ext"));
});

test("system-prompt scaffolds the main module export", async () => {
  const { files } = await scaffold({ capabilities: ["system-prompt"] });
  assert.ok(files["index.mjs"]?.includes("export const systemPrompt"));
  assert.ok(files["index.mjs"]?.includes("export function activate"));
  const dump = parseExtensionDumpText(files[".spirit/extension.json"] ?? "");
  assert.deepEqual(dump.manifest.requestedCapabilities, ["system-prompt"]);
});

test("mcp and hooks scaffold parseable config files", async () => {
  const { files } = await scaffold({ capabilities: ["mcp", "hooks"] });
  const mcp = JSON.parse(files["mcp.json"] ?? "{}");
  assert.equal(mcp.servers.example.type, "stdio");
  // The referenced stdio server entry must exist.
  assert.ok(files["server.mjs"]?.includes("tools/list"));
  const hooks = JSON.parse(files["hooks.json"] ?? "{}");
  assert.equal(hooks.version, 1);
  assert.ok(Array.isArray(hooks.hooks.sessionStart));
  // The hook command is a script path inside the extension, not inline shell.
  assert.equal(hooks.hooks.sessionStart[0]?.command, "hooks/session-start.sh");
  assert.ok(files["hooks/session-start.sh"]?.startsWith("#!/bin/sh"));
});

test("hook scripts scaffold as executable on POSIX hosts", async () => {
  if (process.platform === "win32") {
    return;
  }
  const { dir } = await scaffold({ capabilities: ["hooks"] });
  const script = await stat(path.join(dir, "hooks", "session-start.sh"));
  assert.ok(script.mode & 0o111, "hook script should carry the executable bit");
});

test("an invalid extension name is rejected with the toolkit rule", async () => {
  await assert.rejects(
    initExtension({ name: "Not Kebab", capabilities: [], targetDir: await targetDir() }),
    /kebab-case/,
  );
});

test("a non-empty target directory is rejected", async () => {
  const dir = await targetDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "existing.txt"), "occupied", "utf8");
  await assert.rejects(
    initExtension({ name: "my-ext", capabilities: [], targetDir: dir }),
    /not empty/,
  );
});

test("defaults: title-cased display name, TODO description, minimal package", async () => {
  const { files } = await scaffold();
  const dump = parseExtensionDumpText(files[".spirit/extension.json"] ?? "");
  assert.equal(dump.displayName, "My Ext");
  assert.match(dump.description, /^TODO:/);
  // The scaffold carries example author/keywords/homepage so the fields are discoverable.
  assert.deepEqual(dump.author, { name: "Your Name", email: "you@example.com" });
  assert.deepEqual(dump.keywords, ["spirit-extension"]);
  assert.equal(dump.homepage, "https://example.com/my-ext");
  assert.equal(dump.manifest.contributes, undefined);
  assert.equal(files["index.mjs"], undefined);
  assert.ok(files["icon.svg"]);
});

test("the registry entry snippet mirrors the dump identity", async () => {
  const dir = await targetDir();
  const result = await initExtension({
    name: "my-ext",
    capabilities: ["skills"],
    targetDir: dir,
  });
  const entry = result.registryEntry as Record<string, unknown>;
  assert.equal(entry.name, "my-ext");
  assert.equal(entry.source, "./extensions/my-ext");
  assert.equal(entry.reviewStatus, "unverified");
  assert.deepEqual(entry.author, { name: "Your Name", email: "you@example.com" });
  assert.deepEqual(entry.keywords, ["spirit-extension"]);
  assert.equal(entry.homepage, "https://example.com/my-ext");
  const manifest = entry.manifest as { requestedCapabilities?: string[] };
  assert.deepEqual(manifest.requestedCapabilities, ["skills"]);
});

test("parseCapabilitiesFlag validates and de-duplicates", () => {
  assert.deepEqual(parseCapabilitiesFlag("skills, rules,skills"), ["skills", "rules"]);
  assert.throws(() => parseCapabilitiesFlag("skills,nope"), /Unknown capability/);
});
