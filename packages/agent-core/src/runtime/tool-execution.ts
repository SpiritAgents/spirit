import {
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  type LlmMessage,
  type ToolExecutionOutput,
} from "../ports.js";

import { renderError } from "./helpers.js";
import type { AgentRuntimeOptions, RuntimeEvent } from "./types.js";

export interface ToolExecutionResult {
  output: ToolExecutionOutput;
  failed: boolean;
  backgroundExecution: boolean;
}

export interface ToolExecutionRuntime<Config, State, ToolRequest> {
  options: AgentRuntimeOptions<Config, State, ToolRequest>;
  historyStore: LlmMessage[];
  pendingBackgroundToolStatusStore: string | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
}

export async function performToolExecution<Config, State, ToolRequest>(
  runtime: ToolExecutionRuntime<Config, State, ToolRequest>,
  request: ToolRequest,
  toolName: string,
  _toolCallId?: string,
): Promise<ToolExecutionResult> {
  let output: ToolExecutionOutput;
  let failed = false;
  const backgroundExecution =
    runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false;
  const backgroundStatusText = backgroundExecution
    ? runtime.options.toolExecutor.backgroundStatusText?.(request)
    : undefined;

  if (backgroundExecution) {
    runtime.pendingBackgroundToolStatusStore = backgroundStatusText;
    runtime.emitEvent({
      kind: "background-tool-status",
      phase: "started",
      toolName,
      request,
      ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
    });
  }

  try {
    output = await runtime.options.toolExecutor.execute(request);
    failed = output.execution?.failed === true;
  } catch (error) {
    failed = true;
    const summaryText = `[tool error] ${renderError(error)}`;
    output = {
      content: createLlmMessageContentFromText(summaryText),
      summaryText,
    };
  } finally {
    if (backgroundExecution) {
      runtime.pendingBackgroundToolStatusStore = undefined;
      runtime.emitEvent({
        kind: "background-tool-status",
        phase: "finished",
        toolName,
        request,
        ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
        failed,
      });
    }
  }

  return {
    output,
    failed,
    backgroundExecution,
  };
}

export function syncPreparedToolResultContentToHistory<Config, State, ToolRequest>(
  runtime: Pick<ToolExecutionRuntime<Config, State, ToolRequest>, "historyStore">,
  toolCallId: string,
  preparedContent: string,
): void {
  const content = createLlmMessageContentFromText(preparedContent);
  for (let index = runtime.historyStore.length - 1; index >= 0; index -= 1) {
    const message = runtime.historyStore[index];
    if (message?.role === "tool" && message.toolCallId === toolCallId) {
      runtime.historyStore[index] = {
        role: "tool",
        toolCallId,
        content: cloneLlmMessageContent(content),
      };
      return;
    }
  }

  runtime.historyStore.push({
    role: "tool",
    toolCallId,
    content: cloneLlmMessageContent(content),
  });
}
