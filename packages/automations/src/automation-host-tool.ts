import {
  buildContributedHostToolDefinitions,
  LAZY_BUILT_IN_SERVER_DESKTOP,
  type BuiltInLazyToolIndexEntry,
  type ContributedHostToolDefinition,
  type JsonObject,
  type JsonValue,
} from "@spiritagent/agent-core";

import type { HostAutomationTrigger } from "./automations.js";
import { normalizeAutomationTrigger } from "./automations.js";

export type CreateAutomationApprovalLevel = "default" | "auto-approval" | "bypass-approval";
export type AutomationTriggerToolInput =
  | HostAutomationTrigger
  | { kind: `extension:${string}`; config: JsonObject };
export type AutomationTriggerValidator = (
  input: AutomationTriggerToolInput,
) => Promise<HostAutomationTrigger>;
export type AutomationTriggerToolContribution = {
  kind: string;
  inputSchema: JsonObject;
};

export const CREATE_AUTOMATION_TOOL_NAME = "create_automation";

const AUTOMATION_TITLE_MAX_CHARS = 80;

export function deriveAutomationTitle(overview: string, explicitTitle?: string): string {
  const trimmedExplicit = explicitTitle?.trim();
  if (trimmedExplicit) {
    return trimmedExplicit;
  }
  const firstLine = overview.trim().split(/\r?\n/u)[0]?.trim() ?? "";
  if (!firstLine) {
    throw new Error("create_automation requires a non-empty overview or title.");
  }
  return [...firstLine].length > AUTOMATION_TITLE_MAX_CHARS
    ? [...firstLine].slice(0, AUTOMATION_TITLE_MAX_CHARS).join("")
    : firstLine;
}

export function parseCreateAutomationApprovalLevel(value: unknown): CreateAutomationApprovalLevel {
  if (value === undefined) {
    return "default";
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid approval_level for create_automation.");
  }
  const trimmed = value.trim();
  if (trimmed === "auto-approval") {
    return "auto-approval";
  }
  if (trimmed === "bypass-approval") {
    return "bypass-approval";
  }
  return "default";
}

export function parseCreateAutomationTrigger(value: unknown): AutomationTriggerToolInput {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.kind === "string" &&
      candidate.kind.startsWith("extension:") &&
      ("label" in candidate || "state" in candidate)
    ) {
      throw new Error("Extension trigger inputs cannot include label or state.");
    }
  }
  const normalized = normalizeAutomationTrigger(value);
  if (normalized) {
    return normalized;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.kind === "string" &&
      record.kind.startsWith("extension:") &&
      record.config !== null &&
      typeof record.config === "object" &&
      !Array.isArray(record.config) &&
      Object.keys(record).every((key) => key === "kind" || key === "config")
    ) {
      return {
        kind: record.kind as `extension:${string}`,
        config: record.config as JsonObject,
      };
    }
  }
  throw new Error("Invalid automation trigger.");
}

export function parseCreateAutomationTriggerInput(
  parsed: Record<string, unknown>,
): AutomationTriggerToolInput {
  if (parsed.trigger === undefined) {
    throw new Error("create_automation is missing trigger.");
  }
  return parseCreateAutomationTrigger(parsed.trigger);
}

export type CreateAutomationPreviewInput = {
  title: string;
  overview: string;
  trigger: AutomationTriggerToolInput;
  approval_level: CreateAutomationApprovalLevel;
};

export async function previewCreateAutomationFromArguments(
  args: Record<string, unknown>,
  validate?: AutomationTriggerValidator,
): Promise<CreateAutomationPreviewInput> {
  const overview = typeof args.overview === "string" ? args.overview : "";
  if (!overview.trim()) {
    throw new Error("create_automation requires a non-empty overview or title.");
  }
  const explicitTitle = typeof args.title === "string" ? args.title : undefined;
  const input = parseCreateAutomationTriggerInput(args);
  const trigger = validate ? await validate(input) : (normalizeAutomationTrigger(input) ?? input);
  return {
    title: deriveAutomationTitle(overview, explicitTitle),
    overview: overview.trim(),
    trigger,
    approval_level: parseCreateAutomationApprovalLevel(args.approval_level),
  };
}

export function toBuiltInLazyToolIndexEntry(
  definition: ContributedHostToolDefinition,
  server = LAZY_BUILT_IN_SERVER_DESKTOP,
): BuiltInLazyToolIndexEntry {
  return {
    server,
    toolName: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    ...(definition.excludeFromAskMode ? { excludeFromAskMode: true } : {}),
    ...(definition.agentModeExposure ? { agentModeExposure: definition.agentModeExposure } : {}),
  };
}

const TIME_TRIGGER_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    kind: { type: "string", const: "time" },
    schedule: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["hourly", "daily", "weekly"] },
        hour: { type: "integer", minimum: 0, maximum: 23 },
        minute: { type: "integer", minimum: 0, maximum: 59 },
        weekday: { type: "integer", minimum: 0, maximum: 6 },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  required: ["kind", "schedule"],
  additionalProperties: false,
};

export function createAutomationContributedTool(
  contributions: readonly AutomationTriggerToolContribution[] = [],
): ContributedHostToolDefinition {
  return {
    name: CREATE_AUTOMATION_TOOL_NAME,
    excludeFromAskMode: true,
    agentModeExposure: "agent",
    description:
      "Create a Desktop automation that runs an agent turn with your prompt on the current workspace. " +
      "Triggers may be time-based or provided by installed extensions. Use when the user asks to automate recurring work or react to trigger events.",
    inputSchema: {
      type: "object",
      properties: {
        overview: {
          type: "string",
          description:
            "Agent prompt executed on each run. Write a self-contained instruction the automation agent can follow without extra context.",
        },
        title: {
          type: "string",
          description:
            "Short list title shown in the Automations UI. Optional; defaults to the first line of overview (max 80 characters).",
        },
        approval_level: {
          type: "string",
          enum: ["default", "auto-approval", "bypass-approval"],
          description:
            "Approval policy when the automation runs. default: normal tool approval prompts; auto-approval: AI reviewer auto-approves safe tool calls, uncertain ones still prompt; bypass-approval: skip high-risk approval prompts for that automation run. Omit to use default.",
        },
        trigger: {
          type: "object",
          description: "Trigger definition. Use one of the listed kinds and its matching schema.",
          oneOf: [
            TIME_TRIGGER_SCHEMA,

            ...contributions.map((contribution) => ({
              type: "object",
              properties: {
                kind: { type: "string", const: contribution.kind },
                config: contribution.inputSchema,
              },
              required: ["kind", "config"],
              additionalProperties: false,
            })),
          ],
        },
      },
      required: ["overview", "trigger"],
      additionalProperties: false,
    } satisfies JsonObject,
  };
}

export const CREATE_AUTOMATION_CONTRIBUTED_TOOL = createAutomationContributedTool();

export function buildAutomationHostToolDefinitions(
  contributions: readonly AutomationTriggerToolContribution[] = [],
): JsonValue[] {
  return buildContributedHostToolDefinitions([createAutomationContributedTool(contributions)]);
}
