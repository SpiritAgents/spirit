import type { BackgroundTaskNotification } from "@spiritagent/agent-core";
import { markdownToPlainText } from "./markdown-plain-text.js";
import type { ToolBlockSnapshot } from "../types.js";

type Translate = (key: string, options?: { task?: string; error?: string }) => string;

export function backgroundTaskSummary(tool: ToolBlockSnapshot, t: Translate) {
  const task = tool.backgroundTask!;
  return {
    headline: t(`tool.backgroundTaskStatus_${task.status}`, {
      task: t(`tool.backgroundTaskName_${task.kind}`),
    }),
    detail:
      task.kind === "shell"
        ? task.input
        : markdownToPlainText(
            task.finalOutputPreview ?? tool.backgroundTaskOutput?.text ?? task.error ?? "",
          ),
    ...(task.kind === "subagent" && tool.taskNotification?.outputError
      ? {
          resultDetail: t("tool.backgroundOutputUnavailable", {
            error: tool.taskNotification.outputError,
          }),
          resultDetailTone: "failed" as const,
        }
      : {}),
  };
}

export function backgroundTaskNotificationTool(
  notification: BackgroundTaskNotification,
  t: Translate,
): ToolBlockSnapshot {
  const { task } = notification;
  if (!task.terminalEventId) throw new Error("Task notification has no terminal event ID.");
  const tool: ToolBlockSnapshot = {
    toolCallId: `task-notice:${task.terminalEventId}`,
    toolName: task.kind,
    phase: task.status === "completed" ? "succeeded" : "failed",
    headline: "",
    detailLines: task.error ? [task.error] : [],
    argsExcerpt: task.argumentsJson,
    backgroundTask: structuredClone(task),
    backgroundTaskOutput: notification.output,
    taskNotification: {
      eventId: task.terminalEventId,
      origin: "background-task",
      restored: notification.restored,
      ...(notification.outputError ? { outputError: notification.outputError } : {}),
    },
  };
  const summary = backgroundTaskSummary(tool, t);
  tool.headline = summary.headline;
  tool.headlineDetail = summary.detail;
  return tool;
}

export function appendBackgroundTaskOutput(tool: ToolBlockSnapshot, chunk: string) {
  const text = `${tool.backgroundTaskOutput?.text ?? ""}${chunk}`;
  return {
    text: text.slice(-16_384),
    truncated: tool.backgroundTaskOutput?.truncated === true || text.length > 16_384,
  };
}
