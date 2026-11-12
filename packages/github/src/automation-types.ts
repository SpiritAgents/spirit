import type { ModelEffortSelection } from "@spiritagent/agent-core/model-effort";
import type { ModelReasoningEffort } from "@spiritagent/agent-core/reasoning-effort";
import type { ModelRef } from "@spiritagent/config";

export type HostAutomationWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type HostAutomationSchedule =
  | { kind: "hourly" }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: HostAutomationWeekday; hour: number; minute: number };
export type HostAutomationTimeSchedule = HostAutomationSchedule;
export type HostAutomationGitHubEvent = "pull_request_created" | "issue_created";
export type HostAutomationTrigger =
  | { kind: "time"; schedule: HostAutomationTimeSchedule }
  | {
      kind: "github";
      owner: string;
      repo: string;
      event: HostAutomationGitHubEvent;
      poll?: { lastSeenNumber: number };
    };

export interface HostAutomationDefinition {
  id: string;
  title: string;
  overview: string;
  trigger: HostAutomationTrigger;
  workspaceRoot: string;
  modelRef: ModelRef;
  reasoningEffort?: ModelReasoningEffort;
  effort?: ModelEffortSelection;
  approvalLevel: "default" | "auto-approval" | "bypass-approval";
  enabled: boolean;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  lastFiredAtUnixMs?: number;
  githubPollError?: string;
}
