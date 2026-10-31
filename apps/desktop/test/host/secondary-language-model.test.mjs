import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeSecondaryLanguageModel,
  resolveSecondaryLanguageModelName,
  resolveSecondaryLanguageModelProfile,
} from "../../dist-electron/src/host/secondary-language-model.js";

const openAiProviderId = "openai";
const exampleProviderId = "example";

const chatModel = {
  name: "gpt-4o-mini",
  capabilities: ["languageModel"],
};

const flashModel = {
  name: "deepseek/deepseek-v4-flash",
  capabilities: ["languageModel"],
};

const imageOnlyModel = {
  name: "dall-e-3",
  capabilities: ["imageGeneration"],
};

const config = {
  providers: [
    {
      id: openAiProviderId,
      apiBase: "https://api.openai.com/v1",
      models: [chatModel, imageOnlyModel],
    },
    {
      id: exampleProviderId,
      apiBase: "https://api.example.com/v1",
      models: [flashModel],
    },
  ],
  activeModel: { providerId: openAiProviderId, name: "gpt-4o-mini" },
};

test("resolveSecondaryLanguageModelName prefers explicit secondaryLanguageModel", () => {
  const name = resolveSecondaryLanguageModelName({
    ...config,
    secondaryLanguageModel: { providerId: exampleProviderId, name: "deepseek/deepseek-v4-flash" },
  });

  assert.deepEqual(name, { providerId: exampleProviderId, name: "deepseek/deepseek-v4-flash" });
});

test("resolveSecondaryLanguageModelName ignores invalid explicit config", () => {
  const name = resolveSecondaryLanguageModelName({
    ...config,
    secondaryLanguageModel: { providerId: openAiProviderId, name: "missing-model" },
  });

  assert.deepEqual(name, { providerId: exampleProviderId, name: "deepseek/deepseek-v4-flash" });
});

test("resolveSecondaryLanguageModelName ignores non-language-model explicit config", () => {
  const name = resolveSecondaryLanguageModelName({
    providers: [
      {
        id: openAiProviderId,
        apiBase: "https://api.openai.com/v1",
        models: [chatModel, imageOnlyModel],
      },
    ],
    activeModel: { providerId: openAiProviderId, name: "gpt-4o-mini" },
    secondaryLanguageModel: { providerId: openAiProviderId, name: "dall-e-3" },
  });

  assert.deepEqual(name, { providerId: openAiProviderId, name: "gpt-4o-mini" });
});

test("resolveSecondaryLanguageModelName falls back to pattern match before activeModel", () => {
  const name = resolveSecondaryLanguageModelName(config);

  assert.deepEqual(name, { providerId: exampleProviderId, name: "deepseek/deepseek-v4-flash" });
});

test("resolveSecondaryLanguageModelName falls back to activeModel when no pattern matches", () => {
  const name = resolveSecondaryLanguageModelName({
    providers: [config.providers[0]],
    activeModel: { providerId: openAiProviderId, name: "gpt-4o-mini" },
  });

  assert.deepEqual(name, { providerId: openAiProviderId, name: "gpt-4o-mini" });
});

test("normalizeSecondaryLanguageModel only keeps language-model-capable models", () => {
  assert.equal(
    normalizeSecondaryLanguageModel(
      { providerId: openAiProviderId, name: "dall-e-3" },
      { providers: [config.providers[0]] },
    ),
    undefined,
  );
  assert.deepEqual(
    normalizeSecondaryLanguageModel(
      { providerId: openAiProviderId, name: "gpt-4o-mini" },
      { providers: [config.providers[0]] },
    ),
    { providerId: openAiProviderId, name: "gpt-4o-mini" },
  );
});

test("resolveSecondaryLanguageModelProfile returns profile for resolved model", () => {
  const resolved = resolveSecondaryLanguageModelProfile({
    ...config,
    secondaryLanguageModel: { providerId: exampleProviderId, name: "deepseek/deepseek-v4-flash" },
  });

  assert.equal(resolved?.name, "deepseek/deepseek-v4-flash");
  assert.equal(resolved?.profile.providerId, exampleProviderId);
  assert.equal(resolved?.profile.name, "deepseek/deepseek-v4-flash");
});
