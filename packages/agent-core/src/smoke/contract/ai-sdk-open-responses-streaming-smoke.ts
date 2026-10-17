import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { JsonValue } from "../../ports.js";
import { AiSdkOpenResponsesTransport } from "../../open-responses/ai-sdk-transport.js";
import { startOpenAiToolAgentState } from "../../openai/tool-agent-helpers.js";

import { demoLookupToolDefinition, printSmokeSection } from "../shared/index.js";

function sseEvent(payload: JsonValue): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || !request.url?.includes("/responses")) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    const chunks = [
      sseEvent({
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_stream_1",
          call_id: "call_open_responses_stream_1",
          name: "demo_lookup",
          arguments: "",
          status: "in_progress",
        },
      }),
      sseEvent({
        type: "response.function_call_arguments.delta",
        item_id: "fc_stream_1",
        delta: '{"query"',
      }),
      sseEvent({
        type: "response.function_call_arguments.delta",
        item_id: "fc_stream_1",
        delta: ':"Spirit streaming"}',
      }),
      sseEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "fc_stream_1",
          call_id: "call_open_responses_stream_1",
          name: "demo_lookup",
          arguments: '{"query":"Spirit streaming"}',
          status: "completed",
        },
      }),
      sseEvent({
        type: "response.completed",
        response: {
          id: "resp-stream",
          status: "completed",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      }),
    ];

    for (const chunk of chunks) {
      response.write(chunk);
    }
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get the local smoke server port.");
  }

  const transport = new AiSdkOpenResponsesTransport();
  const state = startOpenAiToolAgentState(
    [],
    "Call demo_lookup exactly once.",
    process.cwd(),
    [],
    [],
    "test-open-responses",
  );
  const started = await transport.startToolAgentRoundStreaming(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "test-open-responses",
      baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
      sdk: "@ai-sdk/open-responses",
    },
    state,
    demoLookupToolDefinition(),
  );

  const events = await collectEvents(started.eventStream);
  const completion = await started.completion;
  server.close();

  printSmokeSection("ai-sdk open-responses streaming smoke events", events);
  printSmokeSection("ai-sdk open-responses streaming smoke completion", completion);

  const previewEvents = events.filter(
    (event) => isJsonObject(event) && event.kind === "streaming-tool-preview",
  );
  if (previewEvents.length === 0) {
    throw new Error(
      "ai-sdk open-responses streaming smoke did not receive a streaming-tool-preview event.",
    );
  }

  if (completion.kind !== "success" || completion.result.step.kind !== "tool-calls") {
    throw new Error("ai-sdk open-responses streaming smoke did not reach the expected tool-calls.");
  }

  if (completion.result.step.calls[0]?.id !== "call_open_responses_stream_1") {
    throw new Error(
      "ai-sdk open-responses streaming smoke did not preserve the streaming toolCallId.",
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk open-responses streaming smoke failed: ${message}`);
  process.exitCode = 1;
});
