import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import { executeStoredSessionCommand } from "../src/stored-session-service.js";

const execFileAsync = promisify(execFile);

function timeline(content: string) {
  return [
    {
      turnId: 1,
      createdOrder: 1,
      userRow: {
        rowId: "user-1",
        messageId: 1,
        turnId: 1,
        kind: "user",
        createdOrder: 1,
        content,
        pending: false,
      },
      segments: [],
    },
  ];
}

test("CLI overwrite saves preserve pinning and refresh workspace metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spirit-stored-session-"));
  try {
    const workspaceRoot = path.join(root, "workspace");
    const chatPath = path.join(root, "chats", "chat.json");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(path.dirname(chatPath), { recursive: true });
    await execFileAsync("git", ["init", "-b", "fixture"], { cwd: workspaceRoot });
    await writeFile(
      chatPath,
      JSON.stringify({
        chatSchemaVersion: 2,
        llmHistory: [],
        subagentSessions: [],
        desktopMessageTimeline: timeline("Before"),
        savedAtUnixMs: 1,
        pinnedAtUnixMs: 123,
        workspaceRoot: path.join(root, "previous"),
        gitBranch: "previous",
      }),
    );

    await executeStoredSessionCommand(
      "session.saveStored",
      {
        path: chatPath,
        workspaceRoot,
        archive: {
          llmHistory: [],
          subagentSessions: [],
          loopEnabled: false,
          approvalLevel: "default",
          desktopMessageTimeline: timeline("After"),
          sessionDisplayName: "Fixture",
          sessionTitleSource: "seed",
        },
      },
      root,
    );

    const saved = JSON.parse(await readFile(chatPath, "utf8"));
    assert.equal(saved.pinnedAtUnixMs, 123);
    assert.equal(saved.workspaceRoot, workspaceRoot);
    assert.equal(saved.gitBranch, "fixture");
    assert.equal(saved.sessionDisplayName, "Fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
