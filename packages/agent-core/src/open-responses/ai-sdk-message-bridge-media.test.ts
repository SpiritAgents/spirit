import assert from "node:assert/strict";

import { test } from "vitest";

import { openAiMessagesToResponsesAiSdkMessages } from "./ai-sdk-message-bridge.js";

test("Responses keeps confirmed image input as an AI SDK file part", () => {
  const messages = openAiMessagesToResponsesAiSdkMessages(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
        ],
      },
    ],
    {
      transportKind: "open-responses",
      model: "example/vision-chat",
      modelCapabilities: { imageInput: true },
    },
  );
  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "Inspect this image." },
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: "AAEC" },
        },
      ],
    },
  ]);
});

test("Responses rejects unsupported video input explicitly instead of dropping it", () => {
  assert.throws(
    () =>
      openAiMessagesToResponsesAiSdkMessages(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "Keep this attachment visible." },
              { type: "video_url", video_url: { url: "data:video/mp4;base64,AAEC" } },
            ],
          },
        ],
        {
          transportKind: "open-responses",
          model: "example/video-chat",
          modelCapabilities: { imageInput: true },
        },
      ),
    /does not support video input on the Responses transport.*Remove the video attachment/u,
  );
});
