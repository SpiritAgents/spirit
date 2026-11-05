import { parseBackgroundOptions, parseDelayRequest } from "../background-tasks.js";
import { parseShellToolResult, serializeShellToolResult } from "../shell-tool-result.js";
import {
  createToolExecutionTextOutput,
  type JsonObject,
  type SubagentRequest,
  type ToolExecutor,
  type ToolRequestExecutionMetadata,
} from "../ports.js";
import {
  formatTaskInitialResult,
  type SessionTaskContext,
  type SessionTaskManager,
  type SessionTaskResult,
  type TaskScope,
} from "./session-tasks.js";

interface ManagedCall {
  name: string;
  argumentsJson: string;
  arguments: JsonObject;
  metadata: ToolRequestExecutionMetadata;
}

export interface SessionTaskExecutorOptions {
  manager: SessionTaskManager;
  scope: TaskScope;
  executeSubagent(
    request: SubagentRequest,
    toolCallId: string,
    context: SessionTaskContext,
  ): Promise<SessionTaskResult>;
  onError(error: unknown): void;
}

function parseArguments(text: string): JsonObject {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be an object.");
  }
  return parsed as JsonObject;
}

export function createSessionTaskExecutor<ToolRequest>(
  base: ToolExecutor<ToolRequest>,
  options: SessionTaskExecutorOptions,
): ToolExecutor<ToolRequest> {
  const calls = new WeakMap<object, ManagedCall>();
  let foreground = new AbortController();
  const getCall = (request: ToolRequest): ManagedCall | undefined =>
    typeof request === "object" && request !== null ? calls.get(request) : undefined;
  const rememberCall = (request: ToolRequest, call: ManagedCall): void => {
    if (typeof request === "object" && request !== null) calls.set(request, call);
  };
  const isManaged = (call: ManagedCall | undefined): boolean =>
    call !== undefined && ["shell", "subagent", "delay", "stop_task"].includes(call.name);
  const overrides: Partial<ToolExecutor<ToolRequest>> = {
    async requestFromFunctionCall(name, argumentsJson) {
      const request = await base.requestFromFunctionCall(name, argumentsJson);
      rememberCall(request, {
        name,
        argumentsJson,
        arguments: parseArguments(argumentsJson),
        metadata: {},
      });
      return request;
    },
    attachRequestMetadata(request, metadata) {
      const attached = base.attachRequestMetadata?.(request, metadata) ?? request;
      const call = getCall(request);
      if (call) rememberCall(attached, { ...call, metadata: { ...call.metadata, ...metadata } });
      return attached;
    },
    shouldExecuteInBackground(request) {
      return isManaged(getCall(request)) || (base.shouldExecuteInBackground?.(request) ?? false);
    },
    abortRunningShell() {
      foreground.abort(new Error("Foreground turn stopped."));
      foreground = new AbortController();
      void options.manager.stopForeground(options.scope).catch(options.onError);
    },
    async execute(request) {
      const call = getCall(request);
      if (!call || !isManaged(call)) {
        return base.execute(
          base.attachRequestMetadata?.(request, { signal: foreground.signal }) ?? request,
        );
      }
      if (call.name === "delay") {
        const delayRequest = parseDelayRequest(call.arguments);
        const startedAtUnixMs = Date.now();
        const result = await options.manager.delay(delayRequest, options.scope, foreground.signal);
        return {
          ...createToolExecutionTextOutput(
            JSON.stringify({
              elapsed_seconds: result.elapsedSeconds,
              ...(result.task
                ? {
                    task_id: result.task.id,
                    status: result.task.status,
                    output_path: result.task.outputPath,
                  }
                : {}),
            }),
          ),
          hostUi: {
            delay: {
              startedAtUnixMs,
              ...(delayRequest.seconds !== undefined
                ? { deadlineUnixMs: startedAtUnixMs + delayRequest.seconds * 1000 }
                : {}),
              elapsedMs: result.elapsedSeconds * 1000,
              ...(delayRequest.task_id ? { taskId: delayRequest.task_id } : {}),
            },
          },
        };
      }
      if (call.name === "stop_task") {
        if (typeof call.arguments.task_id !== "string") throw new Error("task_id is required.");
        const task = await options.manager.stop(call.arguments.task_id, options.scope);
        return {
          ...createToolExecutionTextOutput(
            JSON.stringify({
              task_id: task.id,
              status: task.status,
              elapsed_seconds: task.elapsedMs / 1000,
              output_path: task.outputPath,
              ...(task.kind === "shell" ? { exit_code: task.exitCode ?? "unknown" } : {}),
            }),
          ),
          hostUi: { backgroundTask: task },
        };
      }
      const toolCallId = call.metadata.toolCallId;
      if (!toolCallId) throw new Error("Managed execution requires a tool call ID.");
      const input = call.arguments[call.name === "shell" ? "command" : "prompt"];
      if (typeof input !== "string" || !input.trim())
        throw new Error("Task input must be a non-empty string.");
      const background = parseBackgroundOptions(call.arguments.background);
      let detached = false;
      const taskId = await options.manager.launch(
        {
          ...options.scope,
          kind: call.name === "shell" ? "shell" : "subagent",
          toolCallId,
          input,
          argumentsJson: call.argumentsJson,
        },
        async (context) => {
          if (call.name === "subagent") {
            return options.executeSubagent(
              {
                prompt: input,
                ...(call.arguments.worktree === true ? { worktree: true } : {}),
              },
              toolCallId,
              context,
            );
          }
          if (!base.attachRequestMetadata)
            throw new Error("The host does not support managed shell execution.");
          const output = await base.execute(
            base.attachRequestMetadata(request, {
              ...call.metadata,
              signal: context.signal,
              onOutputChunk: async (chunk) => {
                await context.writeOutput(chunk);
                if (!detached) await call.metadata.onOutputChunk?.(chunk);
              },
            }),
          );
          return { output, ...output.execution };
        },
      );
      const result = await options.manager.initialResult(taskId, options.scope, background);
      detached = result.kind === "background";
      if (result.kind === "completed" && call.name === "shell") {
        const shell = parseShellToolResult(result.result.output.summaryText);
        if (shell?.truncated) {
          const text = serializeShellToolResult({ ...shell, outputPath: result.record.outputPath });
          result.result.output = {
            ...result.result.output,
            ...createToolExecutionTextOutput(text),
          };
        }
      }
      return result.kind === "completed"
        ? {
            ...result.result.output,
            execution: {
              failed: result.result.failed === true,
              ...(result.result.exitCode !== undefined ? { exitCode: result.result.exitCode } : {}),
            },
          }
        : {
            ...createToolExecutionTextOutput(formatTaskInitialResult(result)),
            hostUi: { backgroundTask: result.record },
          };
    },
  };
  return new Proxy(base, {
    get(target, key) {
      const override: unknown = Reflect.get(overrides, key);
      if (override !== undefined) return override;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
