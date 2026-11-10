import type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";

export type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from "./automation-schedule.js";

export type DesktopAutomationGitHubEvent = "pull_request_created" | "issue_created";

export type DesktopAutomationTrigger =
  | { kind: "time"; schedule: DesktopAutomationSchedule }
  | {
      kind: "github";
      owner: string;
      repo: string;
      event: DesktopAutomationGitHubEvent;
      poll?: { lastSeenNumber: number };
    };

export interface DesktopAutomationTriggerFormatLabels extends DesktopAutomationScheduleFormatLabels {
  githubPrefix: string;
  githubPullRequestCreated: string;
  githubIssueCreated: string;
}
