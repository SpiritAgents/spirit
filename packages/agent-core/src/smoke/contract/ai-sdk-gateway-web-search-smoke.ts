import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { JsonValue } from "../../ports.js";
import { AiSdkOpenResponsesTransport } from "../../open-responses/ai-sdk-transport.js";
import {
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from "../../openai/tool-agent-helpers.js";
import { printSmokeSection } from "../shared/index.js";

async function main(): Promise<void> {
  await runGatewayWebSearchInjectionSmoke();
  await runGatewayWebSearchInvocationSmoke();
}

async function runGatewayWebSearchInjectionSmoke(): Promise<void> {
  let capturedBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/language-model")) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(buildGatewayV3TextResponse("GATEWAY_WEB_SEARCH_OK")));
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
    model: "openai/gpt-5.4",
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    sdk: "@ai-sdk/gateway" as const,
    providerTools: [
      {
        label: "Perplexity Search",
        tools: [
          { type: "provider", id: "gateway.perplexity_search", name: "web_search", args: {} },
        ],
      },
    ],
    store: false,
  };

  const state = startOpenAiToolAgentState(
    [],
    "Reply with exactly GATEWAY_WEB_SEARCH_OK.",
    process.cwd(),
    [],
    [],
    config.model,
  );
  const round = await transport.startToolAgentRound(config, state, []);
  server.close();

  printSmokeSection("ai-sdk gateway web_search injection smoke", round);
  if (round.kind !== "success" || round.result.step.kind !== "final-response-ready") {
    throw new Error("gateway web_search injection smoke did not reach final-response-ready.");
  }

  if (!requestIncludesGatewayWebSearchTool(capturedBody)) {
    throw new Error(
      "gateway web_search injection smoke request body is missing the gateway.perplexity_search tool.",
    );
  }

  const assistantText = extractLastOpenAiAssistantText(round.result.state)?.trim();
  if (assistantText !== "GATEWAY_WEB_SEARCH_OK") {
    throw new Error(
      `gateway web_search injection smoke did not get the expected text: ${assistantText ?? "<empty>"}`,
    );
  }

  const trace = round.result.requestTrace[0];
  if (!isJsonObject(trace) || trace.kind !== "open_responses_sdk_responses") {
    throw new Error(
      "gateway web_search injection smoke did not write an open_responses_sdk_responses trace.",
    );
  }

  const traceTools = trace.tools as JsonValue[] | undefined;
  if (!traceTools?.some((tool) => isJsonObject(tool) && tool.id === "gateway.perplexity_search")) {
    throw new Error(
      "gateway web_search injection smoke trace is missing the declared provider tool entry.",
    );
  }
}

async function runGatewayWebSearchInvocationSmoke(): Promise<void> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/language-model")) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    if (!requestIncludesGatewayWebSearchTool(body)) {
      response.statusCode = 400;
      response.end("missing gateway web_search tool");
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        buildGatewayV3TextResponse("Gateway web search pricing is $5 per 1k requests."),
      ),
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
    model: "openai/gpt-5.4",
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    sdk: "@ai-sdk/gateway" as const,
    providerTools: [
      {
        label: "Perplexity Search",
        tools: [
          { type: "provider", id: "gateway.perplexity_search", name: "web_search", args: {} },
        ],
      },
    ],
    store: false,
  };

  const state = startOpenAiToolAgentState(
    [],
    "Search the web for the latest AI Gateway web search pricing.",
    process.cwd(),
    [],
    [],
    config.model,
  );
  const round = await transport.startToolAgentRound(config, state, []);
  server.close();

  printSmokeSection("ai-sdk gateway web_search invocation smoke", round);
  if (round.kind !== "success" || round.result.step.kind !== "final-response-ready") {
    throw new Error("gateway web_search invocation smoke did not complete successfully.");
  }
}

function buildGatewayV3TextResponse(text: string): JsonObject {
  return {
    content: [{ type: "text", text }],
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}

type JsonObject = Record<string, JsonValue>;

function requestIncludesGatewayWebSearchTool(body: Record<string, unknown> | undefined): boolean {
  const tools = body?.tools;
  if (!Array.isArray(tools)) {
    return false;
  }

  return tools.some((tool) => {
    if (!isJsonObject(tool as JsonValue)) {
      return false;
    }

    const record = tool as Record<string, unknown>;
    // The gateway language-model API requires provider tools to carry the model-facing `name`
    // alongside `id`; an id-only entry passes a loose check here but 400s against the real API.
    return (
      record.type === "provider" &&
      record.id === "gateway.perplexity_search" &&
      record.name === "web_search"
    );
  });
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk gateway web_search smoke failed: ${message}`);
  process.exitCode = 1;
});
