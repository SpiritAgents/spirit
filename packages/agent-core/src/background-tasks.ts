import type { JsonObject } from "./ports.js";

export interface BackgroundOptions {
  type?: boolean;
  delay?: number;
}

export const DEFAULT_BACKGROUND_DELAY_SECONDS = 30;

export type BackgroundTaskKind = "shell" | "subagent";
export type BackgroundTaskStatus =
  | "starting"
  | "running"
  | "blocked"
  | "waiting-for-background"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";

export interface BackgroundTaskRecord {
  version: 1;
  id: string;
  sessionKey: string;
  runtimeId: string;
  parentTaskId?: string;
  toolCallId: string;
  kind: BackgroundTaskKind;
  input: string;
  argumentsJson: string;
  owner: { id: string; pid: number };
  status: BackgroundTaskStatus;
  background: boolean;
  outputPath: string;
  startedAtUnixMs: number;
  updatedAtUnixMs: number;
  endedAtUnixMs?: number;
  elapsedMs: number;
  elapsedApproximate?: boolean;
  exitCode?: number;
  error?: string;
  sessionId?: string;
  sessionTranscript?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  terminalEventId?: string;
  notificationDelivered?: boolean;
}

export type BackgroundTaskCreateInput = Pick<
  BackgroundTaskRecord,
  "sessionKey" | "runtimeId" | "parentTaskId" | "toolCallId" | "kind" | "input" | "argumentsJson"
>;

/** Host-owned storage; runtime task semantics never access the filesystem directly. */
export interface BackgroundTaskStore {
  create(input: BackgroundTaskCreateInput): Promise<BackgroundTaskRecord>;
  save(record: BackgroundTaskRecord): Promise<void>;
  appendOutput(taskId: string, text: string): Promise<void>;
  readOutputTail(taskId: string, maxChars: number): Promise<string>;
  list(): Promise<BackgroundTaskRecord[]>;
}

export interface DelayRequest {
  seconds?: number;
  task_id?: string;
}

export interface StopTaskRequest {
  task_id: string;
}

export function isBackgroundTaskTerminal(status: BackgroundTaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "stopped" ||
    status === "interrupted"
  );
}

export function parseBackgroundOptions(value: unknown): BackgroundOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("background must be an object.");
  }
  const options = value as Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (key !== "type" && key !== "delay") {
      throw new Error(`Unknown background option: ${key}`);
    }
  }
  if (options.type !== undefined && typeof options.type !== "boolean") {
    throw new Error("background.type must be a boolean.");
  }
  if (options.delay !== undefined) {
    validateWaitSeconds(options.delay, "background.delay");
  }
  return {
    ...(typeof options.type === "boolean" ? { type: options.type } : {}),
    ...(typeof options.delay === "number" ? { delay: options.delay } : {}),
  };
}

export function validateWaitSeconds(value: unknown, name = "seconds"): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite, non-negative number.`);
  }
}

export function parseDelayRequest(value: JsonObject): DelayRequest {
  if (value.seconds !== undefined) validateWaitSeconds(value.seconds);
  if (value.task_id !== undefined && (typeof value.task_id !== "string" || !value.task_id.trim())) {
    throw new Error("task_id must be a non-empty string.");
  }
  if (value.seconds === undefined && value.task_id === undefined) {
    throw new Error("Provide seconds, task_id, or both.");
  }
  return {
    ...(typeof value.seconds === "number" ? { seconds: value.seconds } : {}),
    ...(typeof value.task_id === "string" ? { task_id: value.task_id } : {}),
  };
}

export function buildBackgroundOptionsSchema(kind: BackgroundTaskKind): JsonObject {
  return {
    type: "object",
    description:
      kind === "subagent"
        ? "Use foreground execution when its research is the next input you need, such as exploration before drafting a plan. Use delay: 0 to dispatch independent implementation work while you continue other work."
        : "Long-running commands can return their latest output after the initial wait. Use delay to wait longer, read the output file for progress, or stop_task to stop a command before rerunning it with suitable non-interactive arguments.",
    properties: {
      type: {
        type: "boolean",
        default: true,
        description:
          "Allow the task to continue in the background after the initial wait. Defaults to true. Set false to wait in the foreground until it finishes.",
      },
      delay: {
        type: "number",
        minimum: 0,
        default: DEFAULT_BACKGROUND_DELAY_SECONDS,
        description:
          "Seconds to wait before returning a running task to the background. Defaults to 30; 0 returns immediately. Applies when background.type is true.",
      },
    },
    additionalProperties: false,
  };
}

export function formatBackgroundTaskNotification(record: BackgroundTaskRecord): string {
  if (!isBackgroundTaskTerminal(record.status)) {
    throw new Error(`Task ${record.id} is not finished.`);
  }
  const lines = [
    `Background task ${record.status}.`,
    `task_id: ${record.id}`,
    `tool: ${record.kind}`,
    `${record.kind === "shell" ? "command" : "prompt"}: ${JSON.stringify(record.input)}`,
    `elapsed_seconds: ${record.elapsedMs / 1000}`,
  ];
  if (record.elapsedApproximate) lines.push("elapsed_time: last recorded duration");
  if (record.kind === "shell") lines.push(`exit_code: ${record.exitCode ?? "unknown"}`);
  if (record.sessionId) lines.push(`sessionId: ${record.sessionId}`);
  if (record.sessionTranscript) {
    lines.push(`sessionTranscript: ${JSON.stringify(record.sessionTranscript)}`);
  }
  if (record.worktreePath) lines.push(`worktree_path: ${JSON.stringify(record.worktreePath)}`);
  if (record.worktreeBranch)
    lines.push(`worktree_branch: ${JSON.stringify(record.worktreeBranch)}`);
  lines.push(`output_path: ${JSON.stringify(record.outputPath)}`);
  if (record.error) lines.push(`error: ${JSON.stringify(record.error)}`);
  if (record.status === "interrupted") {
    lines.push("The task was interrupted when its execution host stopped.");
  }
  lines.push("Read the output file for the task result.");
  return lines.join("\n");
}
