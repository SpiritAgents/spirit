import path from "node:path";

import { type ChatArchive } from "@spiritagent/agent-core";
import { type HostAutomationDefinition } from "@spiritagent/automations";
import { normalizeApprovalLevel } from "@spiritagent/permissions/approval-level";

import type { DesktopHostRuntime } from "@spiritagent/sessions/host/runtime";
import {
  closeRemoteDesktopRuntime,
  createRemoteDesktopRuntime,
  replyRemoteWorkspaceCapabilityTrust,
} from "@spiritagent/sessions/host/remote-runtime";
import { spiritDataDir, type DesktopConfigFile } from "@spiritagent/sessions/host/storage";

export interface CreateAutomationRuntimeInput {
  definition: HostAutomationDefinition;
  config: DesktopConfigFile;
  sessionPath: string;
}

export interface AutomationRuntimeHandle {
  runtime: DesktopHostRuntime;
  dispose: () => Promise<void>;
  consumeTrustBlocked: () => boolean;
}

export function buildEmptyAutomationArchive(
  approvalLevel: HostAutomationDefinition["approvalLevel"],
): ChatArchive {
  return {
    messages: [],
    assistantAux: [],
    llmHistory: [],
    subagentSessions: [],
    loopEnabled: false,
    approvalLevel: normalizeApprovalLevel(approvalLevel),
  };
}

export function buildAutomationRemoteRuntimeCreateInput(input: CreateAutomationRuntimeInput): {
  dataDir: string;
  workspaceRoot: string;
  modelRef: HostAutomationDefinition["modelRef"];
  agentMode: "agent";
  archive: ChatArchive;
  approvalLevel: ReturnType<typeof normalizeApprovalLevel>;
  todoSessionKey: string;
  conversationKey: string;
} {
  const conversationKey = path.resolve(input.sessionPath);
  return {
    dataDir: spiritDataDir(),
    workspaceRoot: input.definition.workspaceRoot,
    modelRef: input.definition.modelRef,
    agentMode: "agent",
    archive: buildEmptyAutomationArchive(input.definition.approvalLevel),
    approvalLevel: normalizeApprovalLevel(input.definition.approvalLevel),
    todoSessionKey: conversationKey,
    conversationKey,
  };
}

export async function createAutomationRuntime(
  input: CreateAutomationRuntimeInput,
): Promise<AutomationRuntimeHandle> {
  let trustBlocked = false;
  let runtime: DesktopHostRuntime | undefined;

  runtime = await createRemoteDesktopRuntime({
    ...buildAutomationRemoteRuntimeCreateInput(input),
    onWorkspaceCapabilityTrustRequested: (requestId) => {
      void handleAutomationWorkspaceCapabilityTrust(
        () => runtime,
        requestId,
        input.definition.approvalLevel,
        () => {
          trustBlocked = true;
        },
      );
    },
  });

  return {
    runtime,
    dispose: async () => {
      await closeRemoteDesktopRuntime(runtime);
    },
    consumeTrustBlocked: () => {
      if (!trustBlocked) {
        return false;
      }
      trustBlocked = false;
      return true;
    },
  };
}

export async function disposeAutomationRuntime(handle: AutomationRuntimeHandle): Promise<void> {
  await handle.dispose();
}

async function handleAutomationWorkspaceCapabilityTrust(
  runtimeRef: () => DesktopHostRuntime | undefined,
  requestId: string,
  approvalLevel: HostAutomationDefinition["approvalLevel"],
  markBlocked: () => void,
): Promise<void> {
  const runtime = runtimeRef();
  if (!runtime) {
    return;
  }
  if (approvalLevel === "bypass-approval" || approvalLevel === "auto-approval") {
    await replyRemoteWorkspaceCapabilityTrust(runtime, requestId, "allowOnce");
    return;
  }
  markBlocked();
  await replyRemoteWorkspaceCapabilityTrust(runtime, requestId, "deny");
}
