export const BACKGROUND_TASKS_DIR_NAME = "background-tasks";
export const BACKGROUND_TASK_ID_PATTERN = /^task_[a-f0-9]{12}$/u;

/** Display classification only; filesystem authorization is enforced by the host. */
export function backgroundTaskOutputKind(filePath: string): "shell" | "subagent" | undefined {
  const normalized = filePath.trim().replaceAll("\\", "/");
  const match = /(?:^|\/)background-tasks\/(shell|subagent)-(task_[a-f0-9]{12})\.(log|md)$/u.exec(
    normalized,
  );
  if (match?.[1] === "shell" && match[3] === "log") return "shell";
  if (match?.[1] === "subagent" && match[3] === "md") return "subagent";
  return undefined;
}
