import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { JsonValue } from "../../ports.js";
import { AiSdkOpenResponsesTransport } from "../../open-responses/ai-sdk-transport.js";
import { materializeProviderPreset } from "../../provider-presets/materialize.js";
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from "../../openai/tool-agent-helpers.js";

import { demoLookupToolDefinition, printSmokeSection } from "../shared/index.js";
import {
  buildOpenResponsesFinalTextBody,
  buildOpenResponsesToolCallBody,
} from "./open-responses-mock.js";

async function main(): Promise<void> {
  let requestCount = 0;
  let capturedBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/responses")) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    requestCount += 1;
    capturedBody = (await readJsonBody(request)) as Record<string, unknown>;
    response.writeHead(200, {
      "content-type": "application/json",
    });

    if (requestCount === 1) {
      response.end(JSON.stringify(buildOpenResponsesToolCallBody("deepseek-v4-flash")));
      return;
    }

    response.end(
      JSON.stringify(buildOpenResponsesFinalTextBody("deepseek-v4-flash", "DEEPSEEK_RESPONSES_OK")),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get the local smoke server port.");
  }

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  const entry = materializeProviderPreset({
    presetId: "deepseek",
    transportKind: "open-responses",
    apiBaseOverride: baseUrl,
  });
  const execute = entry.providerTools?.[0]?.execute;
  if (execute?.url !== "https://api.deepseek.com/v1/tools/search" || execute.path !== undefined) {
    server.close();
    throw new Error(
      "ai-sdk deepseek responses smoke did not bake the search execute URL onto the Chat /v1 root.",
    );
  }

  const transport = new AiSdkOpenResponsesTransport();
  const config = {
    transportKind: "open-responses" as const,
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    baseUrl: entry.apiBase,
    ...(entry.sdk !== undefined ? { sdk: entry.sdk } : {}),
    ...(entry.providerTools !== undefined ? { providerTools: entry.providerTools } : {}),
  };
  const tools = demoLookupToolDefinition();

  const initialState = startOpenAiToolAgentState(
    [],
    "First call demo_lookup exactly once. Then answer with exactly DEEPSEEK_RESPONSES_OK.",
    process.cwd(),
    [],
    [],
    config.model,
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, tools);
  printSmokeSection("ai-sdk deepseek responses smoke step 1", firstRound);

  if (firstRound.kind !== "success" || firstRound.result.step.kind !== "tool-calls") {
    server.close();
    throw new Error("ai-sdk deepseek responses smoke step 1 did not reach tool-calls.");
  }

  if (entry.options !== undefined) {
    server.close();
    throw new Error("ai-sdk deepseek responses smoke must not materialize legacy options.");
  }
  const toolsOnRequest = capturedBody?.tools as Array<{ type?: string; name?: string }> | undefined;
  const searchTool = toolsOnRequest?.find((tool) => tool.name === "web_search");
  if (!toolsOnRequest || searchTool?.type !== "function") {
    server.close();
    throw new Error("ai-sdk deepseek responses smoke request body is missing function web_search.");
  }
  if (
    toolsOnRequest.some(
      (tool) => tool.type === "web_search" || tool.type === "web_search_2025_08_26",
    )
  ) {
    server.close();
    throw new Error("ai-sdk deepseek responses smoke should not inject built-in web_search.");
  }
  if (toolsOnRequest.some((tool) => tool.type === "apply_patch")) {
    server.close();
    throw new Error("ai-sdk deepseek responses smoke should not inject apply_patch.");
  }

  const firstCall = firstRound.result.step.calls.at(0);
  if (!firstCall) {
    server.close();
    throw new Error("ai-sdk deepseek responses smoke step 1 did not produce any tool call.");
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstRound.result.state,
    firstCall.id,
    '{"query":"Spirit migration","result":"deepseek responses ok"}',
  );

  const secondRound = await transport.startToolAgentRound(config, resumedState, tools);
  printSmokeSection("ai-sdk deepseek responses smoke step 2", secondRound);
  server.close();

  if (secondRound.kind !== "success" || secondRound.result.step.kind !== "final-response-ready") {
    throw new Error("ai-sdk deepseek responses smoke step 2 did not reach final-response-ready.");
  }

  const assistantText = extractLastOpenAiAssistantText(secondRound.result.state)?.trim();
  if (assistantText !== "DEEPSEEK_RESPONSES_OK") {
    throw new Error(
      `ai-sdk deepseek responses smoke step 2 did not get the expected final assistant text. Actual: ${assistantText ?? "<empty>"}`,
    );
  }

  const traceKind = secondRound.result.requestTrace[0];
  if (!isJsonObject(traceKind) || traceKind.kind !== "open_responses_sdk_responses") {
    throw new Error(
      "ai-sdk deepseek responses smoke did not write an open_responses_sdk_responses trace.",
    );
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonValue;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk deepseek responses smoke failed: ${message}`);
  process.exitCode = 1;
});
