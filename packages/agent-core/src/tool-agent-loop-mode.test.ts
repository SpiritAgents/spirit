import assert from "node:assert/strict";
import { test } from "vitest";
import { formatLoopContinuationGuidance } from "./runtime/helpers.js";
import {
  buildLoopModeSystemMessage,
  buildToolAgentMessages,
  hasLoopModeSystemMessage,
} from "./tool-agent.js";

test("Loop continuation preserves the approved guidance and original user goal", () => {
  assert.equal(
    formatLoopContinuationGuidance(" Improve the requested work for 20 rounds. "),
    "Revisit the user's goal and the results so far. Continue with useful improvements or verification within the requested scope, respecting any explicit iteration requirement. Call finish_task when the requested work is complete; if blocked, explain what is needed.\n\nOriginal user request:\nImprove the requested work for 20 rounds.",
  );
});

test("buildLoopModeSystemMessage returns undefined when Loop is off", () => {
  assert.equal(buildLoopModeSystemMessage(false), undefined);
  assert.equal(buildLoopModeSystemMessage(undefined), undefined);
});

test("buildLoopModeSystemMessage embeds loop_mode guidance when Loop is on", () => {
  const message = buildLoopModeSystemMessage(true);
  assert.ok(message?.includes("<loop_mode>"));
  assert.ok(message?.includes("Loop mode is enabled."));
  assert.ok(message?.includes("Do not end the conversation until you are confident"));
  assert.ok(message?.includes("Ordinary assistant replies do not stop the loop"));
  assert.ok(message?.includes("Call `finish_task` only when no further work is needed."));
});

test("buildToolAgentMessages omits loop_mode when Loop is off", () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: "test-model",
    loopEnabled: false,
  });
  const content = readSystemContent(messages[0]);
  assert.ok(!hasLoopModeSystemMessage(content));
});

test("buildToolAgentMessages embeds loop_mode when Loop is on", () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: "test-model",
    loopEnabled: true,
  });
  const content = readSystemContent(messages[0]);
  assert.ok(hasLoopModeSystemMessage(content));
  assert.ok(content.includes("Call `finish_task` only when no further work is needed."));
});

function readSystemContent(message: unknown): string {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}
