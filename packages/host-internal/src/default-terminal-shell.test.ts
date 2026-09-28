import assert from "node:assert/strict";
import { exec as execCallback } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";
import { promisify } from "node:util";

import {
  decodeShellHostOutput,
  defaultShellForPty,
  isWindowsPowerShellExecutable,
  prepareShellForHostExecution,
  shellDisplayNameForResolvedShell,
  shellHostExecUsesBufferOutput,
  shellRunCommandArgs,
} from "./default-terminal-shell.js";
import { detectShellForTools } from "./tools.js";

const exec = promisify(execCallback);

test.skipIf(process.platform !== "win32")(
  "defaultShellForPty: Windows prefers pwsh or powershell, not just cmd",
  () => {
    const prev = process.env.SPIRIT_TERMINAL_SHELL;
    delete process.env.SPIRIT_TERMINAL_SHELL;
    try {
      const { file } = defaultShellForPty();
      assert.ok(existsSync(file), `shell path should exist: ${file}`);
      const base = path.basename(file).toLowerCase();
      assert.ok(
        base === "pwsh.exe" || base === "powershell.exe" || base === "cmd.exe",
        `unexpected shell: ${file}`,
      );
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const pwsh7 = path.join(programFiles, "PowerShell", "7", "pwsh.exe");
      if (existsSync(pwsh7)) {
        assert.equal(path.normalize(file), path.normalize(pwsh7));
      }
    } finally {
      if (prev === undefined) {
        delete process.env.SPIRIT_TERMINAL_SHELL;
      } else {
        process.env.SPIRIT_TERMINAL_SHELL = prev;
      }
    }
  },
);

test.skipIf(process.platform !== "win32")(
  "detectShellForTools: Windows result matches defaultShellForPty resolution",
  () => {
    const prev = process.env.SPIRIT_TERMINAL_SHELL;
    delete process.env.SPIRIT_TERMINAL_SHELL;
    try {
      const { file } = defaultShellForPty();
      const detected = detectShellForTools();
      assert.equal(detected.shellDisplayName, shellDisplayNameForResolvedShell(file));
      const base = path.basename(file).toLowerCase();
      if (base === "pwsh.exe") {
        assert.match(detected.shellDisplayName, /pwsh/i);
      }
      if (base === "cmd.exe") {
        assert.match(detected.shellDisplayName, /cmd/i);
      }
    } finally {
      if (prev === undefined) {
        delete process.env.SPIRIT_TERMINAL_SHELL;
      } else {
        process.env.SPIRIT_TERMINAL_SHELL = prev;
      }
    }
  },
);

test.skipIf(process.platform !== "win32")(
  "prepareShellForHostExecution: PowerShell subprocess can output UTF-8 Chinese",
  async () => {
    const { file } = defaultShellForPty();
    if (!isWindowsPowerShellExecutable(file)) {
      return;
    }
    const sample = "你好，Spirit 中文输出测试";
    const command = prepareShellForHostExecution(file, `Write-Output "${sample}"`);
    const result = await exec(command, {
      shell: file,
      windowsHide: true,
      encoding: "utf8",
    });
    assert.equal(String(result.stdout).trim(), sample);
  },
);

test.skipIf(process.platform !== "win32")(
  "decodeShellHostOutput: cmd subprocess GBK output can be decoded as Chinese",
  async () => {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const cmd = path.join(systemRoot, "System32", "cmd.exe");
    if (!existsSync(cmd)) {
      return;
    }
    const sample = "你好，cmd 中文输出测试";
    const command = prepareShellForHostExecution(cmd, `echo ${sample}`);
    const result = await exec(command, {
      shell: cmd,
      windowsHide: true,
      encoding: "buffer",
    });
    assert.ok(shellHostExecUsesBufferOutput(cmd));
    const stdout = decodeShellHostOutput(cmd, result.stdout as Buffer);
    assert.equal(stdout.trim(), sample);
  },
);

test("shellRunCommandArgs picks the run-command prefix per shell flavor", () => {
  assert.deepEqual(shellRunCommandArgs("/usr/local/bin/pwsh.exe"), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  assert.deepEqual(shellRunCommandArgs("/system/powershell.exe"), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  assert.deepEqual(shellRunCommandArgs("/system/cmd.exe"), ["/d", "/s", "/c"]);
  assert.deepEqual(shellRunCommandArgs("/bin/zsh"), ["-c"]);
  assert.deepEqual(shellRunCommandArgs("/usr/bin/fish"), ["-c"]);
});
