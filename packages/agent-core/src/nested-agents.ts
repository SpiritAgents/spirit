import { LLM_CONTEXT_TAGS, wrapLlmContextBlock } from "./llm-context-block.js";

export type NestedAgentsNotificationReason = "new" | "updated";

export interface NestedAgentsNotification {
  path: string;
  reason: NestedAgentsNotificationReason;
}

export interface NestedAgentsToolCallInput {
  toolName: string;
  request: unknown;
  rawOutput: string;
  failed: boolean;
}

/**
 * Host-owned nested AGENTS.md discovery port injected into AgentRuntime.
 * Implementations own filesystem traversal and SHA-256 tracking; agent-core
 * owns only the model-visible reminder format and lifecycle hooks.
 */
export interface NestedAgentsTrackerPort {
  discoverForToolCall(
    input: NestedAgentsToolCallInput,
  ): Promise<readonly NestedAgentsNotification[]> | readonly NestedAgentsNotification[];
  discoverForWorkspaceFiles(
    paths: readonly string[],
  ): Promise<readonly NestedAgentsNotification[]> | readonly NestedAgentsNotification[];
  /** Clear dynamic context tracking after compaction or history rewind; keep system-prompt baseline. */
  resetForCompaction(): void;
  snapshotState(): Record<string, string>;
  restoreState(state: Readonly<Record<string, string>>): void;
}

export function formatNestedAgentsReminder(
  notifications: readonly NestedAgentsNotification[],
): string | undefined {
  if (notifications.length === 0) {
    return undefined;
  }

  const lines = [
    "Additional AGENTS.md files apply to paths accessed here (closest first; closer instructions take precedence). Read any file with read_file before acting on assumptions:",
    ...notifications.map((item) =>
      item.reason === "updated"
        ? `- ${item.path} (updated — file changed since last seen)`
        : `- ${item.path}`,
    ),
  ];

  return wrapLlmContextBlock(LLM_CONTEXT_TAGS.nested_agents, lines.join("\n"));
}

export function appendNestedAgentsReminder(
  content: string,
  notifications: readonly NestedAgentsNotification[],
): string {
  const reminder = formatNestedAgentsReminder(notifications);
  if (!reminder) {
    return content;
  }

  if (content.length === 0) {
    return reminder;
  }

  return `${content.trimEnd()}\n\n${reminder}`;
}
