import { resolveHookSessionContext } from "../hooks/integration.js";
import { appendNestedAgentsReminder } from "../nested-agents.js";
import { prepareToolOutputForAppend } from "../tool-output-truncation.js";

import { syncPreparedToolResultContentToHistory } from "./tool-execution.js";
import type { AgentRuntimeOptions } from "./types.js";
import type { LlmMessage } from "../ports.js";

export interface RuntimeToolResultDiscoveryContext<ToolRequest> {
  toolName: string;
  request: ToolRequest;
  failed: boolean;
}

export async function prepareRuntimeToolResultContentForAppend<Config, State, ToolRequest>(
  options: AgentRuntimeOptions<Config, State, ToolRequest>,
  toolCallId: string,
  content: string,
  discoveryContext?: RuntimeToolResultDiscoveryContext<ToolRequest>,
): Promise<string> {
  const sessionId = resolveHookSessionContext(options).sessionId;
  const prepared = await prepareToolOutputForAppend({
    content,
    toolCallId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(options.persistToolOutputArchive !== undefined
      ? { persistArchive: options.persistToolOutputArchive }
      : {}),
  });

  if (!discoveryContext || !options.nestedAgentsTracker) {
    return prepared;
  }

  const notifications = await options.nestedAgentsTracker.discoverForToolCall({
    toolName: discoveryContext.toolName,
    request: discoveryContext.request,
    rawOutput: content,
    failed: discoveryContext.failed,
  });
  return appendNestedAgentsReminder(prepared, notifications);
}

export async function prepareAndSyncRuntimeToolResultToHistory<Config, State, ToolRequest>(
  runtime: {
    options: AgentRuntimeOptions<Config, State, ToolRequest>;
    historyStore: LlmMessage[];
  },
  toolCallId: string,
  content: string,
  discoveryContext?: RuntimeToolResultDiscoveryContext<ToolRequest>,
): Promise<string> {
  const prepared = await prepareRuntimeToolResultContentForAppend(
    runtime.options,
    toolCallId,
    content,
    discoveryContext,
  );
  syncPreparedToolResultContentToHistory(runtime, toolCallId, prepared);
  return prepared;
}
