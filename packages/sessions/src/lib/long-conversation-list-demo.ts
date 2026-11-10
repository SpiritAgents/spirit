import type { ConversationMessageSnapshot } from "../types.js";

/** UI-only demo ids — negative, never persisted. */
export const LONG_CONVERSATION_LIST_DEMO_ID_BASE = -930_000;

/** Turn count for the perf harness (user + thinking + tools + assistant body per turn). */
export const LONG_CONVERSATION_LIST_DEMO_TURN_COUNT = 80;

const TOOL_SEQUENCE = ["read_file", "grep", "glob", "shell", "apply_patch"] as const;

const DEMO_PATHS = [
  "src/conversation/list.ts",
  "src/components/message-card.tsx",
  "packages/agent-core/session.ts",
  "apps/desktop/src/hooks/useDesktopRuntime.ts",
] as const;

function demoMessageId(index: number): number {
  return LONG_CONVERSATION_LIST_DEMO_ID_BASE - index;
}

function userPrompt(turn: number): string {
  return `Turn ${turn + 1}: inspect the module boundary and summarize what should change next.`;
}

function thinkingBody(turn: number): string {
  return [
    `Turn ${turn + 1}: scan recent edits, list risky coupling points, and pick the smallest verification path.`,
    "Prefer reading source before proposing refactors; keep tool calls narrow.",
  ].join("\n\n");
}

function assistantBody(turn: number): string {
  return [
    `## Turn ${turn + 1} summary`,
    "",
    "The workspace layout is consistent with a host/core split. Main risks are scroll anchoring, process-group spacing, and tool-card remount churn.",
    "",
    "- Boundary between list scope and message cards looks stable",
    "- Tool preview rows still dominate DOM node count on long threads",
    "- Next step: profile scroll + virtualization without changing session semantics",
    "",
    "```text",
    `sample-offset: ${turn * 17}`,
    "```",
  ].join("\n");
}

function toolBlock(
  turn: number,
  toolIndex: number,
): NonNullable<ConversationMessageSnapshot["tool"]> {
  const toolName = TOOL_SEQUENCE[toolIndex % TOOL_SEQUENCE.length] ?? "read_file";
  const path = DEMO_PATHS[(turn + toolIndex) % DEMO_PATHS.length] ?? DEMO_PATHS[0];
  return {
    toolCallId: `long-list-demo-${turn}-${toolIndex}`,
    toolName,
    phase: "succeeded",
    headline:
      toolName === "shell"
        ? "Ran command"
        : toolName === "grep"
          ? "Searched workspace"
          : toolName === "glob"
            ? "Matched paths"
            : toolName === "apply_patch"
              ? "Applied patch"
              : "Read file",
    headlineDetail:
      toolName === "shell" ? "npm run test:lib" : toolName === "grep" ? "virtualizer" : path,
    detailLines:
      toolName === "shell" ? ["exit 0", "42 tests passed"] : [`path: ${path}`, `turn: ${turn + 1}`],
  };
}

export function buildLongConversationListDemoMessages(): ConversationMessageSnapshot[] {
  const messages: ConversationMessageSnapshot[] = [];
  let index = 0;

  for (let turn = 0; turn < LONG_CONVERSATION_LIST_DEMO_TURN_COUNT; turn += 1) {
    messages.push({
      id: demoMessageId(index++),
      role: "user",
      content: userPrompt(turn),
      pending: false,
    });

    messages.push({
      id: demoMessageId(index++),
      role: "assistant",
      content: "",
      pending: false,
      aux: { thinking: thinkingBody(turn) },
    });

    const toolCount = turn % 4 === 3 ? 4 : 3;
    for (let toolIndex = 0; toolIndex < toolCount; toolIndex += 1) {
      messages.push({
        id: demoMessageId(index++),
        role: "assistant",
        content: "",
        pending: false,
        tool: toolBlock(turn, toolIndex),
      });
    }

    messages.push({
      id: demoMessageId(index++),
      role: "assistant",
      content: assistantBody(turn),
      pending: false,
    });
  }

  return messages;
}

export function longConversationListDemoStats(messages: readonly ConversationMessageSnapshot[]): {
  turnCount: number;
  messageCount: number;
  toolCount: number;
} {
  const toolCount = messages.filter((message) => message.tool).length;
  const userCount = messages.filter((message) => message.role === "user").length;
  return {
    turnCount: userCount,
    messageCount: messages.length,
    toolCount,
  };
}
