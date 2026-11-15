import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CREATE_AUTOMATION_CONTRIBUTED_TOOL,
  CREATE_AUTOMATION_TOOL_NAME,
  buildAutomationHostToolDefinitions,
  createAutomationContributedTool,
  deriveAutomationTitle,
  parseCreateAutomationApprovalLevel,
  parseCreateAutomationTrigger,
  parseCreateAutomationTriggerInput,
  previewCreateAutomationFromArguments,
  toBuiltInLazyToolIndexEntry,
} from "./automation-host-tool.js";

test("CREATE_AUTOMATION_CONTRIBUTED_TOOL exposes required overview", () => {
  assert.equal(CREATE_AUTOMATION_CONTRIBUTED_TOOL.name, CREATE_AUTOMATION_TOOL_NAME);
  const schema = CREATE_AUTOMATION_CONTRIBUTED_TOOL.inputSchema;
  assert.deepEqual(schema.required, ["overview", "trigger"]);
  const properties = schema.properties;
  assert.ok(properties && typeof properties === "object" && !Array.isArray(properties));
  const trigger = properties.trigger;
  assert.equal(
    trigger && typeof trigger === "object" && !Array.isArray(trigger) ? trigger.type : undefined,
    "object",
  );
});

test("buildAutomationHostToolDefinitions returns one function tool", () => {
  const definitions = buildAutomationHostToolDefinitions();
  assert.equal(definitions.length, 1);
  const fn = definitions[0] as { function?: { name?: string } };
  assert.equal(fn.function?.name, CREATE_AUTOMATION_TOOL_NAME);
});

test("deriveAutomationTitle uses explicit title or first overview line", () => {
  assert.equal(deriveAutomationTitle("line one\nline two", "Custom"), "Custom");
  assert.equal(deriveAutomationTitle("Check CI every morning"), "Check CI every morning");
});

test("deriveAutomationTitle truncates long first lines", () => {
  const longLine = "a".repeat(100);
  assert.equal(deriveAutomationTitle(longLine).length, 80);
});

test("parseCreateAutomationTrigger accepts time schedule", () => {
  assert.deepEqual(parseCreateAutomationTrigger({ kind: "time", schedule: { kind: "hourly" } }), {
    kind: "time",
    schedule: { kind: "hourly" },
  });
  assert.deepEqual(
    parseCreateAutomationTrigger({
      kind: "time",
      schedule: { kind: "daily", hour: 9, minute: 30 },
    }),
    { kind: "time", schedule: { kind: "daily", hour: 9, minute: 30 } },
  );
});

test("parseCreateAutomationTrigger rejects invalid time schedule", () => {
  assert.throws(
    () => parseCreateAutomationTrigger({ kind: "time", schedule: { kind: "monthly" } }),
    /Invalid automation trigger/,
  );
});

test("parseCreateAutomationTrigger accepts github trigger", () => {
  assert.deepEqual(
    parseCreateAutomationTrigger({
      kind: "github",
      owner: "acme",
      repo: "app",
      event: "issue_created",
    }),
    {
      kind: "github",
      owner: "acme",
      repo: "app",
      event: "issue_created",
    },
  );
});

test("parseCreateAutomationTriggerInput requires trigger", () => {
  assert.deepEqual(
    parseCreateAutomationTriggerInput({
      trigger: {
        kind: "github",
        owner: "acme",
        repo: "app",
        event: "pull_request_created",
      },
    }),
    {
      kind: "github",
      owner: "acme",
      repo: "app",
      event: "pull_request_created",
    },
  );
  assert.throws(
    () => parseCreateAutomationTriggerInput({ schedule: { kind: "daily", hour: 8, minute: 15 } }),
    /missing trigger/,
  );
});

test("parseCreateAutomationApprovalLevel defaults to default and accepts auto-approval and bypass-approval", () => {
  assert.equal(parseCreateAutomationApprovalLevel(undefined), "default");
  assert.equal(parseCreateAutomationApprovalLevel("auto-approval"), "auto-approval");
  assert.equal(parseCreateAutomationApprovalLevel("bypass-approval"), "bypass-approval");
  assert.equal(parseCreateAutomationApprovalLevel("full-approval"), "default");
});

test("CREATE_AUTOMATION_CONTRIBUTED_TOOL approval_level enum includes auto-approval", () => {
  const schema = CREATE_AUTOMATION_CONTRIBUTED_TOOL.inputSchema;
  const properties = schema.properties;
  assert.ok(properties && typeof properties === "object" && !Array.isArray(properties));
  const approvalLevel = properties.approval_level;
  assert.ok(approvalLevel && typeof approvalLevel === "object" && !Array.isArray(approvalLevel));
  assert.deepEqual(approvalLevel.enum, ["default", "auto-approval", "bypass-approval"]);
});

test("previewCreateAutomationFromArguments derives title and trigger", async () => {
  const preview = await previewCreateAutomationFromArguments({
    overview: "Summarize CI failures.",
    title: "CI check",
    trigger: { kind: "time", schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 } },
  });
  assert.equal(preview.title, "CI check");
  assert.deepEqual(preview.trigger, {
    kind: "time",
    schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 },
  });
});

test("toBuiltInLazyToolIndexEntry maps contributed metadata to lazy index entry", () => {
  const entry = toBuiltInLazyToolIndexEntry(CREATE_AUTOMATION_CONTRIBUTED_TOOL);
  assert.equal(entry.server, "desktop");
  assert.equal(entry.toolName, CREATE_AUTOMATION_TOOL_NAME);
  assert.equal(entry.agentModeExposure, "agent");
  assert.equal(entry.excludeFromAskMode, true);
});

test("contributed trigger schemas are exposed as closed oneOf branches", () => {
  const definition = createAutomationContributedTool([
    {
      kind: "extension:personal/demo/activity",
      inputSchema: {
        type: "object",
        properties: { repository: { type: "string" } },
        required: ["repository"],
        additionalProperties: false,
      },
    },
  ]);
  const properties = definition.inputSchema.properties as Record<string, unknown>;
  const trigger = properties.trigger as { oneOf: Array<Record<string, unknown>> };
  assert.equal(trigger.oneOf.length, 3);
  assert.deepEqual(trigger.oneOf[2], {
    type: "object",
    properties: {
      kind: { type: "string", const: "extension:personal/demo/activity" },
      config: {
        type: "object",
        properties: { repository: { type: "string" } },
        required: ["repository"],
        additionalProperties: false,
      },
    },
    required: ["kind", "config"],
    additionalProperties: false,
  });
});

test("extension tool inputs reject injected labels and use provider validation for previews", async () => {
  assert.throws(
    () =>
      parseCreateAutomationTrigger({
        kind: "extension:personal/demo/activity",
        config: {},
        label: "forged",
      }),
    /cannot include label or state/,
  );

  const preview = await previewCreateAutomationFromArguments(
    {
      overview: "Track activity",
      trigger: { kind: "extension:personal/demo/activity", config: { repository: "spirit" } },
    },
    async (input) => ({
      kind: input.kind as `extension:${string}`,
      config: "config" in input ? input.config : {},
      label: "Spirit activity",
    }),
  );
  assert.equal(preview.trigger.kind, "extension:personal/demo/activity");
  assert.equal("label" in preview.trigger ? preview.trigger.label : undefined, "Spirit activity");
});
