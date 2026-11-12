import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "vitest";

import { rgPath } from "@vscode/ripgrep";

import {
  SPIRIT_RG_BIN_DIR_ENV,
  SPIRIT_RG_PATH_ENV,
  SPIRIT_SHELL_USE_BUNDLED_RG_ENV,
  buildAgentShellEnvironment,
  resolveBundledRipgrepPath,
} from "./bundled-ripgrep-env.js";
import { runShell } from "./shell-execution.js";

function pathSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

function resolvePathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") {
    return "PATH";
  }
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

test("resolveBundledRipgrepPath returns bundled rg when available", () => {
  const resolved = resolveBundledRipgrepPath({});
  assert.equal(resolved, rgPath);
});

test("buildAgentShellEnvironment prepends bundled rg bin dir to PATH", () => {
  const baseEnv = { PATH: "/usr/bin:/bin" };
  const env = buildAgentShellEnvironment(baseEnv);
  const pathKey = resolvePathEnvKey(env);
  const binDir = env[SPIRIT_RG_BIN_DIR_ENV];
  const rgExecutable = env[SPIRIT_RG_PATH_ENV];

  assert.ok(binDir);
  assert.ok(rgExecutable);
  assert.equal(env[pathKey]?.startsWith(`${binDir}${pathSeparator()}`), true);
});

test("buildAgentShellEnvironment skips injection when SPIRIT_SHELL_USE_BUNDLED_RG=0", () => {
  const baseEnv = {
    PATH: "/usr/bin:/bin",
    [SPIRIT_SHELL_USE_BUNDLED_RG_ENV]: "0",
  };
  const env = buildAgentShellEnvironment(baseEnv);
  const pathKey = resolvePathEnvKey(env);

  assert.equal(env[pathKey], "/usr/bin:/bin");
  assert.equal(env[SPIRIT_RG_PATH_ENV], undefined);
  assert.equal(env[SPIRIT_RG_BIN_DIR_ENV], undefined);
});

test("buildAgentShellEnvironment respects external SPIRIT_RG_PATH override", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "spirit-rg-override-"));
  const fakeRg = join(tempDir, process.platform === "win32" ? "rg.exe" : "rg");

  try {
    await writeFile(fakeRg, "#!/bin/sh\n", "utf8");
    const baseEnv = {
      PATH: "/usr/bin",
      [SPIRIT_RG_PATH_ENV]: fakeRg,
    };
    const env = buildAgentShellEnvironment(baseEnv);

    assert.equal(env[SPIRIT_RG_PATH_ENV], fakeRg);
    assert.equal(env[SPIRIT_RG_BIN_DIR_ENV], tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("buildAgentShellEnvironment does not duplicate bin dir when already first in PATH", () => {
  const binDir = dirname(rgPath);
  const baseEnv = { PATH: `${binDir}${pathSeparator()}/usr/bin` };
  const env = buildAgentShellEnvironment(baseEnv);
  const pathKey = resolvePathEnvKey(env);

  assert.equal(env[pathKey], baseEnv.PATH);
  assert.equal(env[SPIRIT_RG_PATH_ENV], rgPath);
  assert.equal(env[SPIRIT_RG_BIN_DIR_ENV], binDir);
});

test("runShell resolves rg from bundled PATH", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-rg-"));
  const locateCommand = process.platform === "win32" ? "where rg" : "command -v rg";

  try {
    const { result: versionResult } = runShell({
      workspaceRoot,
      command: "rg --version",
    });
    const version = await versionResult;

    assert.equal(version.exitCode, 0);
    assert.match(version.stdout, /ripgrep/i);

    const { result: locateResult } = runShell({
      workspaceRoot,
      command: locateCommand,
    });
    const located = await locateResult;

    assert.equal(located.exitCode, 0);
    const resolvedPath = located.stdout.trim().split(/\r?\n/)[0]?.trim();
    assert.equal(resolvedPath, rgPath);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
