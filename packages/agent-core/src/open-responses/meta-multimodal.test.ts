import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";
import { generateText, type TextStreamPart } from "ai";

import {
  buildResponsesLocalFileToken,
  createResponsesFileUploadFetch,
} from "./responses-file-upload.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";
import { clearDeclaredFileUploadCacheForTests } from "../file-upload/uploader.js";
import { openAiMessagesToResponsesAiSdkMessages } from "./ai-sdk-message-bridge.js";
import {
  attachReasoningReplayToAssistantMessage,
  extractResponsesReasoningReplayItems,
} from "./provider-state.js";
import { createDeferred, responsesEventStreamToRuntimeEvents } from "./streaming.js";
import {
  buildResponsesProviderOptionsWithServiceTier,
  createResponsesLanguageModel,
} from "./model-factory.js";
import { llmMessageToOpenAiMessage } from "../openai/openai-multimodal-messages.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import type { ToolAgentRoundCompletion } from "../ports.js";
import { isJsonObject, type ToolAgentState } from "../tool-agent.js";

function metaConfig(): OpenResponsesTransportConfig {
  return {
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "muse-spark-1.3",
    baseUrl: "https://meta.test/v1",
    sdk: "@ai-sdk/openai",
    store: false,
    options: { responsesFileUpload: true, reasoningSummary: true },
    fileUpload: {
      path: "/files",
      purpose: "user_data",
      refTemplate: "{id}",
      maxBytes: 1_073_741_824,
    },
  };
}

function fileData(token: string, mediaType: string): string {
  return `data:${mediaType};base64,${token}`;
}

test("Meta Responses uploads audio, PDF, and MP4 with user_data and preserves the media budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "spirit-meta-media-"));
  clearDeclaredFileUploadCacheForTests();
  const uploads: Array<{ filename: string; purpose: string }> = [];
  let responseBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://meta.test/v1/files") {
      const form = init?.body as { get(name: string): unknown };
      const file = form.get("file") as { name?: string };
      uploads.push({ filename: file.name ?? "", purpose: String(form.get("purpose")) });
      return new Response(JSON.stringify({ id: `file_${uploads.length}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://meta.test/v1/responses") {
      responseBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const audioPath = join(root, "voice.mp3");
    const pdfPath = join(root, "paper.pdf");
    const videoPath = join(root, "clip.mp4");
    await writeFile(audioPath, "ID3\u0004");
    await writeFile(
      pdfPath,
      "%PDF-1.7\n<</Type /Page>>\n<</Type /Page>>\n<</Type /Pages /Count 2>>",
    );
    await writeFile(videoPath, new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 0, 0, 0, 0]));
    const tokens = [
      {
        path: audioPath,
        filename: "voice.mp3",
        mediaType: "audio/mpeg",
        assetKind: "audio" as const,
      },
      {
        path: pdfPath,
        filename: "paper.pdf",
        mediaType: "application/pdf",
        assetKind: "document" as const,
      },
      {
        path: videoPath,
        filename: "clip.mp4",
        mediaType: "video/mp4",
        assetKind: "video" as const,
      },
    ];
    const body = {
      model: "muse-spark-1.3",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Review everything" },
            {
              type: "input_image",
              image_url:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zp1cAAAAASUVORK5CYII=",
            },
            ...tokens.map((token) => ({
              type: "input_file",
              file_data: fileData(buildResponsesLocalFileToken(token), token.mediaType),
            })),
          ],
        },
      ],
    };
    const wrapped = createResponsesFileUploadFetch(metaConfig(), baseFetch);
    await wrapped("https://meta.test/v1/responses", {
      method: "POST",
      body: JSON.stringify(body),
    });

    assert.deepEqual(uploads, [
      { filename: "voice.mp3", purpose: "user_data" },
      { filename: "paper.pdf", purpose: "user_data" },
      { filename: "clip.mp4", purpose: "user_data" },
    ]);
    const input = responseBody?.input as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    assert.deepEqual(input[0]?.content.slice(2), [
      { type: "input_file", file_id: "file_1" },
      { type: "input_file", file_id: "file_2" },
      { type: "input_file", file_id: "file_3" },
    ]);
  } finally {
    clearDeclaredFileUploadCacheForTests();
    await rm(root, { recursive: true, force: true });
  }
});

test("Meta Responses rejects invalid media and counts retained PDF pages against the image budget", async () => {
  const baseFetch: typeof fetch = async () => new Response("{}", { status: 200 });
  const wrapped = createResponsesFileUploadFetch(metaConfig(), baseFetch);
  const invalidVideo = {
    path: "data:video/mp4;base64,AAAA",
    filename: "clip.mp4",
    mediaType: "video/mp4",
    assetKind: "video" as const,
  };
  await assert.rejects(
    () =>
      wrapped("https://meta.test/v1/responses", {
        method: "POST",
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_file",
                  file_data: fileData(buildResponsesLocalFileToken(invalidVideo), "video/mp4"),
                },
              ],
            },
          ],
        }),
      }),
    /valid MP4/,
  );

  const pdf = `%PDF-1.7\n${"<</Type /Page>>\n".repeat(51)}<</Type /Pages /Count 51>>`;
  const documentToken = {
    path: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
    filename: "paper.pdf",
    mediaType: "application/pdf",
    assetKind: "document" as const,
  };
  await assert.rejects(
    () =>
      wrapped("https://meta.test/v1/responses", {
        method: "POST",
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: [
                { type: "input_image", image_url: "https://images.example/one.png" },
                {
                  type: "input_file",
                  file_data: fileData(
                    buildResponsesLocalFileToken(documentToken),
                    "application/pdf",
                  ),
                },
              ],
            },
          ],
        }),
      }),
    /50-item request budget/,
  );
});

test("Meta official OpenAI SDK serializes audio as a Files reference and requests ZDR reasoning", async () => {
  const root = await mkdtemp(join(tmpdir(), "spirit-meta-sdk-"));
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url = String(input);
    if (url === "https://meta.test/v1/files") {
      requests.push({ url });
      return new Response(JSON.stringify({ id: "file_sdk_audio" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://meta.test/v1/responses") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      return new Response(
        JSON.stringify({
          id: "resp_sdk",
          object: "response",
          created_at: 1,
          status: "completed",
          model: "muse-spark-1.3",
          output: [
            {
              type: "message",
              id: "msg_sdk",
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: "ok", annotations: [] }],
            },
          ],
          parallel_tool_calls: true,
          tool_choice: "auto",
          tools: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`Unexpected request ${url}`);
  });

  try {
    await writeFile(join(root, "voice.mp3"), "ID3\u0004");
    const config = metaConfig();
    const apiMessage = llmMessageToOpenAiMessage(
      { role: "user", content: [{ type: "audio", path: "voice.mp3" }] },
      root,
    );
    const result = await generateText({
      model: createResponsesLanguageModel(config) as any,
      messages: openAiMessagesToResponsesAiSdkMessages([apiMessage], config) as any,
      providerOptions: buildResponsesProviderOptionsWithServiceTier(config),
      maxRetries: 0,
    });
    assert.equal(result.text, "ok");
    const response = requests.find((request) => request.url.endsWith("/responses"))?.body;
    assert.equal(response?.store, false);
    assert.deepEqual(response?.include, ["reasoning.encrypted_content"]);
    const input = response?.input as Array<{ content: Array<Record<string, unknown>> }>;
    assert.deepEqual(input[0]?.content, [{ type: "input_file", file_id: "file_sdk_audio" }]);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearDeclaredFileUploadCacheForTests();
    await rm(root, { recursive: true, force: true });
  }
});

test("Meta reasoning replay restores item ids and encrypted content into SDK prompt parts", () => {
  const config = metaConfig();
  const replayItems = extractResponsesReasoningReplayItems({
    id: "resp_1",
    output: [
      {
        type: "reasoning",
        id: "rs_1",
        encrypted_content: "encrypted-test-value",
        summary: [{ type: "summary_text", text: "Consider the attachments." }],
      },
    ],
  });
  const message = attachReasoningReplayToAssistantMessage(
    config,
    { role: "assistant", content: "Done", reasoning_content: "Consider the attachments." },
    replayItems,
  );
  const sdkMessages = openAiMessagesToResponsesAiSdkMessages([message], config);
  const content = sdkMessages[0]?.content as Array<Record<string, unknown>>;
  assert.deepEqual(content[0], {
    type: "reasoning",
    text: "Consider the attachments.",
    providerOptions: {
      openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-test-value" },
    },
  });
});

test("Meta search stream fixtures retain native search previews and reasoning replay state", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield {
      type: "raw",
      rawValue: {
        type: "response.output_item.done",
        item: {
          type: "web_search_call",
          id: "ws_meta",
          status: "completed",
          action: { type: "search", query: "Muse multimodal" },
        },
      },
    };
    yield { type: "reasoning-delta", id: "rs_meta", text: "Use the sources." };
    yield { type: "text-delta", id: "msg_meta", text: "Search complete." };
    yield {
      type: "raw",
      rawValue: {
        type: "response.completed",
        response: {
          id: "resp_meta",
          output: [
            {
              type: "reasoning",
              id: "rs_meta",
              encrypted_content: "encrypted-meta",
              summary: [{ type: "summary_text", text: "Use the sources." }],
            },
          ],
        },
      },
    };
  }

  const config = metaConfig();
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const previews: string[] = [];
  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    stream(),
    {},
    state,
    [],
    completion,
  )) {
    if (event.kind === "streaming-tool-preview") {
      previews.push(event.toolName);
    }
  }
  await completion.promise;
  assert.deepEqual(previews, ["web_search"]);
  const assistant = state.messages.find(
    (message) =>
      isJsonObject(message) && message.role === "assistant" && "providerState" in message,
  ) as { providerState?: Record<string, unknown> } | undefined;
  assert.ok(assistant);
  assert.match(JSON.stringify(assistant.providerState), /encrypted-meta/);
  assert.match(JSON.stringify(assistant.providerState), /rs_meta/);
});
