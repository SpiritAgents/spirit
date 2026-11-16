import type { JsonObject } from "@spiritagent/agent-core";
import type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";

export type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
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
