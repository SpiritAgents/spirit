import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildSessionTitlePrompt,
  deriveSessionTitleFallbackSeed,
  normalizeGeneratedSessionTitle,
  resolveSecondaryLanguageModelRef,
  resolveSessionTitleModelRef,
  SESSION_TITLE_FALLBACK_SEED,
  SESSION_TITLE_MAX_LENGTH,
  type SessionTitleModelConfig,
} from "./session-title.js";

const openAiGroupId = "openai";
const exampleGroupId = "example";

const config: SessionTitleModelConfig = {
  providerGroups: [
    {
      id: openAiGroupId,
      provider: "openai",
      apiBase: "https://api.openai.com/v1",
      models: [
        {
          name: "gpt-4o-mini",
          reasoningEffort: "medium",
          capabilities: ["languageModel", "image"],
        },
        { name: "dall-e-3", reasoningEffort: "medium", capabilities: ["imageGeneration"] },
      ],
    },
    {
      id: exampleGroupId,
      provider: "custom",
      apiBase: "https://api.example.com/v1",
      models: [
        {
          name: "deepseek/deepseek-v4-flash",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
        },
      ],
    },
  ],
  activeModel: { groupId: openAiGroupId, name: "gpt-4o-mini" },
};

test("buildSessionTitlePrompt includes user message and language rule", () => {
  const prompt = buildSessionTitlePrompt("Help me build a Desktop session title feature");
  assert.match(prompt, /same language as the user message/i);
  assert.match(prompt, /Help me build a Desktop session title feature/);
  assert.match(prompt, /"title"/);
});

test("buildSessionTitlePrompt describes attached media when the user text is empty", () => {
  const prompt = buildSessionTitlePrompt("", { hasMedia: true });
  assert.match(prompt, /media attachments/i);
  assert.match(prompt, /images or videos/i);
  assert.doesNotMatch(prompt, /\(empty\)/);
});

test("normalizeGeneratedSessionTitle trims, strips quotes, and caps length", () => {
  const fallback = "seed title";
  assert.equal(normalizeGeneratedSessionTitle("  hello world  ", fallback), "hello world");
  assert.equal(normalizeGeneratedSessionTitle('"quoted title"', fallback), "quoted title");
  assert.equal(normalizeGeneratedSessionTitle("", fallback), fallback);
  assert.equal(
    normalizeGeneratedSessionTitle("x".repeat(SESSION_TITLE_MAX_LENGTH + 10), fallback).length,
    SESSION_TITLE_MAX_LENGTH + 1,
  );
});

test("deriveSessionTitleFallbackSeed truncates empty and long text", () => {
  assert.equal(deriveSessionTitleFallbackSeed("  "), SESSION_TITLE_FALLBACK_SEED);
  assert.equal(deriveSessionTitleFallbackSeed("short"), "short");
  assert.equal(deriveSessionTitleFallbackSeed("x".repeat(40)).endsWith("…"), true);
});

test("resolveSessionTitleModelRef prefers vision-capable active model when secondary lacks image", () => {
  const ref = resolveSessionTitleModelRef(config, { needsImage: true });
  assert.deepEqual(ref, { groupId: openAiGroupId, name: "gpt-4o-mini" });
});

test("resolveSessionTitleModelRef keeps secondary when no media is required", () => {
  const ref = resolveSecondaryLanguageModelRef(config);
  assert.deepEqual(ref, { groupId: exampleGroupId, name: "deepseek/deepseek-v4-flash" });
  assert.deepEqual(resolveSessionTitleModelRef(config), ref);
});
