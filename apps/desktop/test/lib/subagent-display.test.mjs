import assert from "node:assert/strict";
import { test } from "vitest";

import {
  hasInFlightSubagentDelegationInMessages,
  isGenericPendingCompactionStatusText,
  isGenericPendingThinkingStatusText,
  isSubagentStatusSurfaceText,
  parsePendingSubagentStatusText,
} from "../../dist-electron/src/lib/subagent-display.js";

test("isSubagentStatusSurfaceText detects runtime status lines", () => {
  assert.equal(
    isSubagentStatusSurfaceText('输出 "你好" 这两个字，不要做任何其他事情。: Running'),
    true,
  );
  assert.equal(isSubagentStatusSurfaceText('请输出"你好"这两个字。: The'), true);
  assert.equal(isSubagentStatusSurfaceText('请输出"你好"这两个字。: Sp'), true);
  assert.equal(
    isSubagentStatusSurfaceText(
      '输出 "你好" 这两个字。: The user wants me to output "你好" — that\'s all.',
    ),
    true,
  );
  assert.equal(isSubagentStatusSurfaceText("你好"), false);
  assert.equal(isSubagentStatusSurfaceText("子智能体已完成，输出如下：**你好**"), false);
  assert.equal(isSubagentStatusSurfaceText("子智能体已完成，输出如下：\n\n**你好**"), false);
  assert.equal(isSubagentStatusSurfaceText("好的，又来一遍 :) 有什么需要我接着搞的？"), false);
});

test("isSubagentStatusSurfaceText rejects assistant prose with colons", () => {
  assert.equal(isSubagentStatusSurfaceText("你是想让我：删除目录"), false);
  assert.equal(
    isSubagentStatusSurfaceText(
      "“非更改区”我不确定你指的是什么。你是想让我：\n* 删除未跟踪目录？\n* 还是回退提交？",
    ),
    false,
  );
  assert.equal(
    isSubagentStatusSurfaceText(
      "在 VS Code 源代码管理面板里，通常分为“暂存的更改”“更改”和“未跟踪的文件”。你是想让我：",
    ),
    false,
  );
});

test("isGenericPendingThinkingStatusText detects runtime spinner placeholders", () => {
  assert.equal(isGenericPendingThinkingStatusText("| Thinking…"), true);
  assert.equal(isGenericPendingThinkingStatusText("Need to inspect README.md first."), false);
});

test("isGenericPendingCompactionStatusText detects runtime spinner placeholders", () => {
  assert.equal(isGenericPendingCompactionStatusText("| Compacting…"), true);
  assert.equal(isGenericPendingCompactionStatusText("/ Compacting…"), true);
  assert.equal(isGenericPendingCompactionStatusText("## Context compacted"), false);
});

test("parsePendingSubagentStatusText only accepts subagent runtime status", () => {
  assert.equal(parsePendingSubagentStatusText("| Review auth: Running"), "Review auth: Running");
  assert.equal(parsePendingSubagentStatusText("/ Thinking…"), undefined);
  assert.equal(parsePendingSubagentStatusText("| 用户想回退：删除未跟踪文件"), undefined);
});

test("hasInFlightSubagentDelegationInMessages includes pending-approval subagent", () => {
  assert.equal(
    hasInFlightSubagentDelegationInMessages([
      {
        id: 1,
        role: "assistant",
        content: "",
        pending: false,
        tool: {
          toolName: "subagent",
          phase: "pending-approval",
          headline: "SubAgent",
          detailLines: [],
        },
      },
    ]),
    true,
  );
  assert.equal(
    hasInFlightSubagentDelegationInMessages([
      {
        id: 1,
        role: "assistant",
        content: "",
        pending: false,
        tool: {
          toolName: "subagent",
          phase: "succeeded",
          headline: "SubAgent",
          detailLines: [],
        },
      },
    ]),
    false,
  );
});
