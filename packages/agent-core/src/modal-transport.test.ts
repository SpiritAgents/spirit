import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { AiSdkAnthropicTransport } from "./anthropic/ai-sdk-transport.js";
import { AiSdkOpenAiCompatibleTransport } from "./openai/ai-sdk-transport.js";
import { AiSdkOpenResponsesTransport } from "./open-responses/ai-sdk-transport.js";
import { materializeProviderPreset } from "./provider-presets/index.js";
import { buildOpenResponsesFinalTextBody } from "./smoke/contract/open-responses-mock.js";
import { demoLookupToolDefinition } from "./smoke/shared/index.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type CapturedRequest = {
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
};

async function withImagePath(run: (imagePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "spirit-modal-transport-"));
  const imagePath = join(directory, "pixel.png");
  try {
    await writeFile(imagePath, PNG);
    await run(imagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withLoopback(
  expectedPath: string,
  responseBody: Record<string, unknown>,
  run: (input: { origin: string; captured: CapturedRequest[] }) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    if (request.method !== "POST" || request.url !== expectedPath) {
      response.writeHead(404).end("not found");
      return;
    }
    captured.push({
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      headers: request.headers,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responseBody));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run({ origin: `http://127.0.0.1:${address.port}`, captured });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function stateWithImage(imagePath: string, includeReasoningReplay = false) {
  const imageUrl = `data:image/png;base64,${readFileSync(imagePath).toString("base64")}`;
  return {
    messages: [
      ...(includeReasoningReplay
        ? [
            {
              role: "assistant",
              content: "Earlier answer",
              reasoning_content: "Earlier reasoning",
            },
          ]
        : []),
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    steps: 0,
  };
}

test("modal Chat Completions sends hostname ids, image input, tools, and exact reasoning", async () => {
  const model = "example--ep-deepseek-v4-1-flash-server.us-west.modal.direct";
  const preset = materializeProviderPreset({ presetId: "modal" });
  await withImagePath(async (imagePath) => {
    await withLoopback(
      "/v1/chat/completions",
      {
        id: "chatcmpl_modal",
        object: "chat.completion",
        created: 0,
        model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      async ({ origin, captured }) => {
        const result = await new AiSdkOpenAiCompatibleTransport().startToolAgentRound(
          {
            apiKey: "test-proxy-token",
            model,
            ...(preset.sdk !== undefined ? { sdk: preset.sdk } : {}),
            baseUrl: `${origin}/v1`,
            reasoningEffort: "xhigh",
            modelCapabilities: { languageModel: true, imageInput: true },
          },
          stateWithImage(imagePath, true),
          demoLookupToolDefinition(),
        );
        assert.equal(result.kind, "success");

        assert.equal(captured.length, 1);
        const request = captured[0]!;
        assert.equal(request.body.model, model);
        assert.equal(request.body.reasoning_effort, "xhigh");
        assert.equal(request.headers.authorization, "Bearer test-proxy-token");
        assert.ok(Array.isArray(request.body.tools));
        const messages = request.body.messages as Array<Record<string, unknown>>;
        const assistant = messages.find((message) => message.role === "assistant");
        assert.equal(assistant?.reasoning_content, "Earlier reasoning", JSON.stringify(messages));
        const user = messages.find((message) => message.role === "user");
        const content = user?.content as Array<Record<string, unknown>>;
        assert.equal(content[0]?.type, "text");
        assert.equal(content[1]?.type, "image_url");
        const imageUrl = content[1]?.image_url as Record<string, unknown> | undefined;
        assert.match(String(imageUrl?.url), /^data:image\/png;base64,/);
      },
    );
  });
});

test("modal Responses sends hostname ids, image input, tools, and exact reasoning", async () => {
  const model = "example--ep-glm-5-3-server.us-west.modal.direct";
  const preset = materializeProviderPreset({ presetId: "modal", transportKind: "open-responses" });
  await withImagePath(async (imagePath) => {
    await withLoopback(
      "/v1/responses",
      buildOpenResponsesFinalTextBody(model, "ok"),
      async ({ origin, captured }) => {
        const result = await new AiSdkOpenResponsesTransport().startToolAgentRound(
          {
            transportKind: "open-responses",
            apiKey: "test-proxy-token",
            model,
            ...(preset.sdk !== undefined ? { sdk: preset.sdk } : {}),
            baseUrl: `${origin}/v1`,
            reasoningEffort: "max",
            modelCapabilities: { languageModel: true, imageInput: true },
          },
          stateWithImage(imagePath),
          demoLookupToolDefinition(),
        );
        assert.equal(result.kind, "success");

        assert.equal(captured.length, 1);
        const request = captured[0]!;
        assert.equal(request.body.model, model);
        assert.deepEqual(request.body.reasoning, { effort: "max" });
        assert.equal(request.headers.authorization, "Bearer test-proxy-token");
        assert.ok(Array.isArray(request.body.tools));
        const input = request.body.input as Array<Record<string, unknown>>;
        const user = input.find((message) => message.role === "user");
        const content = user?.content as Array<Record<string, unknown>>;
        assert.equal(content[0]?.type, "input_text");
        assert.equal(content[1]?.type, "input_image", JSON.stringify(input));
        assert.match(String(content[1]?.image_url), /^data:image\/png;base64,/);
      },
    );
  });
});

test("modal Messages sends hostname ids, image input, tools, and declared effort", async () => {
  const model = "example--ep-kimi-k3-1-pro-server.us-west.modal.direct";
  const preset = materializeProviderPreset({ presetId: "modal", transportKind: "anthropic" });
  await withImagePath(async (imagePath) => {
    await withLoopback(
      "/v1/messages",
      {
        id: "msg_modal",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      async ({ origin, captured }) => {
        const result = await new AiSdkAnthropicTransport().startToolAgentRound(
          {
            transportKind: "anthropic",
            apiKey: "test-proxy-token",
            model,
            ...(preset.sdk !== undefined ? { sdk: preset.sdk } : {}),
            baseUrl: `${origin}/v1`,
            effort: "high",
            modelCapabilities: { languageModel: true, imageInput: true },
          },
          stateWithImage(imagePath),
          demoLookupToolDefinition(),
        );
        assert.equal(result.kind, "success", JSON.stringify(result));

        assert.equal(captured.length, 1);
        const request = captured[0]!;
        assert.equal(request.body.model, model);
        assert.deepEqual(request.body.output_config, { effort: "high" });
        assert.equal(request.headers["x-api-key"], "test-proxy-token");
        assert.ok(Array.isArray(request.body.tools));
        const messages = request.body.messages as Array<Record<string, unknown>>;
        const user = messages.find((message) => message.role === "user");
        const content = user?.content as Array<Record<string, unknown>>;
        assert.equal(content[0]?.type, "text");
        assert.equal(content[1]?.type, "image");
        const source = content[1]?.source as Record<string, unknown>;
        assert.equal(source.type, "base64");
        assert.equal(source.media_type, "image/png");
        assert.ok(typeof source.data === "string" && source.data.length > 0);
      },
    );
  });
});

test("modal Messages maps the API none effort onto the declared thinking-off state", async () => {
  const model = "example--ep-deepseek-v4-1-flash-server.us-west.modal.direct";
  const preset = materializeProviderPreset({ presetId: "modal", transportKind: "anthropic" });
  await withLoopback(
    "/v1/messages",
    {
      id: "msg_modal_none",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    async ({ origin, captured }) => {
      const result = await new AiSdkAnthropicTransport().startToolAgentRound(
        {
          transportKind: "anthropic",
          apiKey: "test-proxy-token",
          model,
          ...(preset.sdk !== undefined ? { sdk: preset.sdk } : {}),
          baseUrl: `${origin}/v1`,
          effortSemantics: "output",
          effort: "xhigh",
          supportsThinkingSwitch: true,
          vendorExtendedThinking: false,
          thinkingSwitch: {
            defaultState: "on",
            off: { body: { output_config: { effort: "none" } } },
          },
        },
        { messages: [{ role: "user", content: "Answer without reasoning" }], steps: 0 },
        demoLookupToolDefinition(),
      );
      assert.equal(result.kind, "success", JSON.stringify(result));
      assert.equal(captured[0]?.body.model, model);
      assert.deepEqual(captured[0]?.body.output_config, { effort: "none" });
      assert.equal("thinking" in captured[0]!.body, false);
    },
  );
});
