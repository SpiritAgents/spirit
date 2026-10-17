import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";

import type { JsonValue } from "../../ports.js";
import { AiSdkOpenResponsesTransport } from "../../open-responses/ai-sdk-transport.js";
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function inputItemCount(body: Record<string, unknown>): number {
  if (!Array.isArray(body.input)) {
    return 0;
  }

  return body.input.length;
}

async function main(): Promise<void> {
  const capturedBodies: Record<string, unknown>[] = [];
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/responses")) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    requestCount += 1;
    const body = await readJsonBody(request);
    capturedBodies.push(body);

    response.writeHead(200, {
      "content-type": "application/json",
    });

    if (requestCount === 1) {
      response.end(JSON.stringify(buildOpenResponsesToolCallBody("gpt-test-incremental")));
      return;
    }

    response.end(
      JSON.stringify(buildOpenResponsesFinalTextBody("gpt-test-incremental", "INCREMENTAL_OK")),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get the local smoke server port.");
  }

  const transport = new AiSdkOpenResponsesTransport();
  const config = {
    transportKind: "open-responses" as const,
    apiKey: "test-key",
    model: "gpt-test-incremental",
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    sdk: "@ai-sdk/openai" as const,
    llmVendor: "openai" as const,
  };
  const tools = demoLookupToolDefinition();

  const initialState = startOpenAiToolAgentState(
    [],
    'Call demo_lookup exactly once with query "incremental". After the tool result, answer exactly "INCREMENTAL_OK".',
    process.cwd(),
    [],
    [],
    config.model,
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, tools);
  printSmokeSection("ai-sdk openai responses incremental smoke step 1", firstRound);

  if (firstRound.kind !== "success" || firstRound.result.step.kind !== "tool-calls") {
    server.close();
    throw new Error("incremental smoke step 1 did not reach tool-calls.");
  }

  const firstCall = firstRound.result.step.calls.at(0);
  if (!firstCall) {
    server.close();
    throw new Error("incremental smoke step 1 did not produce any tool call.");
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstRound.result.state,
    firstCall.id,
    '{"query":"incremental","result":"ok"}',
  );

  const secondRound = await transport.startToolAgentRound(config, resumedState, tools);
  printSmokeSection("ai-sdk openai responses incremental smoke step 2", secondRound);
  server.close();

  if (secondRound.kind !== "success" || secondRound.result.step.kind !== "final-response-ready") {
    throw new Error("incremental smoke step 2 did not reach final-response-ready.");
  }

  const assistantText = extractLastOpenAiAssistantText(secondRound.result.state)?.trim();
  if (assistantText !== "INCREMENTAL_OK") {
    throw new Error(
      `incremental smoke step 2 did not get the expected final assistant text. Actual: ${assistantText ?? "<empty>"}`,
    );
  }

  if (capturedBodies.length !== 2) {
    throw new Error(`incremental smoke expected 2 HTTP requests, got ${capturedBodies.length}.`);
  }

  const firstBody = capturedBodies[0]!;
  const secondBody = capturedBodies[1]!;
  const firstInputCount = inputItemCount(firstBody);
  const secondInputCount = inputItemCount(secondBody);

  if (firstInputCount === 0 || secondInputCount === 0) {
    throw new Error("incremental smoke could not parse the input array from the request body.");
  }

  if (secondInputCount >= firstInputCount) {
    throw new Error(
      `incremental smoke second-round input did not shrink: first=${firstInputCount}, second=${secondInputCount}`,
    );
  }

  const previousResponseId =
    typeof secondBody.previous_response_id === "string"
      ? secondBody.previous_response_id
      : undefined;
  if (previousResponseId !== "resp-tool-call") {
    throw new Error(
      `incremental smoke second round is missing previous_response_id. Actual: ${previousResponseId ?? "<missing>"}`,
    );
  }

  if (secondBody.store !== true) {
    throw new Error("incremental smoke second round did not set store=true.");
  }

  const trace = secondRound.result.requestTrace[0];
  if (!isJsonObject(trace) || !Array.isArray(trace.input)) {
    throw new Error("incremental smoke second-round trace did not record the sliced input.");
  }

  if (trace.input.length >= initialState.messages.length + 2) {
    throw new Error("incremental smoke trace input did not shrink relative to the full state.");
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai responses incremental smoke failed: ${message}`);
  process.exitCode = 1;
});
