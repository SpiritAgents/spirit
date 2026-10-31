import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue } from "../../ports.js";
import { createLlmMessageContentFromTextAndImages } from "../../ports.js";
import { AiSdkOpenAiCompatibleTransport } from "../../openai/ai-sdk-transport.js";
import { resolveOpenAiModelCompatibilityProfile } from "../../openai/openai-compat.js";
import { materializeProviderPreset } from "../../provider-presets/materialize.js";
import {
  appendOpenAiToolResultMessage,
  continueOpenAiToolAgentState,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from "../../openai/tool-agent-helpers.js";

import { demoLookupToolDefinition, printSmokeSection } from "../shared/index.js";

function sseEvent(payload: JsonValue): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function main(): Promise<void> {
  let requestCount = 0;
  const requestBodies: JsonValue[] = [];

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    requestBodies.push(await readJsonBody(request));
    requestCount += 1;

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    const chunks =
      requestCount === 1
        ? [
            {
              id: "chatcmpl-deepseek-stream-1",
              object: "chat.completion.chunk",
              created: 0,
              model: "deepseek-v4-flash",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_deepseek_stream_1",
                        type: "function",
                        function: {
                          name: "demo_lookup",
                          arguments: '{"query"',
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl-deepseek-stream-1",
              object: "chat.completion.chunk",
              created: 0,
              model: "deepseek-v4-flash",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        type: "function",
                        function: { arguments: ':"Spirit deepseek"}' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl-deepseek-stream-1",
              object: "chat.completion.chunk",
              created: 0,
              model: "deepseek-v4-flash",
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
          ]
        : [
            {
              id: "chatcmpl-deepseek-stream-2",
              object: "chat.completion.chunk",
              created: 0,
              model: "deepseek-v4-flash",
              choices: [
                {
                  index: 0,
                  delta: { content: "AI_SDK_DEEPSEEK_OK" },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl-deepseek-stream-2",
              object: "chat.completion.chunk",
              created: 0,
              model: "deepseek-v4-flash",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ];

    for (const chunk of chunks) {
      response.write(sseEvent(chunk as JsonValue));
    }
    response.write("data: [DONE]\n\n");
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get the local smoke server port.");
  }

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/v1`;
  const entry = materializeProviderPreset({ presetId: "deepseek", apiBaseOverride: baseUrl });
  const transport = new AiSdkOpenAiCompatibleTransport();
  const config = {
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    baseUrl: entry.apiBase,
    ...(entry.sdk !== undefined ? { sdk: entry.sdk } : {}),
    ...(entry.providerTools !== undefined ? { providerTools: entry.providerTools } : {}),
  };
  const state = startOpenAiToolAgentState(
    [],
    "Call demo_lookup exactly once.",
    process.cwd(),
    [],
    [],
    config.model,
  );
  const started = await transport.startToolAgentRoundStreaming(
    config,
    state,
    demoLookupToolDefinition(),
  );

  const firstEvents = await collectEvents(started.eventStream);
  const firstCompletion = await started.completion;

  printSmokeSection("ai-sdk deepseek streaming smoke step 1 events", firstEvents);
  printSmokeSection("ai-sdk deepseek streaming smoke step 1 completion", firstCompletion);

  if (
    !firstEvents.some((event) => isJsonObject(event) && event.kind === "streaming-tool-preview")
  ) {
    server.close();
    throw new Error(
      "ai-sdk deepseek streaming smoke did not receive a streaming-tool-preview event.",
    );
  }

  if (firstCompletion.kind !== "success" || firstCompletion.result.step.kind !== "tool-calls") {
    server.close();
    throw new Error(
      "ai-sdk deepseek streaming smoke step 1 did not reach the expected tool-calls.",
    );
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstCompletion.result.state,
    "call_deepseek_stream_1",
    '{"query":"Spirit deepseek","result":"official provider ok"}',
  );

  const secondStarted = await transport.startToolAgentRoundStreaming(
    config,
    resumedState,
    demoLookupToolDefinition(),
  );

  const secondEvents = await collectEvents(secondStarted.eventStream);
  const secondCompletion = await secondStarted.completion;
  server.close();

  printSmokeSection("ai-sdk deepseek streaming smoke step 2 events", secondEvents);
  printSmokeSection("ai-sdk deepseek streaming smoke step 2 completion", secondCompletion);

  if (
    secondCompletion.kind !== "success" ||
    secondCompletion.result.step.kind !== "final-response-ready"
  ) {
    throw new Error(
      "ai-sdk deepseek streaming smoke step 2 did not reach the expected final-response-ready.",
    );
  }

  const assistantText = extractLastOpenAiAssistantText(secondCompletion.result.state)?.trim();
  if (assistantText !== "AI_SDK_DEEPSEEK_OK") {
    throw new Error(
      `ai-sdk deepseek streaming smoke step 2 did not get the expected final assistant text. Actual: ${assistantText ?? "<empty>"}`,
    );
  }

  const firstRequest = requestBodies[0];
  if (!isJsonObject(firstRequest)) {
    throw new Error(
      "ai-sdk deepseek streaming smoke did not capture the first-round request body.",
    );
  }
  const firstTools = firstRequest.tools as
    | Array<{ type?: string; function?: { name?: string } }>
    | undefined;
  const searchTool = firstTools?.find((tool) => tool.function?.name === "web_search");
  if (searchTool?.type !== "function") {
    throw new Error(
      "ai-sdk deepseek streaming smoke first-round request did not inject function web_search.",
    );
  }
  if (firstTools?.some((tool) => tool.type === "web_search")) {
    throw new Error(
      "ai-sdk deepseek streaming smoke must not inject a Responses built-in web_search entry.",
    );
  }

  const roundTwoBody = requestBodies[1];
  if (!isJsonObject(roundTwoBody) || !Array.isArray(roundTwoBody.messages)) {
    throw new Error(
      "ai-sdk deepseek streaming smoke second round did not send the Chat message history.",
    );
  }
  const hasToolResult = roundTwoBody.messages.some(
    (message) =>
      isJsonObject(message) &&
      message.role === "tool" &&
      message.tool_call_id === "call_deepseek_stream_1" &&
      message.content === '{"query":"Spirit deepseek","result":"official provider ok"}',
  );
  if (!hasToolResult) {
    throw new Error(
      "ai-sdk deepseek streaming smoke second round did not send the tool result history.",
    );
  }

  const traceEntry = secondCompletion.result.requestTrace[0];
  if (!isJsonObject(traceEntry) || traceEntry.kind !== "openai_sdk_chat_completions") {
    throw new Error(
      "ai-sdk deepseek streaming smoke did not mark the openai_sdk_chat_completions trace kind.",
    );
  }

  await runDeepSeekVisionCapabilitySmoke();
  verifyDeclaredCapabilitiesProfile();
}

async function runDeepSeekVisionCapabilitySmoke(): Promise<void> {
  const requestBodies: JsonValue[] = [];
  const warnings: JsonValue[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    requestBodies.push(await readJsonBody(request));
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    response.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-deepseek-vision-capability",
        object: "chat.completion.chunk",
        created: 0,
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            delta: { content: "AI_SDK_DEEPSEEK_VISION_FILTER_OK" },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-deepseek-vision-capability",
        object: "chat.completion.chunk",
        created: 0,
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      })}\n\n`,
    );
    response.write("data: [DONE]\n\n");
    response.end();
  });

  const tempDir = await mkdtemp(join(tmpdir(), "spirit-deepseek-vision-capability-"));
  const imagePath = join(tempDir, "vision-test.png");
  await writeFile(
    imagePath,
    Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000188f53d5d0000000049454e44ae426082",
      "hex",
    ),
  );

  const warningHost = globalThis as typeof globalThis & {
    AI_SDK_LOG_WARNINGS: false | DeepSeekSmokeWarningLogger | undefined;
  };
  const previousWarningLogger = warningHost.AI_SDK_LOG_WARNINGS;
  warningHost.AI_SDK_LOG_WARNINGS = ((options: DeepSeekSmokeWarningOptions) => {
    warnings.push(options as unknown as JsonValue);
  }) as typeof warningHost.AI_SDK_LOG_WARNINGS;

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to get the DeepSeek vision capability smoke server port.");
    }

    const transport = new AiSdkOpenAiCompatibleTransport();
    const state = continueOpenAiToolAgentState(
      [
        {
          role: "user",
          content: createLlmMessageContentFromTextAndImages("Please look at the image.", [
            imagePath,
          ]),
        },
      ],
      process.cwd(),
      [],
      [],
      "deepseek-v4-pro",
    );

    const started = await transport.startToolAgentRoundStreaming(
      {
        apiKey: "test-key",
        model: "deepseek-v4-pro",
        baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
        // Declared text-only capability profile: the compat layer trims the image part upfront.
        modelCapabilities: { languageModel: true },
      },
      state,
      demoLookupToolDefinition(),
    );

    const events = await collectEvents(started.eventStream);
    const completion = await started.completion;

    printSmokeSection("ai-sdk deepseek vision capability smoke request bodies", requestBodies);
    printSmokeSection("ai-sdk deepseek vision capability smoke events", events);
    printSmokeSection("ai-sdk deepseek vision capability smoke completion", completion);

    if (completion.kind !== "success" || completion.result.step.kind !== "final-response-ready") {
      throw new Error(
        "DeepSeek vision capability smoke did not reach the expected final-response-ready.",
      );
    }

    const assistantText = extractLastOpenAiAssistantText(completion.result.state)?.trim();
    if (assistantText !== "AI_SDK_DEEPSEEK_VISION_FILTER_OK") {
      throw new Error(
        `DeepSeek vision capability smoke has an unexpected final assistant text: ${assistantText ?? "<empty>"}`,
      );
    }

    if (warnings.length > 0) {
      throw new Error(
        "DeepSeek vision capability smoke still received an AI SDK warning, so the upfront trimming did not take effect.",
      );
    }

    const requestBody = requestBodies[0];
    const userMessage = findLastUserMessage(requestBody);
    if (!isJsonObject(userMessage)) {
      throw new Error("DeepSeek vision capability smoke did not find the user message.");
    }

    if (Array.isArray(userMessage.content)) {
      const hasNonTextPart = userMessage.content.some(
        (part) => isJsonObject(part) && part.type !== "text",
      );
      if (hasNonTextPart) {
        throw new Error(
          "DeepSeek vision capability smoke still sent a non-text user part to the provider.",
        );
      }
    }
  } finally {
    warningHost.AI_SDK_LOG_WARNINGS = previousWarningLogger;
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

interface DeepSeekSmokeWarningOptions {
  warnings: unknown[];
  provider: string;
  model: string;
}

type DeepSeekSmokeWarningLogger = (options: DeepSeekSmokeWarningOptions) => void;

function verifyDeclaredCapabilitiesProfile(): void {
  // Undeclared capabilities mean "no explicit profile": the compat layer trims nothing.
  const undeclared = resolveOpenAiModelCompatibilityProfile({
    model: "deepseek-v4-pro",
  });
  if (undeclared.hasExplicitCapabilities) {
    throw new Error(
      "Capabilities profile is abnormal: undeclared capabilities must not trim requests.",
    );
  }

  // Declared capabilities are honored verbatim, including trimming undeclared modalities.
  const declared = resolveOpenAiModelCompatibilityProfile({
    model: "kimi-k2.5",
    modelCapabilities: { languageModel: true },
  });
  if (!declared.hasExplicitCapabilities || declared.capabilities.imageInput) {
    throw new Error(
      "Capabilities profile is abnormal: declared capabilities should drop imageInput here.",
    );
  }

  const withImageInput = resolveOpenAiModelCompatibilityProfile({
    model: "kimi-k2.5",
    modelCapabilities: { imageInput: true },
  });
  if (!withImageInput.capabilities.imageInput) {
    throw new Error(
      "Capabilities profile is abnormal: explicit modelCapabilities should preserve imageInput.",
    );
  }
}

async function collectEvents(
  stream: AsyncIterable<{ kind: string } & Record<string, unknown>>,
): Promise<JsonValue[]> {
  const events: JsonValue[] = [];
  for await (const event of stream) {
    events.push(event as unknown as JsonValue);
  }
  return events;
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

function findLastUserMessage(requestBody: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(requestBody) || !Array.isArray(requestBody.messages)) {
    return undefined;
  }

  return [...requestBody.messages]
    .reverse()
    .find((message) => isJsonObject(message) && message.role === "user");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk deepseek streaming smoke failed: ${message}`);
  process.exitCode = 1;
});
