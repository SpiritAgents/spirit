import assert from "node:assert/strict";
import { test } from "vitest";

import { buildToolAgentHostPrompt, buildToolAgentMessages } from "./tool-agent.js";

test("buildToolAgentHostPrompt points product questions at the official site", () => {
  const prompt = buildToolAgentHostPrompt("test-model", "test-provider");
  assert.match(prompt, /official site is https:\/\/spirit\.dev/);
  assert.match(prompt, /https:\/\/spirit\.dev\/llms\.txt/);
  assert.match(prompt, /https:\/\/spirit\.dev\/docs/);
  assert.match(prompt, /combine official documentation with relevant local evidence/);
  assert.match(prompt, /configuration inspected with the user's permission/);
  assert.match(prompt, /multi-provider AI agent/);
  assert.ok(prompt.startsWith("You are Spirit."));
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
  assert.match(prompt, /installed package contents/);
});

test("buildToolAgentMessages appends host UI guidance without legacy transport sections", () => {
  const [system] = buildToolAgentMessages({
    historyMessages: [],
    model: "test-model",
    hostUiPromptSection: "Host UI guidance",
  });
  const content =
    typeof system === "object" && system !== null && !Array.isArray(system)
      ? system.content
      : undefined;
  assert.ok(typeof content === "string");
  assert.ok(content.endsWith("Host UI guidance"));
  assert.doesNotMatch(content, /File edits on this transport|Web search on this transport/);
});
