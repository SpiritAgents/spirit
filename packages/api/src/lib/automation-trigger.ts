import type { JsonObject } from "@spiritagent/agent-core";
import type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";

export type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";

export type DesktopAutomationGitHubEvent = "pull_request_created" | "issue_created";

export interface DesktopAutomationExtensionTrigger {
  kind: `extension:${string}`;
  config: JsonObject;
  label: string;
  state?: JsonObject;
}

export type DesktopAutomationTrigger =
  | { kind: "time"; schedule: DesktopAutomationSchedule }
  | {
      kind: "github";
      owner: string;
      repo: string;
      event: DesktopAutomationGitHubEvent;
      poll?: { lastSeenNumber: number };
    }
  | DesktopAutomationExtensionTrigger;

export interface DesktopAutomationTriggerFormatLabels extends DesktopAutomationScheduleFormatLabels {
  githubPrefix: string;
  githubPullRequestCreated: string;
  githubIssueCreated: string;
}
