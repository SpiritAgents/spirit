import assert from "node:assert/strict";
import { test } from "vitest";

import { buildToolAgentHostPrompt } from "./tool-agent.js";

test("buildToolAgentHostPrompt points product questions at the official site", () => {
  const prompt = buildToolAgentHostPrompt("test-model", "test-provider");
  assert.match(prompt, /official site is https:\/\/spirit\.dev/);
  assert.match(prompt, /https:\/\/spirit\.dev\/llms\.txt/);
  assert.match(prompt, /https:\/\/spirit\.dev\/docs/);
  assert.match(prompt, /instead of answering from memory/);
});

test("buildToolAgentHostPrompt keeps the web_fetch line when explicitly enabled", () => {
  const prompt = buildToolAgentHostPrompt("test-model", "test-provider", {
    webFetchEnabled: true,
  });
  assert.match(prompt, /https:\/\/spirit\.dev\/llms\.txt/);
});

test("buildToolAgentHostPrompt drops the web_fetch line when web fetch is opted out", () => {
  const prompt = buildToolAgentHostPrompt("test-model", "test-provider", {
    webFetchEnabled: false,
  });
  assert.match(prompt, /official site is https:\/\/spirit\.dev/);
  assert.doesNotMatch(prompt, /llms\.txt/);
  assert.doesNotMatch(prompt, /web_fetch/);
});
