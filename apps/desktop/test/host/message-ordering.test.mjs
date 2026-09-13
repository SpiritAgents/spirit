import assert from "node:assert/strict";
import { test } from "vitest";

import { isSubagentStatusSurfaceText } from "../../dist-electron/src/lib/subagent-display.js";
import {
  assistantTurnHasPlainPrefixMessage,
  finishTaskNoticePreviewFromArguments,
  finishTaskSummaryFromStreamingArguments,
  shouldHideEmptyPendingAssistantSnapshot,
  stripRedundantThinkingFromMessageAux,
  toolCallSummaryCopyForRequest,
  toolCallSummaryForPhase,
  toolCallSummaryForStreamingPreview,
  toolCallSummaryCopyForResponsesBuiltInTool,
  displayTitleForTool,
} from "../../dist-electron/src/host/message-ordering.js";
import { phaseToVerbContext } from "../../src/lib/tool-verb-context.ts";
import i18n from "../../dist-electron/src/lib/i18n-host.js";

function toolHeadline(key, phase) {
  const context = phase ? phaseToVerbContext(phase) : undefined;
  return i18n.t(key, context ? { context } : {});
}

test("toolCallSummaryCopyForRequest: write tools use verb headline + basename detail", () => {
  assert.deepEqual(toolCallSummaryCopyForRequest("edit_file", { path: "D:/proj/src/foo.ts" }), {
    headline: toolHeadline("tool.edit"),
    headlineDetail: "foo.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("create_file", { path: "notes/readme.md" }), {
    headline: toolHeadline("tool.create"),
    headlineDetail: "readme.md",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("delete_file", { path: "/tmp/old.txt" }), {
    headline: toolHeadline("tool.delete"),
    headlineDetail: "old.txt",
  });
});

test("toolCallSummaryCopyForRequest: create_automation uses title and trigger detail", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest("create_automation", {
      title: "CI check",
      overview: "Summarize CI failures.",
      trigger: { kind: "time", schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 } },
    }),
    { headline: toolHeadline("automations.create"), headlineDetail: "CI check · Weekly Mon 09:00" },
  );
});

test("toolCallSummaryCopyForRequest: create_plan uses plan slug not tool name", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest("create_plan", {
      name: "create_plan",
      plan_name: "multilingual-cat",
      content: "# Plan",
    }),
    { headline: toolHeadline("tool.create"), headlineDetail: "multilingual-cat.md" },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest("create_plan", { name: "demo-plan", content: "# Plan" }),
    { headline: toolHeadline("tool.create"), headlineDetail: "demo-plan.md" },
  );
});

test("toolCallSummaryCopyForRequest: apply_patch uses verb headline + basename detail", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest("apply_patch", {
      operation: { type: "update_file", path: "README.md" },
    }),
    { headline: toolHeadline("tool.edit"), headlineDetail: "README.md" },
  );
});

test("toolCallSummaryCopyForRequest: web_search uses web search headline + query detail", () => {
  assert.deepEqual(toolCallSummaryCopyForRequest("web_search", { query: "latest news" }), {
    headline: toolHeadline("tool.webSearch"),
    headlineDetail: "latest news",
  });
  assert.deepEqual(
    toolCallSummaryCopyForRequest("web_search", {
      action: { type: "search", query: "DeepSeek V4" },
    }),
    {
      headline: toolHeadline("tool.webSearch"),
      headlineDetail: "DeepSeek V4",
    },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest("web_search", {
      action: { type: "search", query: "Web search" },
    }),
    {
      headline: toolHeadline("tool.webSearch"),
    },
  );
});

test("toolCallSummaryCopyForRequest: web_search reads query from argumentsJson", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest("web_search", {
      name: "web_search",
      argumentsJson: '{"query":"What is the Spirit project"}',
    }),
    {
      headline: toolHeadline("tool.webSearch"),
      headlineDetail: "What is the Spirit project",
    },
  );
});

test("toolCallSummaryCopyForResponsesBuiltInTool: web_search preserves query detail without sources", () => {
  assert.deepEqual(
    toolCallSummaryCopyForResponsesBuiltInTool("web_search", "preview", {
      headline: toolHeadline("tool.webSearch"),
      headlineDetail: "What is the Spirit project",
    }),
    {
      headline: toolHeadline("tool.webSearch", "preview"),
      headlineDetail: "What is the Spirit project",
    },
  );
  assert.deepEqual(
    toolCallSummaryCopyForResponsesBuiltInTool(
      "web_search",
      "succeeded",
      { headline: toolHeadline("tool.webSearch") },
      {
        headlineDetail: "What is the Spirit project",
        inputExcerpt: "What is the Spirit project",
      },
    ),
    {
      headline: toolHeadline("tool.webSearch", "succeeded"),
      headlineDetail: "What is the Spirit project",
    },
  );
});

test("toolCallSummaryCopyForResponsesBuiltInTool: web_search prefers query over source count", () => {
  assert.deepEqual(
    toolCallSummaryCopyForResponsesBuiltInTool(
      "web_search",
      "succeeded",
      { headline: toolHeadline("tool.webSearch"), headlineDetail: "latest models" },
      { sourceCount: 5 },
    ),
    {
      headline: toolHeadline("tool.webSearch", "succeeded"),
      headlineDetail: "latest models",
    },
  );
});

test("toolCallSummaryCopyForResponsesBuiltInTool: web_search falls back to source count without query detail", () => {
  assert.deepEqual(
    toolCallSummaryCopyForResponsesBuiltInTool(
      "web_search",
      "succeeded",
      { headline: toolHeadline("tool.webSearch") },
      { sourceCount: 2 },
    ),
    {
      headline: toolHeadline("tool.webSearch", "succeeded"),
      headlineDetail: i18n.t("tool.webSearchSourceCount", { count: 2 }),
    },
  );
});

test("toolCallSummaryCopyForRequest: search tools use verb headline + detail", () => {
  assert.deepEqual(toolCallSummaryCopyForRequest("grep", { query: "TODO" }), {
    headline: toolHeadline("tool.search"),
    headlineDetail: "TODO",
  });
  assert.deepEqual(
    toolCallSummaryCopyForRequest("grep", {
      query: "ratatui",
      glob: "apps/cli/**/*.{rs,toml}",
    }),
    {
      headline: toolHeadline("tool.search"),
      headlineDetail: i18n.t("tool.searchQueryInGlob", {
        query: "ratatui",
        glob: "apps/cli/**/*.{rs,toml}",
      }),
    },
  );
  assert.deepEqual(toolCallSummaryCopyForRequest("glob", { pattern: "src/**/*.ts" }), {
    headline: toolHeadline("tool.match"),
    headlineDetail: "src/**/*.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("web_fetch", { url: "https://example.com/" }), {
    headline: toolHeadline("tool.fetch"),
    headlineDetail: "https://example.com/",
  });
});

test("toolCallSummaryForPhase: lazyToolGateway execution request preserves MCP detail", () => {
  const lazyRequest = {
    kind: "lazyToolGateway",
    name: "tool_call",
    argumentsJson: JSON.stringify({
      provider: "mcp",
      server: "microsoft-learn",
      tool: "microsoft_docs_search",
      arguments: { query: "WinUI 3" },
    }),
  };
  assert.deepEqual(toolCallSummaryForPhase("running", "tool_call", lazyRequest), {
    headline: toolHeadline("tool.lazyToolCall", "running"),
    headlineDetail: "mcp / microsoft-learn / microsoft_docs_search",
  });
  assert.deepEqual(
    toolCallSummaryForPhase("succeeded", "tool_describe", {
      kind: "lazyToolGateway",
      name: "tool_describe",
      argumentsJson: JSON.stringify({
        provider: "mcp",
        server: "microsoft-learn",
        tool: "microsoft_docs_fetch",
      }),
    }),
    {
      headline: toolHeadline("tool.lazyToolDescribe", "succeeded"),
      headlineDetail: "mcp / microsoft-learn / microsoft_docs_fetch",
    },
  );
});

test("toolCallSummaryForPhase: built-in create_automation preserves automation card copy", () => {
  const lazyRequest = {
    kind: "lazyToolGateway",
    name: "tool_call",
    argumentsJson: JSON.stringify({
      provider: "built-in",
      server: "desktop",
      tool: "create_automation",
      arguments: {
        overview: "Summarize CI failures.",
        title: "CI check",
        trigger: { kind: "time", schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 } },
      },
    }),
  };
  assert.deepEqual(toolCallSummaryForPhase("running", "tool_call", lazyRequest), {
    headline: toolHeadline("automations.create"),
    headlineDetail: "CI check · Weekly Mon 09:00",
  });
});

test("toolCallSummaryForStreamingPreview: built-in create_automation uses progressive streaming JSON", () => {
  const partialGateway =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI news digest","trigger":{"kind":"time","schedule":{"kind":"daily","hour":8,"minute":0}}}}';
  assert.deepEqual(
    toolCallSummaryForStreamingPreview([], "tool-1", "tool_call", undefined, {
      streamingArgumentsJson: partialGateway,
    }),
    {
      headline: toolHeadline("automations.create"),
      headlineDetail: "AI news digest · Daily 08:00",
    },
  );

  const titleOnly =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI news digest"';
  assert.deepEqual(
    toolCallSummaryForStreamingPreview([], "tool-1", "tool_call", undefined, {
      streamingArgumentsJson: titleOnly,
    }),
    { headline: toolHeadline("automations.create"), headlineDetail: "AI news digest" },
  );

  const gatewayIdentified =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{';
  assert.deepEqual(
    toolCallSummaryForStreamingPreview([], "tool-1", "tool_call", undefined, {
      streamingArgumentsJson: gatewayIdentified,
    }),
    { headline: toolHeadline("automations.create") },
  );
});

test("displayTitleForTool: built-in create_automation approval uses automation headline", () => {
  assert.equal(
    displayTitleForTool("tool_call", {
      kind: "lazyToolGateway",
      name: "tool_call",
      argumentsJson: JSON.stringify({
        provider: "built-in",
        server: "desktop",
        tool: "create_automation",
        arguments: {
          overview: "Summarize CI failures.",
          title: "CI check",
          trigger: { kind: "time", schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 } },
        },
      }),
    }),
    toolHeadline("automations.create"),
  );
});

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
  assert.equal(isSubagentStatusSurfaceText("你是想让我：删除目录"), false);
  assert.equal(
    isSubagentStatusSurfaceText(
      "在 VS Code 里通常分为“暂存”“更改”“未跟踪”。你是想让我：\n* 删除目录",
    ),
    false,
  );
});

test("stripRedundantThinkingFromMessageAux removes duplicate or leaked reasoning", () => {
  assert.deepEqual(stripRedundantThinkingFromMessageAux("Body", { thinking: "Body" }), undefined);
  assert.deepEqual(
    stripRedundantThinkingFromMessageAux("Body second half", { thinking: "Body" }),
    undefined,
  );
  assert.deepEqual(
    stripRedundantThinkingFromMessageAux("Body", { thinking: "Independent reasoning" }),
    {
      thinking: "Independent reasoning",
    },
  );
});

test("toolCallSummaryCopyForRequest: ask_questions and subagent", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest("ask_questions", {
      questions: [{ id: "q1" }, { id: "q2" }],
    }),
    {
      headline: toolHeadline("tool.askQuestions"),
      headlineDetail: i18n.t("tool.nQuestions", { count: 2 }),
    },
  );
  assert.deepEqual(toolCallSummaryCopyForRequest("subagent", { task: "Review auth module" }), {
    headline: toolHeadline("tool.subagent"),
    headlineDetail: "Review auth module",
  });
  assert.deepEqual(
    toolCallSummaryCopyForRequest("subagent", {}, "preview", {
      streamingArgumentsJson: '{"task":"Review auth',
    }),
    { headline: toolHeadline("tool.subagent", "preview"), headlineDetail: "Review auth" },
  );
});

test("toolCallSummaryCopyForRequest: todo_write shows incremental delta detail", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      "todo_write",
      {
        todos: [
          { title: "Create index.html", status: "pending" },
          { title: "Verify page renders", status: "pending" },
        ],
      },
      "succeeded",
      {
        todosBeforeWrite: [{ title: "Old task", status: "pending" }],
      },
    ),
    {
      headline: toolHeadline("tool.todoWrite", "succeeded"),
      headlineDetail: [
        i18n.t("tool.todoWriteAdded", { count: 2 }),
        i18n.t("tool.todoWriteRemoved", { count: 1 }),
      ].join(i18n.t("tool.todoWriteDeltaSeparator")),
    },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest("todo_write", { todos: [] }, "succeeded", {
      todosBeforeWrite: [{ title: "Only one item", status: "pending" }],
    }),
    {
      headline: toolHeadline("tool.todoWrite", "succeeded"),
      headlineDetail: i18n.t("tool.todoWriteRemoved", { count: 1 }),
    },
  );
});

test("toolCallSummaryForPhase: todo_write succeeded uses before snapshot and output", () => {
  assert.deepEqual(
    toolCallSummaryForPhase(
      "succeeded",
      "todo_write",
      { todos: [{ title: "Draft", status: "completed" }] },
      {
        executionOutput: JSON.stringify({
          todos: [{ title: "Draft", status: "completed" }],
        }),
        todosBeforeWrite: [{ title: "Draft", status: "pending" }],
      },
    ),
    {
      headline: toolHeadline("tool.todoWrite", "succeeded"),
      headlineDetail: i18n.t("tool.todoWriteCompleted", { count: 1 }),
    },
  );
});

test("toolCallSummaryForPhase: read_file splits headline and path detail", () => {
  assert.deepEqual(
    toolCallSummaryForPhase("succeeded", "read_file", {
      path: "D:/proj/src/App.tsx",
      offset: 1,
      limit: 50,
    }),
    { headline: toolHeadline("tool.read", "succeeded"), headlineDetail: "App.tsx 1 - 50" },
  );
});

test("toolCallSummaryForPhase: read_file tool-output-archives uses tool output detail", () => {
  assert.deepEqual(
    toolCallSummaryForPhase("succeeded", "read_file", {
      path: "C:/Users/pc/AppData/Roaming/Spirit/tool-output-archives/sess/call_1.txt",
      offset: 1,
      limit: 5,
    }),
    {
      headline: toolHeadline("tool.read", "succeeded"),
      headlineDetail: `${i18n.t("tool.toolOutput")} 1 - 5`,
    },
  );
});

test("toolCallSummaryCopyForRequest: shell reason and command", () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest("shell", {
      reason: "Install dependencies",
      command: "npm install",
    }),
    { headline: "Install dependencies", headlineDetail: "npm install" },
  );
});

test("shouldHideEmptyPendingAssistantSnapshot keeps live thinking rows visible", () => {
  const emptyPending = {
    id: 1,
    role: "assistant",
    content: "",
    pending: true,
  };

  assert.equal(shouldHideEmptyPendingAssistantSnapshot(emptyPending), true);
  assert.equal(
    shouldHideEmptyPendingAssistantSnapshot(emptyPending, {
      kind: "thinking",
      statusText: "| Thinking…",
    }),
    false,
  );
});

test("shouldHideEmptyPendingAssistantSnapshot hides ghost row when tool follows", () => {
  const messages = [
    { id: 0, role: "user", content: "hi", pending: false },
    {
      id: 1,
      role: "assistant",
      content: "",
      pending: true,
    },
    {
      id: 2,
      role: "assistant",
      content: "",
      pending: false,
      tool: {
        toolCallId: "t1",
        toolName: "glob",
        phase: "running",
        headline: "Listed",
        detailLines: [],
      },
    },
  ];

  assert.equal(
    shouldHideEmptyPendingAssistantSnapshot(
      messages[1],
      { kind: "thinking", statusText: "| Thinking…" },
      messages,
      1,
    ),
    true,
  );
});

test("shouldHideEmptyPendingAssistantSnapshot keeps pending row between tool batches", () => {
  const messages = [
    { id: 0, role: "user", content: "hi", pending: false },
    {
      id: 1,
      role: "assistant",
      content: "",
      pending: false,
      tool: {
        toolCallId: "t1",
        toolName: "glob",
        phase: "succeeded",
        headline: "Listed",
        detailLines: [],
      },
    },
    {
      id: 2,
      role: "assistant",
      content: "",
      pending: true,
    },
  ];

  assert.equal(
    shouldHideEmptyPendingAssistantSnapshot(
      messages[2],
      { kind: "thinking", statusText: "| Thinking…" },
      messages,
      2,
    ),
    false,
  );
});

test("finishTaskNoticePreviewFromArguments streams partial summary text", () => {
  assert.equal(
    finishTaskSummaryFromStreamingArguments('{"summary":"verified each'),
    "verified each",
  );
  assert.equal(
    finishTaskNoticePreviewFromArguments('{"summary":"verified each'),
    "Task completed: verified each",
  );
  assert.equal(
    finishTaskNoticePreviewFromArguments(
      '{"summary":"called finish_task after verifying every message"}',
    ),
    "Task completed: called finish_task after verifying every message.",
  );
});

test("toolCallSummaryCopyForRequest: verbs use tense across phases", () => {
  const running = toolCallSummaryCopyForRequest("create_file", { path: "a.ts" }, "running");
  const succeeded = toolCallSummaryCopyForRequest("create_file", { path: "a.ts" }, "succeeded");
  assert.equal(running.headline, toolHeadline("tool.create", "running"));
  assert.equal(succeeded.headline, toolHeadline("tool.create", "succeeded"));

  const viewRunning = toolCallSummaryForPhase("running", "read_file", { path: "b.ts" });
  const viewDone = toolCallSummaryForPhase("succeeded", "read_file", { path: "b.ts" });
  assert.equal(viewRunning.headline, toolHeadline("tool.read", "running"));
  assert.equal(viewDone.headline, toolHeadline("tool.read", "succeeded"));
});

test("toolCallSummaryCopyForRequest: English verbs use progressive in running phase", async () => {
  await i18n.changeLanguage("en");
  try {
    assert.deepEqual(toolCallSummaryCopyForRequest("create_file", { path: "a.ts" }, "running"), {
      headline: "Creating",
      headlineDetail: "a.ts",
    });
    assert.deepEqual(toolCallSummaryCopyForRequest("edit_file", { path: "b.ts" }, "running"), {
      headline: "Editing",
      headlineDetail: "b.ts",
    });
    assert.deepEqual(toolCallSummaryCopyForRequest("delete_file", { path: "c.ts" }, "running"), {
      headline: "Deleting",
      headlineDetail: "c.ts",
    });
    assert.deepEqual(toolCallSummaryCopyForRequest("ls", { path: "src/" }, "running"), {
      headline: "Listing",
      headlineDetail: "src/",
    });
    assert.deepEqual(toolCallSummaryCopyForRequest("grep", { query: "TODO" }, "running"), {
      headline: "Searching",
      headlineDetail: "TODO",
    });
    assert.deepEqual(
      toolCallSummaryCopyForRequest(
        "grep",
        { query: "ratatui", glob: "apps/cli/**/*.{rs,toml}" },
        "running",
      ),
      { headline: "Searching", headlineDetail: "ratatui in apps/cli/**/*.{rs,toml}" },
    );
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("toolCallSummaryCopyForRequest: verbs use progressive in running phase", () => {
  assert.deepEqual(toolCallSummaryCopyForRequest("create_file", { path: "a.ts" }, "running"), {
    headline: toolHeadline("tool.create", "running"),
    headlineDetail: "a.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("edit_file", { path: "b.ts" }, "running"), {
    headline: toolHeadline("tool.edit", "running"),
    headlineDetail: "b.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("delete_file", { path: "c.ts" }, "running"), {
    headline: toolHeadline("tool.delete", "running"),
    headlineDetail: "c.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("ls", { path: "src/" }, "running"), {
    headline: toolHeadline("tool.ls", "running"),
    headlineDetail: "src/",
  });
});

test("toolCallSummaryCopyForRequest: verbs use past tense in succeeded phase", () => {
  assert.deepEqual(toolCallSummaryCopyForRequest("create_file", { path: "a.ts" }, "succeeded"), {
    headline: toolHeadline("tool.create", "succeeded"),
    headlineDetail: "a.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("edit_file", { path: "b.ts" }, "succeeded"), {
    headline: toolHeadline("tool.edit", "succeeded"),
    headlineDetail: "b.ts",
  });
  assert.deepEqual(toolCallSummaryCopyForRequest("ls", { path: "src/" }, "succeeded"), {
    headline: toolHeadline("tool.ls", "succeeded"),
    headlineDetail: "src/",
  });
});

test("toolCallSummaryCopyForRequest: English verbs use past tense in succeeded phase", async () => {
  await i18n.changeLanguage("en");
  try {
    assert.deepEqual(toolCallSummaryCopyForRequest("create_file", { path: "a.ts" }, "succeeded"), {
      headline: "Created",
      headlineDetail: "a.ts",
    });
    assert.deepEqual(toolCallSummaryCopyForRequest("edit_file", { path: "b.ts" }, "succeeded"), {
      headline: "Edited",
      headlineDetail: "b.ts",
    });
    assert.deepEqual(toolCallSummaryCopyForRequest("ls", { path: "src/" }, "succeeded"), {
      headline: "Listed",
      headlineDetail: "src/",
    });
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("toolCallSummaryCopyForRequest: ls uses relative path within workspace", () => {
  const workspaceRoot = "/Users/yu/proj";
  assert.deepEqual(
    toolCallSummaryCopyForRequest("ls", { path: "/Users/yu/proj/apps/cli" }, "succeeded", {
      workspaceRoot,
    }),
    { headline: toolHeadline("tool.ls", "succeeded"), headlineDetail: "apps/cli" },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest("ls", { path: "/Users/yu/proj" }, "running", { workspaceRoot }),
    { headline: toolHeadline("tool.ls", "running"), headlineDetail: "." },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest("ls", { path: "/tmp/foo" }, "succeeded", { workspaceRoot }),
    { headline: toolHeadline("tool.ls", "succeeded"), headlineDetail: "/tmp/foo" },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest("ls", { path: "/Users/yu/proj/apps/" }, "succeeded", {
      workspaceRoot,
    }),
    { headline: toolHeadline("tool.ls", "succeeded"), headlineDetail: "apps/" },
  );
});

test("toolCallSummaryForStreamingPreview: ls uses relative path within workspace", () => {
  const workspaceRoot = "/Users/yu/proj";
  assert.deepEqual(
    toolCallSummaryForStreamingPreview(
      [],
      "tool-1",
      "ls",
      { path: "/Users/yu/proj/apps" },
      { workspaceRoot },
    ),
    { headline: toolHeadline("tool.ls", "running"), headlineDetail: "apps" },
  );
});

test("toolCallSummaryForPhase: get_diagnostics failed uses base check verb and basename", () => {
  assert.deepEqual(
    toolCallSummaryForPhase("failed", "get_diagnostics", { paths: ["src/App.tsx"] }),
    { headline: toolHeadline("tool.diagnosticsCheck"), headlineDetail: "App.tsx" },
  );
});

test("toolCallSummaryForPhase: get_diagnostics running uses progressive check verb", () => {
  assert.deepEqual(
    toolCallSummaryForPhase("running", "get_diagnostics", { paths: ["src/App.tsx"] }),
    { headline: toolHeadline("tool.diagnosticsCheck", "running"), headlineDetail: "App.tsx" },
  );
});

test("toolCallSummaryForPhase: read_file SKILL.md uses frontmatter name when output is available", () => {
  const skillMarkdown = `---
name: llm-debug
description: Developer debug access
---
# Body
`;
  assert.deepEqual(
    toolCallSummaryForPhase(
      "succeeded",
      "read_file",
      {
        path: "skills/wrong-folder/SKILL.md",
      },
      { executionOutput: skillMarkdown },
    ),
    { headline: toolHeadline("tool.use", "succeeded"), headlineDetail: "llm-debug" },
  );
});

test("toolCallSummaryForPhase: read_file SKILL.md omits detail without frontmatter output", async () => {
  assert.deepEqual(
    toolCallSummaryForPhase("succeeded", "read_file", {
      path: "skills/git-commit/SKILL.md",
    }),
    { headline: toolHeadline("tool.use", "succeeded") },
  );

  await i18n.changeLanguage("en");
  try {
    assert.deepEqual(
      toolCallSummaryForPhase("running", "read_file", {
        path: "skills/git-commit/SKILL.md",
      }),
      { headline: "Using" },
    );
    assert.deepEqual(
      toolCallSummaryForPhase("succeeded", "read_file", {
        path: "skills/git-commit/SKILL.md",
      }),
      { headline: "Used" },
    );
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("toolCallSummaryForPhase: English read_file uses Read in succeeded phase", async () => {
  await i18n.changeLanguage("en");
  try {
    assert.deepEqual(
      toolCallSummaryForPhase("succeeded", "read_file", { path: "/proj/src/App.tsx" }),
      { headline: "Read", headlineDetail: "App.tsx" },
    );
    assert.deepEqual(
      toolCallSummaryForPhase("running", "read_file", { path: "/proj/src/App.tsx" }),
      { headline: "Reading", headlineDetail: "App.tsx" },
    );
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("assistantTurnHasPlainPrefixMessage treats trailing whitespace as the same prefix", () => {
  const messages = [
    { id: 1, role: "user", content: "read README", pending: false },
    {
      id: 2,
      role: "assistant",
      content: "OK.\n\n",
      pending: false,
    },
    {
      id: 3,
      role: "assistant",
      content: "",
      tool: { toolCallId: "call-1", toolName: "read_file", phase: "succeeded", headline: "Read" },
      pending: false,
    },
    {
      id: 4,
      role: "assistant",
      content: "Spirit is an open-source AI coding agent monorepo.",
      pending: false,
    },
  ];

  assert.equal(assistantTurnHasPlainPrefixMessage(messages, "OK."), true);
  assert.equal(
    assistantTurnHasPlainPrefixMessage(
      messages,
      "Spirit is an open-source AI coding agent monorepo.",
    ),
    true,
  );
  assert.equal(
    assistantTurnHasPlainPrefixMessage(messages, "Sure, same prompt, let me generate a video:"),
    false,
  );
});
