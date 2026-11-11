import type { HookEventName } from "@spiritagent/agent-core";

export type WorkspaceCapabilityKind = "hooks" | "tasks";
export type WorkspaceCapabilityTrustDecision = "allowOnce" | "deny" | "alwaysTrust";

export interface WorkspaceHookTrustListEntry {
  event: HookEventName;
  command: string;
  resolvedPath: string;
}

export interface WorkspaceTaskTrustListEntry {
  label: string;
  command: string;
  sourcePath: string;
}

export interface WorkspaceCapabilityTrustRequest {
  workspaceRoot: string;
  contentHash: string;
  hashChanged: boolean;
  hooks: WorkspaceHookTrustListEntry[];
  tasks?: {
    contentHash: string;
    hashChanged: boolean;
    items: WorkspaceTaskTrustListEntry[];
  };
}
