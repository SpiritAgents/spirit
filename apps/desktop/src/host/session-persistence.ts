import path from "node:path";

import type { ChatArchive } from "@spiritagent/agent-core";

import {
  normalizeTimelineSnapshotForPersistence,
  type PersistedDesktopTimelineTurnSnapshot,
} from "./chat-schema.js";
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  buildStoredDesktopSession,
  cloneQueuedUserTurns,
  serializeSubagentTimelinesFromMessages,
} from "./sessions.js";
import type { SessionBundle } from "./session-bundle.js";
import type { DesktopHostRuntime } from "./runtime.js";
import { saveStoredSession } from "./storage.js";

export interface PersistDesktopSessionBundleInput {
  bundle: SessionBundle;
  workspaceRoot: string;
  gitBranch?: string;
  fromRuntime?: DesktopHostRuntime;
  bumpListSortAt?: boolean;
}

export interface PersistDesktopSessionBundleResult {
  previousId?: string;
  nextId?: string;
  rekeyNeeded: boolean;
  /** Persisted timeline snapshot (same shape as disk); present on successful persist. */
  desktopMessageTimeline?: PersistedDesktopTimelineTurnSnapshot[];
}

export async function persistDesktopSessionBundle(
  input: PersistDesktopSessionBundleInput,
): Promise<PersistDesktopSessionBundleResult> {
  const { bundle } = input;
  const activeSession = bundle.activeSession;
  if (!activeSession || activeSession.kind === "ephemeral") {
    return { rekeyNeeded: false };
  }

  const desktopMessages = bundle.messageTimeline.toMessages();
  const normalizedTimelineSnapshot = normalizeTimelineSnapshotForPersistence(
    bundle.messageTimeline.snapshot(),
  );
  if (desktopMessages.length === 0 || normalizedTimelineSnapshot.length === 0) {
    return { rekeyNeeded: false };
  }
  const archiveMessages = buildArchiveMessagesFromConversation(desktopMessages);
  const archiveAssistantAux = buildArchiveAssistantAuxFromConversation(desktopMessages);
  const archive = input.fromRuntime
    ? input.fromRuntime.toArchive(archiveMessages, archiveAssistantAux)
    : ({
        messages: archiveMessages,
        assistantAux: archiveAssistantAux,
        llmHistory: bundle.archiveHistory,
        subagentSessions: bundle.archiveSubagentSessions ?? [],
        loopEnabled: bundle.loopEnabled,
      } satisfies ChatArchive);

  bundle.archiveHistory = archive.llmHistory;
  bundle.archiveSubagentSessions = archive.subagentSessions ?? [];
  bundle.loopEnabled = archive.loopEnabled === true;

  const bumpListSortAt = input.bumpListSortAt === true;
  const savedAtUnixMs = bumpListSortAt ? Date.now() : (bundle.listSortSavedAtUnixMs ?? Date.now());
  const sessionTitleSource = bundle.sessionTitleSource ?? "seed";
  bundle.sessionTitleSource = sessionTitleSource;
  const subagentDesktopTimelines = serializeSubagentTimelinesFromMessages(
    bundle.subagentDesktopMessagesBySessionId,
  );
  const stored = buildStoredDesktopSession({
    llmHistory: archive.llmHistory,
    subagentSessions: archive.subagentSessions,
    savedAtUnixMs,
    sessionDisplayName: activeSession.displayName,
    sessionTitleSource,
    ...(bundle.pinnedAtUnixMs ? { pinnedAtUnixMs: bundle.pinnedAtUnixMs } : {}),
    workspaceRoot: input.workspaceRoot,
    gitBranch: input.gitBranch,
    ...(bundle.activePlanPath ? { activePlanPath: bundle.activePlanPath } : {}),
    desktopMessageTimeline: bundle.messageTimeline.snapshot(),
    rewind: bundle.rewind,
    loopEnabled: bundle.loopEnabled,
    approvalLevel: bundle.approvalLevel,
    ...(bundle.activeModel ? { activeModel: bundle.activeModel } : {}),
    ...(bundle.contextUsage ? { contextUsage: { ...bundle.contextUsage } } : {}),
    ...(subagentDesktopTimelines ? { subagentDesktopTimelines } : {}),
    ...(bundle.queuedUserTurns.length > 0
      ? { queuedUserTurns: cloneQueuedUserTurns(bundle.queuedUserTurns) }
      : {}),
  });
  if (bumpListSortAt) {
    bundle.listSortSavedAtUnixMs = savedAtUnixMs;
  }
  const previousId = bundle.id;
  activeSession.filePath = await saveStoredSession(activeSession.filePath, stored);
  bundle.lastPersistedAtUnixMs = Date.now();
  return {
    previousId,
    nextId: activeSession.filePath,
    rekeyNeeded: path.resolve(previousId) !== path.resolve(activeSession.filePath),
    desktopMessageTimeline: normalizedTimelineSnapshot,
  };
}
