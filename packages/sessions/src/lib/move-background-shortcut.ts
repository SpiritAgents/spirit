import type { ConversationMessageSnapshot } from "@/types";
import type { MutableRefObject } from "react";

export type MoveBackgroundShortcutTarget = {
  eligible: boolean;
  sessionPath?: string;
  toolCallId?: string;
};

export type MoveBackgroundShortcutTargetRef = MutableRefObject<MoveBackgroundShortcutTarget>;

export function firstMoveableBackgroundToolCallId(
  messages: readonly ConversationMessageSnapshot[],
): string | undefined {
  for (const message of messages) {
    const tool = message.tool;
    if (!tool || (tool.toolName !== "shell" && tool.toolName !== "subagent")) {
      continue;
    }
    if (tool.backgroundTask || tool.taskNotification) continue;
    if (tool.phase !== "running") continue;
    const toolCallId = tool.toolCallId?.trim();
    if (toolCallId) return toolCallId;
  }
  return undefined;
}

export function moveBackgroundShortcutTargetForMessages(
  messages: readonly ConversationMessageSnapshot[],
  sessionPath?: string,
): MoveBackgroundShortcutTarget {
  const toolCallId = firstMoveableBackgroundToolCallId(messages);
  return {
    eligible: toolCallId !== undefined,
    ...(sessionPath?.trim() ? { sessionPath: sessionPath.trim() } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}
