import assert from "node:assert/strict";

import { test } from "vitest";

import { createChatMediaValidationFetch } from "./chat-media-validation-fetch.js";

test("Meta Chat keeps image and MP4 video_url mappings intact", async () => {
  let captured: Record<string, unknown> | undefined;
  const wrapped = createChatMediaValidationFetch(
    { options: { chatMediaValidation: true } },
    async (_input, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    },
  );
  const videoUrl = `data:video/mp4;base64,${Buffer.from(new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112])).toString("base64")}`;
  await wrapped("https://meta.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://images.example/input.png" } },
            { type: "video_url", video_url: { url: videoUrl } },
          ],
        },
      ],
    }),
  });
  const messages = captured?.messages as Array<{ content: Array<Record<string, unknown>> }>;
  assert.equal(messages[0]?.content[0]?.type, "image_url");
  assert.equal(messages[0]?.content[1]?.type, "video_url");
  const videoPart = messages[0]?.content[1]?.video_url as { url: string };
  assert.equal(videoPart.url, videoUrl);
});

test("Meta Chat rejects non-MP4 video and audio or PDF parts instead of dropping them", async () => {
  const wrapped = createChatMediaValidationFetch(
    { options: { chatMediaValidation: true } },
    async () => new Response("{}", { status: 200 }),
  );
  await assert.rejects(
    () =>
      wrapped("https://meta.test/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "video_url", video_url: { url: "https://media.example/clip.webm" } },
              ],
            },
          ],
        }),
      }),
    /MP4 URL/,
  );
  await assert.rejects(
    () =>
      wrapped("https://meta.test/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "user", content: [{ type: "local_file", local_file: { assetKind: "audio" } }] },
          ],
        }),
      }),
    /require the Responses transport/,
  );
});
