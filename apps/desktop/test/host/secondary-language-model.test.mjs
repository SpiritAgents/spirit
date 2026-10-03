import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeSecondaryLanguageModel,
  resolveSecondaryLanguageModelName,
  resolveSecondaryLanguageModelProfile,
} from "../../dist-electron/src/host/secondary-language-model.js";

const openAiGroupId = "openai";
const exampleGroupId = "example";

const chatModel = {
  name: "gpt-4o-mini",
  reasoningEffort: "medium",
  capabilities: ["languageModel"],
};

const flashModel = {
  name: "deepseek/deepseek-v4-flash",
  reasoningEffort: "medium",
  capabilities: ["languageModel"],
};

const imageOnlyModel = {
  name: "dall-e-3",
  reasoningEffort: "medium",
  capabilities: ["imageGeneration"],
};

const config = {
  providerGroups: [
    {
      id: openAiGroupId,
      provider: "openai",
      apiBase: "https://api.openai.com/v1",
      models: [chatModel, imageOnlyModel],
    },
    {
      id: exampleGroupId,
      provider: "custom",
      apiBase: "https://api.example.com/v1",
      models: [flashModel],
    },
  ],
  activeModel: { groupId: openAiGroupId, name: "gpt-4o-mini" },
};

test("resolveSecondaryLanguageModelName prefers explicit secondaryLanguageModel", () => {
  const name = resolveSecondaryLanguageModelName({
    ...config,
    secondaryLanguageModel: { groupId: exampleGroupId, name: "deepseek/deepseek-v4-flash" },
  });

  assert.deepEqual(name, { groupId: exampleGroupId, name: "deepseek/deepseek-v4-flash" });
});

test("resolveSecondaryLanguageModelName ignores invalid explicit config", () => {
  const name = resolveSecondaryLanguageModelName({
    ...config,
    secondaryLanguageModel: { groupId: openAiGroupId, name: "missing-model" },
  });

  assert.deepEqual(name, { groupId: exampleGroupId, name: "deepseek/deepseek-v4-flash" });
});

test("resolveSecondaryLanguageModelName ignores non-language-model explicit config", () => {
  const name = resolveSecondaryLanguageModelName({
    providerGroups: [
      {
        id: openAiGroupId,
        provider: "openai",
        apiBase: "https://api.openai.com/v1",
        models: [chatModel, imageOnlyModel],
      },
    ],
    activeModel: { groupId: openAiGroupId, name: "gpt-4o-mini" },
    secondaryLanguageModel: { groupId: openAiGroupId, name: "dall-e-3" },
  });

  assert.deepEqual(name, { groupId: openAiGroupId, name: "gpt-4o-mini" });
});

test("resolveSecondaryLanguageModelName falls back to pattern match before activeModel", () => {
  const name = resolveSecondaryLanguageModelName(config);

  assert.deepEqual(name, { groupId: exampleGroupId, name: "deepseek/deepseek-v4-flash" });
});

test("resolveSecondaryLanguageModelName falls back to activeModel when no pattern matches", () => {
  const name = resolveSecondaryLanguageModelName({
    providerGroups: [config.providerGroups[0]],
    activeModel: { groupId: openAiGroupId, name: "gpt-4o-mini" },
  });

  assert.deepEqual(name, { groupId: openAiGroupId, name: "gpt-4o-mini" });
});

test("normalizeSecondaryLanguageModel only keeps language-model-capable models", () => {
  assert.equal(
    normalizeSecondaryLanguageModel(
      { groupId: openAiGroupId, name: "dall-e-3" },
      { providerGroups: [config.providerGroups[0]] },
    ),
    undefined,
  );
  assert.deepEqual(
    normalizeSecondaryLanguageModel(
      { groupId: openAiGroupId, name: "gpt-4o-mini" },
      { providerGroups: [config.providerGroups[0]] },
    ),
    { groupId: openAiGroupId, name: "gpt-4o-mini" },
  );
});

test("resolveSecondaryLanguageModelProfile returns profile for resolved model", () => {
  const resolved = resolveSecondaryLanguageModelProfile({
    ...config,
    secondaryLanguageModel: { groupId: exampleGroupId, name: "deepseek/deepseek-v4-flash" },
  });

  assert.equal(resolved?.name, "deepseek/deepseek-v4-flash");
  assert.equal(resolved?.profile.groupId, exampleGroupId);
  assert.equal(resolved?.profile.name, "deepseek/deepseek-v4-flash");
});
