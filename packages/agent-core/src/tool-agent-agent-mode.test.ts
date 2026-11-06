import assert from "node:assert/strict";
import { product } from "@spiritagent/product";
import { test } from "vitest";
import { buildStartImplementingPrompt } from "./plan-user-turn.js";

import {
  buildAgentModeSystemMessage,
  buildToolAgentMessages,
  hasAgentModeSystemMessage,
} from "./tool-agent.js";

test("implementation approval uses the product identity and the explicitly recorded plan", () => {
  const message = buildStartImplementingPrompt(" /plans/implementation.md ");
  assert.ok(message.includes(`${product.name}-managed plan file /plans/implementation.md`));
  assert.equal(
    message,
    `The user has approved the plan and asked to start implementing. Before implementing, read the ${product.name}-managed plan file /plans/implementation.md and follow its execution plan for coding and verification.`,
  );
  assert.ok(!message.includes("file  /plans"));
});

test("implementation approval without a recorded path guides diagnosis and user recovery", () => {
  for (const activePlanPath of [undefined, "", "   "]) {
    const message = buildStartImplementingPrompt(activePlanPath);
    assert.ok(message.includes("Investigate the cause."));
    assert.ok(message.includes("switch to Plan mode"));
    assert.ok(message.includes("use ask_questions"));
    assert.ok(!message.includes("create_plan"));
  }
});

test("buildAgentModeSystemMessage: Agent mode guidance", () => {
  const message = buildAgentModeSystemMessage({ path: "", exists: false, agentMode: "agent" });
  assert.ok(message.includes("<agent_mode>"));
  assert.ok(message.includes("You are in Agent mode."));
  assert.ok(message.includes("efficiently, professionally, and carefully"));
  assert.ok(!message.includes("Start implementing"));
});

test("buildAgentModeSystemMessage: Plan mode guidance", () => {
  const message = buildAgentModeSystemMessage({
    path: "/plans/foo.md",
    exists: true,
    agentMode: "plan",
  });
  assert.ok(message.includes("You are in Plan mode."));
  assert.ok(
    message.includes(
      "Clarify the user's goal and scope as needed, then investigate the workspace and prepare an actionable implementation plan. Explain the key decisions and trade-offs for the user to review. Implementation begins after the user approves the plan.",
    ),
  );
  assert.doesNotMatch(message, /subagent|create_plan|Start implementing/);
});

test("buildAgentModeSystemMessage: Ask mode guidance", () => {
  const message = buildAgentModeSystemMessage({ path: "", exists: false, agentMode: "ask" });
  assert.ok(message.includes("You are in Ask mode."));
  assert.ok(message.includes("Help read-only"));
  assert.ok(message.includes("Only call tools that are available"));
  assert.ok(message.includes("switch to Agent mode"));
  assert.ok(!message.includes("Plan mode"));
});

test("buildAgentModeSystemMessage: defaults to Agent when planMetadata omitted", () => {
  const message = buildAgentModeSystemMessage();
  assert.ok(message.includes("You are in Agent mode."));
});

test("buildAgentModeSystemMessage: legacy planMode true maps to Plan", () => {
  const message = buildAgentModeSystemMessage({ path: "", exists: false, planMode: true });
  assert.ok(message.includes("You are in Plan mode."));
});

test("buildAgentModeSystemMessage: Debug mode guidance", () => {
  const message = buildAgentModeSystemMessage({ path: "", exists: false, agentMode: "debug" });
  assert.ok(message.includes("You are in Debug mode."));
  assert.ok(message.includes("do not attempt a fix immediately"));
  assert.ok(message.includes("Propose hypotheses about the root cause"));
  assert.ok(message.includes("ranked by likelihood"));
  assert.ok(message.includes("Insert structured log points in the relevant source code"));
  assert.ok(message.includes("#region agent log"));
  assert.ok(message.includes("Remove entire regions after the bug is verified fixed"));
  assert.ok(message.includes(`${product.workspaceDataFolderName}/logs/`));
  assert.ok(message.includes("kebab-case"));
  assert.ok(message.includes('"hypotheses"'));
  assert.ok(message.includes('"message"'));
  assert.ok(message.includes('"data"'));
  assert.ok(message.includes("resolved"));
  assert.ok(message.includes("still reproducing"));
});

test("buildToolAgentMessages embeds agent_mode block in system message", () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: "test-model",
    planMetadata: { path: "", exists: false, agentMode: "ask" },
  });
  const system = messages[0];
  assert.equal(
    typeof system === "object" && system !== null && !Array.isArray(system) ? system.role : "",
    "system",
  );
  const content =
    typeof system === "object" &&
    system !== null &&
    !Array.isArray(system) &&
    typeof system.content === "string"
      ? system.content
      : "";
  assert.ok(hasAgentModeSystemMessage(content));
  assert.ok(content.includes("You are in Ask mode."));
});
