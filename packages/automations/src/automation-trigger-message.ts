import type { JsonObject } from "@spiritagent/agent-core";

import {
  formatScheduleLabel,
  type HostAutomationDefinition,
  type HostAutomationTrigger,
} from "./automations.js";

export const AUTOMATION_TRIGGER_OPEN = "<automation_trigger>";
export const AUTOMATION_TRIGGER_CLOSE = "</automation_trigger>";

export type AutomationRunTriggerContext =
  | { kind: "time" }
  | { kind: "extension"; summary: string; context?: JsonObject };

export function formatTimeAutomationEventLabel(
  trigger: Extract<HostAutomationTrigger, { kind: "time" }>,
): string {
  return `Scheduled run (${formatScheduleLabel(trigger.schedule, {
    hourly: "hourly",
    dailyPrefix: "daily",
    weeklyPrefix: "weekly",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    formatWeekly: (weekday, time) => `weekly ${weekday} ${time}`,
  })})`;
}

export function buildAutomationTriggerEventLine(
  trigger: HostAutomationTrigger,
  context: AutomationRunTriggerContext,
): string {
  if (trigger.kind === "time") {
    return `${formatTimeAutomationEventLabel(trigger)}.`;
  }
  if (context.kind === "extension") {
    const detail = context.context ? ` ${JSON.stringify(context.context)}` : "";
    return `${context.summary}${detail}`;
  }
  return "Automation activated.";
}

export function buildAutomationTriggerMessage(input: {
  overview: string;
  trigger: HostAutomationTrigger;
  context: AutomationRunTriggerContext;
}): string {
  const overview = input.overview.trim();
  const eventLine = buildAutomationTriggerEventLine(input.trigger, input.context);
  const metaBlock = [
    AUTOMATION_TRIGGER_OPEN,
    "Automation activated.",
    `Event: ${eventLine}`,
    AUTOMATION_TRIGGER_CLOSE,
  ].join("\n");
  return overview ? `${metaBlock}\n\n${overview}` : metaBlock;
}

export function defaultAutomationRunTriggerContext(
  definition: HostAutomationDefinition,
): AutomationRunTriggerContext {
  if (definition.trigger.kind !== "time") {
    throw new Error("Extension automation runs require a provider event context.");
  }
  return { kind: "time" };
}
