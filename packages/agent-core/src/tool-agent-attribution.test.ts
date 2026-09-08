import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildAttributionSystemMessage,
  buildToolAgentMessages,
  hasAttributionSystemMessage,
} from "./tool-agent.js";

test("buildAttributionSystemMessage returns undefined when both flags are off", () => {
  assert.equal(buildAttributionSystemMessage(undefined), undefined);
  assert.equal(buildAttributionSystemMessage({}), undefined);
  assert.equal(
    buildAttributionSystemMessage({ commitEnabled: false, prEnabled: false }),
    undefined,
  );
});

test("buildAttributionSystemMessage embeds commit trailer guidance when commit is on", () => {
  const message = buildAttributionSystemMessage({ commitEnabled: true });
  assert.ok(message?.includes("<attribution>"));
  assert.ok(message?.includes("Co-authored-by: Spirit Agent <agent@spirit.dev>"));
  assert.ok(message?.includes("Do not change the user's primary author"));
  assert.ok(!message?.includes("gh pr create"));
});

test("buildAttributionSystemMessage embeds PR credit guidance when pr is on", () => {
  const message = buildAttributionSystemMessage({ prEnabled: true });
  assert.ok(message?.includes("<attribution>"));
  assert.ok(message?.includes("gh pr create"));
  assert.ok(message?.includes("Made with [Spirit Agent](https://spirit.dev)"));
  assert.ok(!message?.includes("Co-authored-by"));
});

test("buildAttributionSystemMessage embeds both instructions when both are on", () => {
  const message = buildAttributionSystemMessage({
    commitEnabled: true,
    prEnabled: true,
  });
  assert.ok(message?.includes("Co-authored-by: Spirit Agent <agent@spirit.dev>"));
  assert.ok(message?.includes("Made with [Spirit Agent](https://spirit.dev)"));
});

test("buildToolAgentMessages omits attribution when flags are off", () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: "test-model",
    attribution: { commitEnabled: false, prEnabled: false },
  });
  const content = readSystemContent(messages[0]);
  assert.ok(!hasAttributionSystemMessage(content));
});

test("buildToolAgentMessages embeds attribution when commit is on", () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: "test-model",
    attribution: { commitEnabled: true },
  });
  const content = readSystemContent(messages[0]);
  assert.ok(hasAttributionSystemMessage(content));
  assert.ok(content.includes("Co-authored-by: Spirit Agent <agent@spirit.dev>"));
});

function readSystemContent(message: unknown): string {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}
