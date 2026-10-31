import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  discoverAllLspProviders,
  discoverLspProvider,
  findLspProvider,
  LSP_PROVIDERS,
  routeLspProviderForExtension,
  routeLspProviderForPath,
} from "./providers.js";
import { isLspSupportedPath } from "./paths.js";

async function writeFakePyrightLangserver(
  binDir: string,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "win32") {
    await writeFile(path.join(binDir, "pyright-langserver.cmd"), "@echo off\r\n");
    return;
  }

  const executable = path.join(binDir, "pyright-langserver");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o755);
}

test("LSP_PROVIDERS registers all in-scope language servers", () => {
  const ids = LSP_PROVIDERS.map((provider) => provider.id);
  assert.deepEqual(ids, ["pyright", "gopls", "rust-analyzer", "clangd", "jdtls", "omnisharp"]);
});

test("findLspProvider returns descriptor by id", () => {
  const provider = findLspProvider("pyright");
  assert.equal(provider?.displayName, "Pyright");
});

test("routeLspProviderForExtension maps extensions to providers", () => {
  assert.equal(routeLspProviderForExtension(".ts"), undefined);
  assert.equal(routeLspProviderForExtension("tsx"), undefined);
  assert.equal(routeLspProviderForExtension(".py"), "pyright");
  assert.equal(routeLspProviderForExtension(".go"), "gopls");
  assert.equal(routeLspProviderForExtension(".rs"), "rust-analyzer");
  assert.equal(routeLspProviderForExtension(".cpp"), "clangd");
  assert.equal(routeLspProviderForExtension(".java"), "jdtls");
  assert.equal(routeLspProviderForExtension(".cs"), "omnisharp");
  assert.equal(routeLspProviderForExtension(".html"), undefined);
});

test("routeLspProviderForPath and isLspSupportedPath use file extension", () => {
  assert.equal(routeLspProviderForPath("/workspace/src/main.py"), "pyright");
  assert.equal(isLspSupportedPath("/workspace/src/index.ts"), false);
  assert.equal(isLspSupportedPath("/workspace/src/main.py"), true);
  assert.equal(isLspSupportedPath("/workspace/README.md"), false);
});

test("discoverLspProvider returns not_found when PATH has no server", async () => {
  const result = await discoverLspProvider("pyright", { PATH: "" }, "linux");
  assert.equal(result.status, "not_found");
  assert.equal(result.command, undefined);
});

test("discoverLspProvider returns not_found for providers without PATH match", async () => {
  const result = await discoverLspProvider("gopls", { PATH: "" }, "linux");
  assert.equal(result.status, "not_found");
});

test("discoverLspProvider returns ready when a PATH candidate is executable", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "spirit-lsp-provider-"));
  const platform = process.platform;

  try {
    await writeFakePyrightLangserver(binDir, platform);
    const env =
      platform === "win32" ? { Path: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" } : { PATH: binDir };

    const result = await discoverLspProvider("pyright", env, platform);
    assert.equal(result.status, "ready");
    assert.ok(result.command);
    assert.deepEqual(result.args, ["--stdio"]);
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(binDir, { recursive: true, force: true }));
  }
});

test("discoverAllLspProviders returns one entry per registered provider", async () => {
  const results = await discoverAllLspProviders({ PATH: "" }, "linux");
  assert.equal(results.length, LSP_PROVIDERS.length);
  assert.equal(results[0]?.id, "pyright");
});
