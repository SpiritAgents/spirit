import assert from "node:assert/strict";
import { test } from "vitest";

import { SubagentConversationProjection } from "../../dist-electron/src/host/subagent-conversation-projection.js";
import {
  isWorktreeSubagentSession,
  WORKTREE_BOOTSTRAP_TOOL_NAME,
} from "../../dist-electron/src/host/worktree-bootstrap-card.js";

function buildSubagentSession(overrides = {}) {
  return {
    summary: {
      sessionId: "subagent-test-1",
      title: "Say hello",
      status: "running",
      startedAtUnixMs: 1,
      updatedAtUnixMs: 1,
      ...overrides.summary,
    },
    llmHistory: [
      {
        role: "user",
        content: "Say hello",
      },
    ],
    ...overrides,
  };
}

test("isWorktreeSubagentSession is false for running subagent without worktreePath", () => {
  assert.equal(isWorktreeSubagentSession({ status: "running" }), false);
});

test("isWorktreeSubagentSession is true when worktreePath is set or status is bootstrapping", () => {
  assert.equal(
    isWorktreeSubagentSession({
      status: "running",
      worktreePath: "D:/repo/.spirit/worktrees/task-1",
    }),
    true,
  );
  assert.equal(isWorktreeSubagentSession({ status: "bootstrapping" }), true);
});

test("SubagentConversationProjection.fromSession skips worktree bootstrap card without worktree", () => {
  const projection = SubagentConversationProjection.fromSession(buildSubagentSession());
  const messages = projection.toMessages();
  assert.equal(
    messages.some((message) => message.tool?.toolName === WORKTREE_BOOTSTRAP_TOOL_NAME),
    false,
  );
});

test("SubagentConversationProjection.fromSession hides archived user timestamp metadata", () => {
  const projection = SubagentConversationProjection.fromSession(
    buildSubagentSession({
      llmHistory: [
        {
          role: "user",
          content: "<user_message_at>2026-11-06T01:00:00.000+08:00</user_message_at>\nSay hello",
        },
      ],
    }),
  );
  assert.equal(projection.toMessages()[0]?.content, "Say hello");
});

test("SubagentConversationProjection.fromSession keeps worktree bootstrap card for worktree subagent", () => {
  const projection = SubagentConversationProjection.fromSession(
    buildSubagentSession({
      summary: {
        sessionId: "subagent-test-worktree",
        title: "Worktree task",
        status: "running",
        startedAtUnixMs: 1,
        updatedAtUnixMs: 1,
        worktreePath: "D:/repo/.spirit/worktrees/task-1",
      },
    }),
  );
  const messages = projection.toMessages();
  assert.equal(
    messages.some((message) => message.tool?.toolName === WORKTREE_BOOTSTRAP_TOOL_NAME),
    true,
  );
});
