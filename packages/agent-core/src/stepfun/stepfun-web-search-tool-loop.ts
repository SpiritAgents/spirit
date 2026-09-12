import { getLlmFetch } from "../llm-fetch.js";
import type { JsonObject } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import type { LlmTransportConfig } from "../provider-config.js";
import type { ToolCallRequest } from "../ports.js";
import { readWebSearchQuery } from "../web-search/read-web-search-query.js";
import { buildStepfunWebSearchToolPreviewArgumentsJson } from "./stepfun-spirit-ui.js";
import { isStepfunManagedWebSearchToolCall } from "./stepfun-eligibility.js";
import { invokeStepfunSearch } from "./stepfun-search-client.js";

export function readStepfunWebSearchQuery(argumentsJson: string): string {
  return readWebSearchQuery(argumentsJson);
}

function readStepfunWebSearchResultCount(argumentsJson: string): number | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonObject;
    if (!isJsonObject(parsed)) {
      return undefined;
    }
    const maxResults = parsed.max_results;
    if (typeof maxResults !== "number" || !Number.isFinite(maxResults)) {
      return undefined;
    }
    const truncated = Math.trunc(maxResults);
    if (truncated < 1 || truncated > 20) {
      return undefined;
    }
    return truncated;
  } catch {
    return undefined;
  }
}

export type StepfunWebSearchToolExecutionResult =
  | { kind: "succeeded"; content: string; previewArgumentsJson: string }
  | { kind: "failed"; error: string; previewArgumentsJson: string };

export async function executeStepfunWebSearchToolCall(
  config: LlmTransportConfig,
  call: Pick<ToolCallRequest, "name" | "argumentsJson">,
  fetchImpl: typeof fetch = getLlmFetch(),
): Promise<StepfunWebSearchToolExecutionResult> {
  const query = readStepfunWebSearchQuery(call.argumentsJson);
  const n = readStepfunWebSearchResultCount(call.argumentsJson);
  const apiKey = (config as { apiKey?: string }).apiKey ?? "";

  const searchResult = await invokeStepfunSearch(
    apiKey,
    { query, ...(n !== undefined ? { n } : {}) },
    fetchImpl,
    (config as { baseUrl?: string }).baseUrl,
  );

  if (searchResult.kind === "failed") {
    return {
      kind: "failed",
      error: searchResult.error,
      previewArgumentsJson: buildStepfunWebSearchToolPreviewArgumentsJson({
        query,
        failed: true,
        status: "failed",
      }),
    };
  }

  return {
    kind: "succeeded",
    content: searchResult.content,
    previewArgumentsJson: buildStepfunWebSearchToolPreviewArgumentsJson({
      query,
      status: "completed",
      outputExcerpt: searchResult.content,
    }),
  };
}

export function buildStepfunWebSearchStreamingPreviewArgumentsJson(
  config: LlmTransportConfig,
  toolName: string,
  argumentsJson: string,
): string | undefined {
  if (!isStepfunManagedWebSearchToolCall(toolName, config)) {
    return undefined;
  }

  return buildStepfunWebSearchToolPreviewArgumentsJson({
    query: readStepfunWebSearchQuery(argumentsJson),
    status: "in_progress",
  });
}
