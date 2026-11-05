import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  buildShellToolResult,
  combineShellToolOutput,
  serializeShellToolResult,
} from "@spiritagent/agent-core";

import { runShell } from "./shell-execution.js";
import { spawn } from "node:child_process";

test("runShell streams stdout chunks and returns combined output", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-exec-"));
  const chunks: string[] = [];

  try {
    const { result: resultPromise } = runShell({
      workspaceRoot,
      command: 'printf "line1\\n"; printf "line2\\n"',
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    const result = await resultPromise;

    assert.equal(result.exitCode, 0);
    assert.equal(combineShellToolOutput(result.stdout, result.stderr), "line1\nline2\n");
    assert.ok(chunks.length > 0);
    assert.equal(chunks.join(""), "line1\nline2\n");

    const serialized = serializeShellToolResult(
      buildShellToolResult({
        terminal: "test",
        workspace: workspaceRoot,
        command: "printf",
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    );
    const parsed = JSON.parse(serialized) as { output: string; exitCode: number };
    assert.equal(parsed.exitCode, 0);
    assert.equal(parsed.output, "line1\nline2\n");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runShell reports non-zero exit code", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-exec-fail-"));

  try {
    const { result: resultPromise } = runShell({
      workspaceRoot,
      command: "exit 7",
    });
    const result = await resultPromise;

    assert.equal(result.exitCode, 7);
    assert.equal(combineShellToolOutput(result.stdout, result.stderr), "");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runShell merges stderr into streamed chunks", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-exec-err-"));
  const chunks: string[] = [];

  try {
    const { result: resultPromise } = runShell({
      workspaceRoot,
      command: 'printf "out\\n" 1>&2; printf "ok\\n"',
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    const result = await resultPromise;

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "out\n");
    assert.equal(result.stdout, "ok\n");
    assert.ok(chunks.join("").includes("out"));
    assert.ok(chunks.join("").includes("ok"));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runShell kill terminates a long-running child", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-exec-kill-"));

  try {
    const handle = runShell({
      workspaceRoot,
      command: "sleep 30",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    handle.kill();
    const result = await handle.result;
    assert.equal(result.exitCode, null);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runShell preserves UTF-8 across byte boundaries and delivers output beyond the retained result limit", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-complete-"));
  try {
    const chunks: string[] = [];
    const unicode = await runShell({
      workspaceRoot,
      command: "printf '\\360'; sleep 0.02; printf '\\237'; sleep 0.02; printf '\\231\\202'",
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
      },
    }).result;
    assert.equal(unicode.stdout, "🙂");
    assert.equal(chunks.join(""), "🙂");
    let received = 0;
    let writing = false;
    const large = await runShell({
      workspaceRoot,
      command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(9*1024*1024))"`,
      maxOutputBytes: 1024,
      onOutputChunk: async (chunk) => {
        assert.equal(writing, false);
        writing = true;
        await Promise.resolve();
        received += Buffer.byteLength(chunk);
        writing = false;
      },
    }).result;
    assert.equal(received, 9 * 1024 * 1024);
    assert.equal(large.stdout.length, 1024);
    assert.equal(large.truncated, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runShell stops and rejects when the output sink fails", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-io-"));
  try {
    const handle = runShell({
      workspaceRoot,
      command: 'printf "first"; sleep 30',
      onOutputChunk: async () => {
        throw new Error("task output disk full");
      },
    });
    await assert.rejects(handle.result, /task output disk full/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "the shell supervisor reaps descendants when its host dies",
  async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-owner-"));
    const leaf = "console.log(process.pid); setTimeout(() => {}, 10000)";
    const nested = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:'inherit'}); setTimeout(()=>{},10000)`;
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(nested)}`;
    const moduleUrl = new URL("../dist/shell-execution.js", import.meta.url).href;
    const owner = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
        import {runShell} from ${JSON.stringify(moduleUrl)};
        await runShell({
          workspaceRoot: ${JSON.stringify(workspaceRoot)},
          command: ${JSON.stringify(command)},
          onOutputChunk: chunk => { process.stdout.write(chunk); },
        }).result;
      `,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ownedPid: number | undefined;
    try {
      ownedPid = await new Promise<number>((resolve, reject) => {
        let text = "";
        let errors = "";
        const timeout = setTimeout(
          () => reject(new Error(`Shell child did not start: ${errors}`)),
          2500,
        );
        owner.stderr.on("data", (chunk) => {
          errors += String(chunk);
        });
        owner.stdout.on("data", (chunk) => {
          text += String(chunk);
          if (/^\d+\n/u.test(text)) {
            clearTimeout(timeout);
            resolve(Number(text.split("\n")[0]));
          }
        });
        owner.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        owner.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error(`Shell owner exited before its child started: ${errors}`));
        });
      });
      owner.kill("SIGKILL");
      const gone = (): boolean => {
        try {
          process.kill(ownedPid!, 0);
          return false;
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ESRCH") return true;
          throw error;
        }
      };
      for (let attempt = 0; attempt < 100 && !gone(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(gone(), true);
      ownedPid = undefined;
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
      if (ownedPid) {
        try {
          process.kill(ownedPid, "SIGKILL");
        } catch (error) {
          assert.ok(
            error instanceof Error && "code" in error && error.code === "ESRCH",
            `Could not stop the owned test process: ${String(error)}`,
          );
        }
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
);
