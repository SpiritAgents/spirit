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

export function parseCreateAutomationTrigger(value: unknown): HostAutomationTrigger {
  const trigger = normalizeAutomationTrigger(value);
  if (!trigger) {
    throw new Error("Invalid automation trigger.");
  }
  return trigger;
}

export function parseCreateAutomationTriggerInput(
  parsed: Record<string, unknown>,
): HostAutomationTrigger {
  if (parsed.trigger === undefined) {
    throw new Error("create_automation is missing trigger.");
  }
  return parseCreateAutomationTrigger(parsed.trigger);
}

export type CreateAutomationPreviewInput = {
  title: string;
  overview: string;
  trigger: HostAutomationTrigger;
  approval_level: CreateAutomationApprovalLevel;
};

export function previewCreateAutomationFromArguments(
  args: Record<string, unknown>,
): CreateAutomationPreviewInput {
  const overview = typeof args.overview === "string" ? args.overview : "";
  if (!overview.trim()) {
    throw new Error("create_automation requires a non-empty overview or title.");
  }
  const explicitTitle = typeof args.title === "string" ? args.title : undefined;
  return {
    title: deriveAutomationTitle(overview, explicitTitle),
    overview: overview.trim(),
    trigger: parseCreateAutomationTriggerInput(args),
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

export const CREATE_AUTOMATION_CONTRIBUTED_TOOL: ContributedHostToolDefinition = {
  name: CREATE_AUTOMATION_TOOL_NAME,
  excludeFromAskMode: true,
  agentModeExposure: "agent",
  description:
    "Create a Desktop automation that runs an agent turn with your prompt on the current workspace. " +
    "Triggers may be time-based (hourly/daily/weekly local time) or GitHub repository events (new pull request or issue). " +
    "Use when the user asks to automate recurring work or react to GitHub activity.",
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
        description:
          "Preferred trigger definition. kind=time uses schedule; kind=github listens for new pull requests or issues in a repository.",
        properties: {
          kind: {
            type: "string",
            enum: ["time", "github"],
          },
          schedule: {
            type: "object",
            description: "Required when kind=time.",
            properties: {
              kind: { type: "string", enum: ["hourly", "daily", "weekly"] },
              hour: { type: "integer", minimum: 0, maximum: 23 },
              minute: { type: "integer", minimum: 0, maximum: 59 },
              weekday: { type: "integer", minimum: 0, maximum: 6 },
            },
            required: ["kind"],
            additionalProperties: false,
          },
          owner: { type: "string", description: "GitHub owner/org. Required when kind=github." },
          repo: {
            type: "string",
            description: "GitHub repository name. Required when kind=github.",
          },
          event: {
            type: "string",
            enum: ["pull_request_created", "issue_created"],
            description: "GitHub event to watch when kind=github.",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
    required: ["overview"],
    additionalProperties: false,
  } satisfies JsonObject,
};

export function buildAutomationHostToolDefinitions(): JsonValue[] {
  return buildContributedHostToolDefinitions([CREATE_AUTOMATION_CONTRIBUTED_TOOL]);
}
