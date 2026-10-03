import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveComposerDirectMediaTool } from "../../dist-electron/src/host/model-config.js";

const openAiGroupId = "openai";
const volcengineGroupId = "volcengine";
const exampleGroupId = "example";

const chatRef = { groupId: openAiGroupId, name: "gpt-4o-mini" };
const imageRef = { groupId: openAiGroupId, name: "dall-e-3" };
const videoRef = { groupId: volcengineGroupId, name: "doubao-seedance" };
const dualMediaRef = { groupId: exampleGroupId, name: "dual-media" };

const chatModel = {
  name: "gpt-4o-mini",
  apiBase: "https://api.openai.com/v1",
  capabilities: ["languageModel"],
};

const imageModel = {
  name: "dall-e-3",
  apiBase: "https://api.openai.com/v1",
  capabilities: ["imageGeneration"],
};

const videoModel = {
  name: "doubao-seedance",
  apiBase: "https://ark.cn-beijing.volces.com/api/v3",
  provider: "volcengine",
  capabilities: ["videoGeneration"],
};

const dualMediaModel = {
  name: "dual-media",
  apiBase: "https://example.invalid/v1",
  capabilities: ["imageGeneration", "videoGeneration"],
};

test("resolveComposerDirectMediaTool returns generate_video when active matches video slot", () => {
  assert.equal(
    resolveComposerDirectMediaTool(videoRef, {
      models: [chatModel, videoModel],
      imageGenerationModel: imageRef,
      videoGenerationModel: videoRef,
    }),
    "generate_video",
  );
});

test("resolveComposerDirectMediaTool returns generate_image when active matches image slot", () => {
  assert.equal(
    resolveComposerDirectMediaTool(imageRef, {
      models: [chatModel, imageModel, videoModel],
      imageGenerationModel: imageRef,
      videoGenerationModel: videoRef,
    }),
    "generate_image",
  );
});

test("resolveComposerDirectMediaTool returns null when active is chat model", () => {
  assert.equal(
    resolveComposerDirectMediaTool(chatRef, {
      models: [chatModel, imageModel, videoModel],
      imageGenerationModel: imageRef,
      videoGenerationModel: videoRef,
    }),
    null,
  );
});

test("resolveComposerDirectMediaTool returns null when slot matches but capability missing", () => {
  assert.equal(
    resolveComposerDirectMediaTool(chatRef, {
      models: [chatModel],
      imageGenerationModel: chatRef,
      videoGenerationModel: chatRef,
    }),
    null,
  );
});

test("resolveComposerDirectMediaTool routes image-only active model without slot match", () => {
  assert.equal(
    resolveComposerDirectMediaTool(
      { groupId: openAiGroupId, name: "openai/gpt-image-2" },
      {
        models: [
          {
            name: "openai/gpt-image-2",
            capabilities: ["imageGeneration"],
          },
        ],
        imageGenerationModel: { groupId: openAiGroupId, name: "openai/gpt-image-1" },
      },
    ),
    "generate_image",
  );
});

test("resolveComposerDirectMediaTool prefers video when same model fills both slots", () => {
  assert.equal(
    resolveComposerDirectMediaTool(dualMediaRef, {
      models: [dualMediaModel],
      imageGenerationModel: dualMediaRef,
      videoGenerationModel: dualMediaRef,
    }),
    "generate_video",
  );
});
