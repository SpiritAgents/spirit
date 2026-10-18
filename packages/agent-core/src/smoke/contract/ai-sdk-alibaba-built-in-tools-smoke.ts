import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { AiSdkOpenAiCompatibleTransport } from "../../openai/ai-sdk-transport.js";
import { AiSdkOpenResponsesTransport } from "../../open-responses/ai-sdk-transport.js";
import {
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from "../../openai/tool-agent-helpers.js";

import { printSmokeSection } from "../shared/index.js";
import { buildOpenResponsesFinalTextBody } from "./open-responses-mock.js";

// The providerTools entry-body mechanism: pure body-switch entries merge their `body` fields into
// every request while provider tools are enabled (the alibaba preset materializes enable_search /
// enable_code_interpreter this way).
const DECLARED_PROVIDER_TOOLS = [
  {
    label: "Web Search",
    body: { enable_search: true, search_options: { search_strategy: "agent_max" } },
  },
  { label: "Code Interpreter", body: { enable_code_interpreter: true } },
];

async function main(): Promise<void> {
  await runChatCompletionsEntryBodySmoke();
  await runOpenResponsesEntryBodySmoke();
}

async function runChatCompletionsEntryBodySmoke(): Promise<void> {
  let capturedBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/chat/completions")) {
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
    response.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "qwen3-max",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ENTRY_BODY_CHAT_OK" },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get the local smoke server port.");
  }

  const transport = new AiSdkOpenAiCompatibleTransport();
  const config = {
    transportKind: "openai-compatible" as const,
    apiKey: "test-key",
    model: "qwen3-max",
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    providerTools: DECLARED_PROVIDER_TOOLS,
  };

  const state = startOpenAiToolAgentState(
    [],
    "Reply with exactly ENTRY_BODY_CHAT_OK.",
    process.cwd(),
    [],
    [],
    config.model,
  );
  const round = await transport.startToolAgentRound(config, state, []);
  server.close();

  printSmokeSection("chat-completions provider tool entry body smoke", round);
  if (round.kind !== "success" || round.result.step.kind !== "final-response-ready") {
    throw new Error("chat-completions entry body smoke did not reach final-response-ready.");
  }

  if (capturedBody?.enable_search !== true || capturedBody?.enable_code_interpreter !== true) {
    throw new Error(
      "chat-completions entry body smoke request body is missing the declared entry body fields.",
    );
  }
  assertSearchStrategy(capturedBody);
}

async function runOpenResponsesEntryBodySmoke(): Promise<void> {
  let capturedBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/responses")) {
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
    response.end(JSON.stringify(buildOpenResponsesFinalTextBody("qwen3-max", "RESP_OK")));
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
    model: "qwen3-max",
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    sdk: "@ai-sdk/open-responses",
    providerTools: DECLARED_PROVIDER_TOOLS,
  };

  const state = startOpenAiToolAgentState(
    [],
    "Reply with exactly RESP_OK.",
    process.cwd(),
    [],
    [],
    config.model,
  );
  const round = await transport.startToolAgentRound(config, state, []);
  server.close();

  printSmokeSection("open-responses provider tool entry body smoke", round);
  if (round.kind !== "success" || round.result.step.kind !== "final-response-ready") {
    throw new Error("open-responses entry body smoke did not reach final-response-ready.");
  }

  if (capturedBody?.enable_search !== true || capturedBody?.enable_code_interpreter !== true) {
    throw new Error(
      "open-responses entry body smoke request body is missing the declared entry body fields.",
    );
  }
  assertSearchStrategy(capturedBody);

  const assistantText = extractLastOpenAiAssistantText(round.result.state)?.trim();
  if (assistantText !== "RESP_OK") {
    throw new Error(
      `open-responses entry body smoke did not get the expected text: ${assistantText ?? "<empty>"}`,
    );
  }
}

function assertSearchStrategy(capturedBody: Record<string, unknown> | undefined): void {
  const searchOptions = capturedBody?.search_options as Record<string, unknown> | undefined;
  if (searchOptions?.search_strategy !== "agent_max") {
    throw new Error("entry body smoke request body is missing the nested search_options.");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk provider tool entry body smoke failed: ${message}`);
  process.exitCode = 1;
});
