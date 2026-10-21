import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { JsonValue } from "../../ports.js";
import { AiSdkOpenResponsesTransport } from "../../open-responses/ai-sdk-transport.js";
import { AiSdkOpenAiCompatibleTransport } from "../../openai/ai-sdk-transport.js";
import type { OpenAiJsonSchemaCompletionRequest } from "../../openai/json-schema.js";

import { printSmokeSection } from "../shared/index.js";

async function main(): Promise<void> {
  const chatRequestBodies: JsonValue[] = [];
  const responsesRequestBodies: JsonValue[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    if (request.url === "/v1/chat/completions") {
      chatRequestBodies.push(await readJsonBody(request));
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          id: "chatcmpl-json-openai",
          object: "chat.completion",
          created: 0,
          model: "test-openai-compatible",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ message: "AI_SDK_JSON_SCHEMA_OK" }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      );
      return;
    }

    if (request.url?.includes("/responses")) {
      responsesRequestBodies.push(await readJsonBody(request));
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          id: "resp-deepseek-json",
          object: "response",
          created_at: 0,
          model: "deepseek-v4-flash",
          status: "completed",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 2,
          },
          output: [
            {
              type: "message",
              id: "msg_json_1",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ message: "AI_SDK_DEEPSEEK_JSON_OK" }),
                },
              ],
            },
          ],
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get the local smoke server port.");
  }

  const host = `http://127.0.0.1:${(address as AddressInfo).port}`;
  const compatibleTransport = new AiSdkOpenAiCompatibleTransport();
  const responsesTransport = new AiSdkOpenResponsesTransport();
  const request: OpenAiJsonSchemaCompletionRequest = {
    userPrompt: "Return a JSON object with a commit message.",
    schemaName: "structured_message",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: {
          type: "string",
        },
      },
      required: ["message"],
    },
  };

  const openAiResult = await compatibleTransport.createJsonSchemaCompletion<{ message: string }>(
    {
      apiKey: "test-key",
      model: "test-openai-compatible",
      baseUrl: `${host}/v1`,
    },
    request,
  );
  const deepseekResult = await responsesTransport.createJsonSchemaCompletion<{ message: string }>(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      baseUrl: host,
    },
    request,
  );
  server.close();

  printSmokeSection("ai-sdk openai json-schema smoke", openAiResult);
  printSmokeSection("ai-sdk deepseek json-schema smoke", deepseekResult);

  if (openAiResult.output.message !== "AI_SDK_JSON_SCHEMA_OK") {
    throw new Error(
      "ai-sdk openai json-schema smoke did not get the expected OpenAI-compatible structured output.",
    );
  }
  if (deepseekResult.output.message !== "AI_SDK_DEEPSEEK_JSON_OK") {
    throw new Error(
      "ai-sdk deepseek json-schema smoke did not get the expected DeepSeek structured output.",
    );
  }

  const openAiRequest = chatRequestBodies[0];
  if (
    !isJsonObject(openAiRequest) ||
    !isJsonObject(openAiRequest.response_format) ||
    openAiRequest.response_format.type !== "json_schema"
  ) {
    throw new Error(
      "ai-sdk openai json-schema smoke did not send a json_schema response_format on the OpenAI-compatible request.",
    );
  }

  const deepseekRequest = responsesRequestBodies[0];
  if (!isJsonObject(deepseekRequest)) {
    throw new Error(
      "ai-sdk deepseek json-schema smoke did not capture the Responses request body.",
    );
  }
  const textConfig = isJsonObject(deepseekRequest.text as JsonValue)
    ? (deepseekRequest.text as Record<string, JsonValue>).format
    : undefined;
  if (
    !isJsonObject(textConfig as JsonValue) ||
    (textConfig as { type?: string }).type !== "json_schema"
  ) {
    throw new Error(
      "ai-sdk deepseek json-schema smoke did not send a json_schema text.format on the Responses request.",
    );
  }

  const openAiTrace = openAiResult.requestTrace[0];
  if (!isJsonObject(openAiTrace) || openAiTrace.kind !== "openai_sdk_chat_completions") {
    throw new Error(
      "ai-sdk openai json-schema smoke did not write an OpenAI-compatible request trace.",
    );
  }
  const deepseekTrace = deepseekResult.requestTrace[0];
  if (!isJsonObject(deepseekTrace) || deepseekTrace.kind !== "open_responses_sdk_responses") {
    throw new Error(
      "ai-sdk deepseek json-schema smoke did not write an open_responses_sdk_responses trace.",
    );
  }
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonValue;
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai json-schema smoke failed: ${message}`);
  process.exitCode = 1;
});
