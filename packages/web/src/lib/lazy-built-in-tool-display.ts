import type { DesktopAutomationTrigger } from "./automation-trigger.js";
import {
  formatDesktopAutomationTriggerLabel,
  isValidDesktopAutomationTrigger,
  type DesktopAutomationTriggerFormatLabels,
} from "./automation-trigger.js";
import type { DesktopAutomationSchedule } from "./automation-schedule.js";
import { isValidDesktopAutomationSchedule } from "./automation-schedule.js";
import type { ToolBlockSnapshot } from "../types.js";

type LazyToolGatewayFields = {
  provider?: string;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export type CreateAutomationSummaryDetail = {
  title?: string;
  triggerLabel?: string;
};

function decodePartialJsonString(value: string): string {
  return value.replace(/\\(["\\/bfnrtu])/gu, (_match, code: string) => {
    switch (code) {
      case '"':
      case "\\":
      case "/":
        return code;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u":
        return "";
      default:
        return code;
    }
  });
}

function extractCompletePartialStringField(json: string, key: string): string | undefined {
  const match = json.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match?.[1]) {
    return undefined;
  }
  const decoded = decodePartialJsonString(match[1]).trim();
  return decoded || undefined;
}

function extractPartialIntegerField(json: string, key: string): number | undefined {
  const match = json.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : undefined;
}

function tryParsePartialCreateAutomationTrigger(
  gatewayJson: string,
  args?: Record<string, unknown>,
): DesktopAutomationTrigger | undefined {
  const triggerValue = args?.trigger;
  if (triggerValue && typeof triggerValue === "object" && !Array.isArray(triggerValue)) {
    const trigger = triggerValue as DesktopAutomationTrigger;
    if (isValidDesktopAutomationTrigger(trigger)) {
      return trigger;
    }
  }

  if (!/"trigger"\s*:/u.test(gatewayJson)) {
    return undefined;
  }

  const triggerKindMatch = gatewayJson.match(
    /"trigger"\s*:\s*\{[^}]*"kind"\s*:\s*"((?:\\.|[^"\\])*)"/u,
  );
  const triggerKind = triggerKindMatch?.[1]
    ? decodePartialJsonString(triggerKindMatch[1])
    : undefined;

  if (triggerKind === "time") {
    const scheduleKindMatch = gatewayJson.match(
      /"schedule"\s*:\s*\{[^}]*"kind"\s*:\s*"((?:\\.|[^"\\])*)"/u,
    );
    const scheduleKind = scheduleKindMatch?.[1]
      ? decodePartialJsonString(scheduleKindMatch[1])
      : undefined;
    if (scheduleKind === "hourly") {
      const schedule: DesktopAutomationSchedule = { kind: "hourly" };
      return isValidDesktopAutomationSchedule(schedule) ? { kind: "time", schedule } : undefined;
    }
    const hour = extractPartialIntegerField(gatewayJson, "hour");
    const minute = extractPartialIntegerField(gatewayJson, "minute");
    if (hour === undefined || minute === undefined) {
      return undefined;
    }
    if (scheduleKind === "weekly") {
      const weekday = extractPartialIntegerField(gatewayJson, "weekday");
      if (weekday === undefined || weekday < 0 || weekday > 6) {
        return undefined;
      }
      const schedule: DesktopAutomationSchedule = {
        kind: "weekly",
        weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        hour,
        minute,
      };
      return isValidDesktopAutomationSchedule(schedule) ? { kind: "time", schedule } : undefined;
    }
    if (scheduleKind === "daily") {
      const schedule: DesktopAutomationSchedule = { kind: "daily", hour, minute };
      return isValidDesktopAutomationSchedule(schedule) ? { kind: "time", schedule } : undefined;
    }
    return undefined;
  }

  if (triggerKind === "github") {
    const owner = extractCompletePartialStringField(gatewayJson, "owner");
    const repo = extractCompletePartialStringField(gatewayJson, "repo");
    const eventMatch = gatewayJson.match(/"event"\s*:\s*"((?:\\.|[^"\\])*)"/u);
    const event = eventMatch?.[1] ? decodePartialJsonString(eventMatch[1]) : undefined;
    if (!owner || !repo || (event !== "pull_request_created" && event !== "issue_created")) {
      return undefined;
    }
    const trigger: DesktopAutomationTrigger = {
      kind: "github",
      owner,
      repo,
      event,
    };
    return isValidDesktopAutomationTrigger(trigger) ? trigger : undefined;
  }

  return undefined;
}

export function parseLazyToolGatewayFieldsFromJson(
  json: string | undefined,
): LazyToolGatewayFields {
  if (!json?.trim()) {
    return {};
  }

  const trimmed = json.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    if (record.kind === "lazyToolGateway" && typeof record.argumentsJson === "string") {
      return parseLazyToolGatewayFieldsFromJson(record.argumentsJson);
    }
    const provider = typeof record.provider === "string" ? record.provider.trim() : undefined;
    const server = typeof record.server === "string" ? record.server.trim() : undefined;
    const tool = typeof record.tool === "string" ? record.tool.trim() : undefined;
    const argsValue = record.arguments;
    const args =
      argsValue && typeof argsValue === "object" && !Array.isArray(argsValue)
        ? (argsValue as Record<string, unknown>)
        : undefined;
    return {
      ...(provider ? { provider } : {}),
      ...(server ? { server } : {}),
      ...(tool ? { tool } : {}),
      ...(args ? { arguments: args } : {}),
    };
  } catch {
    const provider = extractCompletePartialStringField(trimmed, "provider");
    const server = extractCompletePartialStringField(trimmed, "server");
    const tool = extractCompletePartialStringField(trimmed, "tool");
    return {
      ...(provider ? { provider } : {}),
      ...(server ? { server } : {}),
      ...(tool ? { tool } : {}),
    };
  }
}

export function lazyToolGatewayFieldsFromToolSnapshot(
  tool: Pick<ToolBlockSnapshot, "argsExcerpt" | "streamingArgumentsJson">,
): LazyToolGatewayFields {
  const streaming = parseLazyToolGatewayFieldsFromJson(tool.streamingArgumentsJson);
  if (streaming.provider || streaming.server || streaming.tool) {
    return streaming;
  }
  return parseLazyToolGatewayFieldsFromJson(tool.argsExcerpt);
}

export function isBuiltInCreateAutomationLazyToolCall(fields: LazyToolGatewayFields): boolean {
  return (
    fields.provider === "built-in" &&
    fields.server === "desktop" &&
    fields.tool === "create_automation"
  );
}

export function createAutomationTitleFromLazyArguments(
  args: Record<string, unknown> | undefined,
): string | undefined {
  const explicitTitle = typeof args?.title === "string" ? args.title.trim() : "";
  if (explicitTitle) {
    return explicitTitle;
  }
  const overview = typeof args?.overview === "string" ? args.overview.trim() : "";
  if (!overview) {
    return undefined;
  }
  const firstLine = overview.split(/\r?\n/u)[0]?.trim() ?? "";
  if (!firstLine) {
    return undefined;
  }
  return [...firstLine].length > 80 ? [...firstLine].slice(0, 80).join("") : firstLine;
}

export function resolveCreateAutomationSummaryDetail(input: {
  gatewayJson?: string;
  requestRecord?: Record<string, unknown>;
  formatTriggerLabel: (trigger: DesktopAutomationTrigger) => string;
}): CreateAutomationSummaryDetail | undefined {
  const gatewayJson = input.gatewayJson?.trim() ?? "";
  const fields = input.requestRecord
    ? {
        ...(typeof input.requestRecord.provider === "string"
          ? { provider: input.requestRecord.provider.trim() }
          : {}),
        ...(typeof input.requestRecord.server === "string"
          ? { server: input.requestRecord.server.trim() }
          : {}),
        ...(typeof input.requestRecord.tool === "string"
          ? { tool: input.requestRecord.tool.trim() }
          : {}),
        ...(input.requestRecord.arguments &&
        typeof input.requestRecord.arguments === "object" &&
        !Array.isArray(input.requestRecord.arguments)
          ? { arguments: input.requestRecord.arguments as Record<string, unknown> }
          : {}),
      }
    : parseLazyToolGatewayFieldsFromJson(gatewayJson || undefined);

  if (!isBuiltInCreateAutomationLazyToolCall(fields)) {
    return undefined;
  }

  const args =
    fields.arguments ??
    (input.requestRecord?.arguments &&
    typeof input.requestRecord.arguments === "object" &&
    !Array.isArray(input.requestRecord.arguments)
      ? (input.requestRecord.arguments as Record<string, unknown>)
      : undefined);

  const titleFromArgs = createAutomationTitleFromLazyArguments(args);
  const titleFromPartial =
    titleFromArgs ??
    extractCompletePartialStringField(gatewayJson, "title") ??
    (extractCompletePartialStringField(gatewayJson, "overview")
      ? createAutomationTitleFromLazyArguments({
          overview: extractCompletePartialStringField(gatewayJson, "overview"),
        })
      : undefined);

  const trigger = tryParsePartialCreateAutomationTrigger(gatewayJson, args);
  const triggerLabel = trigger ? input.formatTriggerLabel(trigger) : undefined;

  return {
    ...(titleFromPartial ? { title: titleFromPartial } : {}),
    ...(triggerLabel ? { triggerLabel } : {}),
  };
}

export function defaultDesktopAutomationTriggerFormatLabels(): DesktopAutomationTriggerFormatLabels {
  return {
    hourly: "Hourly",
    dailyPrefix: "Daily",
    weeklyPrefix: "Weekly",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    formatWeekly: (weekday, time) => `Weekly ${weekday} ${time}`,
    githubPrefix: "GitHub",
    githubPullRequestCreated: "PR created",
    githubIssueCreated: "Issue created",
  };
}

export function builtInCreateAutomationToolCallSummaryParts(input: {
  gatewayJson?: string;
  requestRecord?: Record<string, unknown>;
  headline: string;
  formatTriggerLabel?: (trigger: DesktopAutomationTrigger) => string;
}): { headline: string; detail?: string; resultDetail?: string } | undefined {
  const detail = resolveCreateAutomationSummaryDetail({
    gatewayJson: input.gatewayJson,
    requestRecord: input.requestRecord,
    formatTriggerLabel:
      input.formatTriggerLabel ??
      ((trigger) =>
        formatDesktopAutomationTriggerLabel(
          trigger,
          defaultDesktopAutomationTriggerFormatLabels(),
        )),
  });
  if (!detail) {
    return undefined;
  }
  // The automation name rides the second level and the schedule the dimmer third level, like the
  // shell card's reason/command hierarchy — no " · " glued onto the name.
  return {
    headline: input.headline,
    ...(detail.title ? { detail: detail.title } : {}),
    ...(detail.triggerLabel ? { resultDetail: detail.triggerLabel } : {}),
  };
}
