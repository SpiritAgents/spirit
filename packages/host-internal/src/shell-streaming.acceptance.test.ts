import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { NodeHostToolService } from "./tools.js";

test("NodeHostToolService streams incremental shell output via attachRequestMetadata", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-accept-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const chunks: string[] = [];
  const startMs = Date.now();
  const chunkTimes: number[] = [];

  try {
    await import("node:fs/promises").then((fs) => fs.mkdir(spiritDataDir, { recursive: true }));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );

    assert.equal(
      service.shouldExecuteInBackground?.({
        name: "shell",
        command: 'printf "a\\n"; sleep 0.15; printf "b\\n"',
        reason: "acceptance",
      }),
      true,
    );

    const request = {
      name: "shell" as const,
      command: 'printf "a\\n"; sleep 0.15; printf "b\\n"',
      reason: "acceptance",
    };
    service.attachRequestMetadata?.(request, {
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
        chunkTimes.push(Date.now() - startMs);
      },
    });

    const output = await service.execute(request);
    assert.ok(typeof output === "object");
    assert.ok(chunks.join("").includes("a"));
    assert.ok(chunks.join("").includes("b"));
    assert.ok(chunkTimes.length >= 1);
    if (chunkTimes.length >= 2) {
      assert.ok(chunkTimes[1]! >= chunkTimes[0]!);
    }
    assert.match(output.summaryText, /"exitCode":0/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("NodeHostToolService.abortRunningShell kills in-flight shell", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-shell-abort-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await import("node:fs/promises").then((fs) => fs.mkdir(spiritDataDir, { recursive: true }));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );

    const request = {
      name: "shell" as const,
      command: "sleep 30",
      reason: "abort-test",
    };
    // Kill registration requires a toolCallId (production attaches one per tool call).
    service.attachRequestMetadata?.(request, { toolCallId: "abort-test" });

    const execution = service.execute(request);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    service.abortRunningShell();
    const output = await execution;
    assert.ok(typeof output === "object");
    assert.match(output.summaryText, /"exitCode":null/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
