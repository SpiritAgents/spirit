/** Renderer-safe automation trigger types and labels. Keep host services out of this module. */

import type { JsonObject } from "@spiritagent/agent-core";

export type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";
import type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";
import {
  formatDesktopAutomationScheduleLabel,
  isValidDesktopAutomationSchedule,
} from "./automation-schedule.js";

export interface DesktopAutomationExtensionTrigger {
  kind: `extension:${string}`;
  config: JsonObject;
  label: string;
  state?: JsonObject;
}

export type DesktopAutomationTrigger =
  | { kind: "time"; schedule: DesktopAutomationSchedule }
  | DesktopAutomationExtensionTrigger;

export type DesktopAutomationTriggerFormatLabels = DesktopAutomationScheduleFormatLabels;

export function formatDesktopAutomationTriggerLabel(
  trigger: DesktopAutomationTrigger,
  labels: DesktopAutomationTriggerFormatLabels,
): string {
  if (trigger.kind === "time") {
    return formatDesktopAutomationScheduleLabel(trigger.schedule, labels);
  }
  return trigger.label.trim() || trigger.kind;
}

export function defaultDesktopTimeTrigger(
  schedule: DesktopAutomationSchedule = { kind: "daily", hour: 20, minute: 0 },
): DesktopAutomationTrigger {
  return { kind: "time", schedule };
}

export function isValidDesktopAutomationTrigger(trigger: DesktopAutomationTrigger): boolean {
  if (trigger.kind === "time") {
    return isValidDesktopAutomationSchedule(trigger.schedule);
  }
  return Boolean(
    trigger.kind.startsWith("extension:") && trigger.config && !Array.isArray(trigger.config),
  );
}
