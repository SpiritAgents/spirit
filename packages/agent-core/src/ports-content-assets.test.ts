import assert from "node:assert/strict";

import { test } from "vitest";

import {
  cloneLlmMessageContent,
  createLlmMessageContentFromTextAndImages,
  llmMessageAudioPaths,
  llmMessageDocumentPaths,
  llmMessageHasMedia,
  normalizeStoredLlmMessage,
} from "./ports.js";

test("audio and document assets survive content creation, cloning, and archive normalization", () => {
  const content = createLlmMessageContentFromTextAndImages(
    "Review all attachments",
    ["image.png"],
    ["clip.mp4"],
    ["voice.mp3"],
    ["paper.pdf"],
  );
  assert.deepEqual(content, [
    { type: "text", text: "Review all attachments" },
    { type: "image", path: "image.png" },
    { type: "video", path: "clip.mp4" },
    { type: "audio", path: "voice.mp3" },
    { type: "document", path: "paper.pdf" },
  ]);
  assert.deepEqual(cloneLlmMessageContent(content), content);
  assert.notEqual(cloneLlmMessageContent(content), content);
  assert.deepEqual(llmMessageAudioPaths(content), ["voice.mp3"]);
  assert.deepEqual(llmMessageDocumentPaths(content), ["paper.pdf"]);
  assert.equal(llmMessageHasMedia(content), true);
  assert.deepEqual(normalizeStoredLlmMessage({ role: "user", content }), {
    role: "user",
    content,
  });
});
