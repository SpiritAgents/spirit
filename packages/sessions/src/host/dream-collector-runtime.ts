import { type RuntimeTurnResult } from "@spiritagent/agent-core";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import type { HostDreamSourceSessionRef, ModelRef } from "@spiritagent/host-internal";

import type { DesktopToolRequest } from "./contracts.js";
import type { DesktopHostRuntime } from "./runtime.js";
import {
  closeRemoteDesktopRuntime,
  createRemoteDesktopRuntime,
  replyRemoteWorkspaceCapabilityTrust,
} from "./remote-runtime.js";
import { buildEmptyAutomationArchive } from "./automation-runtime.js";
import { spiritDataDir } from "./storage.js";

export interface CreateDreamCollectorRuntimeInput {
  workspaceRoot: string;
  gitBranch: string;
  modelRef: ModelRef;
  dreamSourceSession: HostDreamSourceSessionRef;
  approvalLevel?: "default" | "auto-approval" | "bypass-approval";
}

export interface DreamCollectorRuntimeHandle {
  runtime: DesktopHostRuntime;
  dispose: () => Promise<void>;
}

export function buildDreamCollectorRemoteCreateInput(input: CreateDreamCollectorRuntimeInput): {
  dataDir: string;
  workspaceRoot: string;
  modelRef: ModelRef;
  agentMode: "agent";
  archive: ReturnType<typeof buildEmptyAutomationArchive>;
  approvalLevel: "default" | "auto-approval" | "bypass-approval";
  sessionKind: "dream-collector";
  dreamScope: { workspaceRoot: string; gitBranch: string };
  dreamSourceSession: HostDreamSourceSessionRef;
} {
  return {
    dataDir: spiritDataDir(),
    workspaceRoot: input.workspaceRoot,
    modelRef: input.modelRef,
    agentMode: "agent",
    archive: buildEmptyAutomationArchive(input.approvalLevel ?? "auto-approval"),
    approvalLevel: input.approvalLevel ?? "auto-approval",
    sessionKind: "dream-collector",
    dreamScope: {
      workspaceRoot: input.workspaceRoot,
      gitBranch: input.gitBranch,
    },
    dreamSourceSession: input.dreamSourceSession,
  };
}

export async function createDreamCollectorRuntime(
  input: CreateDreamCollectorRuntimeInput,
): Promise<DreamCollectorRuntimeHandle> {
  let runtime: DesktopHostRuntime | undefined;
  runtime = await createRemoteDesktopRuntime({
    ...buildDreamCollectorRemoteCreateInput(input),
    onWorkspaceCapabilityTrustRequested: (requestId) => {
      void replyRemoteWorkspaceCapabilityTrust(runtime!, requestId, "allowOnce").catch((error) => {
        console.warn("[dream-collector] replyWorkspaceCapabilityTrust failed", error);
      });
    },
  });

  return {
    runtime,
    dispose: async () => {
      await closeRemoteDesktopRuntime(runtime);
    },
  };
}

export async function disposeDreamCollectorRuntime(
  handle: DreamCollectorRuntimeHandle,
): Promise<void> {
  await handle.dispose();
}

export async function submitDreamCollectorTurn(
  runtime: DesktopHostRuntime,
  text: string,
): Promise<RuntimeTurnResult<unknown, DesktopToolRequest>> {
  await runtime.startUserTurnStreaming(text);
  return waitForDreamCollectorTurnResult(runtime);
}

export async function resumeDreamCollectorTurn(
  runtime: DesktopHostRuntime,
  resume: () => Promise<void>,
): Promise<RuntimeTurnResult<unknown, DesktopToolRequest>> {
  await resume();
  return waitForDreamCollectorTurnResult(runtime);
}

async function waitForDreamCollectorTurnResult(
  runtime: DesktopHostRuntime,
): Promise<RuntimeTurnResult<unknown, DesktopToolRequest>> {
  while (true) {
    const completed = runtime.takeCompletedTurnResult();
    if (completed) {
      return completed;
    }
    if (!runtime.isBusy()) {
      throw new Error("Dream collector runtime ended without a turn result.");
    }
    runtime.tickThinkingSpinner();
    await runtime.poll();
    await waitForImmediate();
  }
}
