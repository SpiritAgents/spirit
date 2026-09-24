import path from "node:path";

import type { ChatArchive } from "@spiritagent/agent-core";
import { isManualCompactionUiStatusText } from "@spiritagent/agent-core";
import {
  CHAT_SCHEMA_VERSION,
  hydrateTimelineSnapshotFromPersistence,
  normalizeTimelineSnapshotForPersistence,
  timelinePersistedSnapshotToMessages,
  timelineRuntimeSnapshotToMessages,
  type PersistedDesktopTimelineTurnSnapshot,
  validateTimelineSnapshotV2,
} from "./chat-schema.js";
import type { StoredDesktopSession } from "./contracts.js";
import { spreadChipNavigateMeta } from "../lib/composer-chip-navigate-meta.js";

import type {
  ActiveSessionSnapshot,
  ConversationContextUsageSnapshot,
  ConversationMessageSnapshot,
  SessionListItem,
} from "../types.js";
import { resolveDesktopSessionTranscriptPath } from "./transcript-session.js";
import {
  extractActivePlanPathFromLlmHistory,
  modelRefKey,
  normalizeApprovalLevel,
  parseModelRef,
  type ApprovalLevel,
  type ModelRef,
} from "@spiritagent/host-internal";
import type { QueuedUserTurn } from "./message-queue.js";
import type { SessionTitleSource } from "./contracts.js";
import type { DesktopTimelineTurnSnapshot } from "./message-timeline.js";
import { DesktopMessageTimeline } from "./message-timeline.js";
import type { SessionBundle } from "./session-bundle.js";
import { isSessionBundleBusy } from "./direct-media-turn.js";
import {
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
  shouldDropEmptyAssistantMessage,
  shouldHideEmptyPendingAssistantSnapshot,
} from "./message-ordering.js";
import { cloneArchiveHistory, cloneArchiveSubagentSessions } from "./service-utils.js";
import { createDesktopRewindMetadata, type StoredDesktopRewindMetadata } from "./rewind.js";

export const EPHEMERAL_COMMIT_SESSION_PREFIX = "ephemeral://commit-message/";
export const EPHEMERAL_WORKTREE_SESSION_PREFIX = "ephemeral://worktree-naming/";
export const EPHEMERAL_SESSION_TITLE_PREFIX = "ephemeral://session-title/";
const MAX_EPHEMERAL_COMMIT_SESSIONS = 8;

function parseStoredSessionActiveModel(value: unknown): ModelRef | undefined {
  const asRef = parseModelRef(value);
  if (asRef) {
    return asRef;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const separatorIndex = trimmed.lastIndexOf("::");
    if (separatorIndex > 0) {
      const groupId = trimmed.slice(0, separatorIndex).trim();
      const name = trimmed.slice(separatorIndex + 2).trim();
      if (groupId && name) {
        return { groupId, name };
      }
    }
    return { groupId: "", name: trimmed };
  }
  return undefined;
}

export function serializeSessionActiveModel(ref: ModelRef): string {
  return modelRefKey(ref);
}

export interface EphemeralSessionRecord {
  path: string;
  displayName: string;
  workspaceRoot: string;
  modifiedAtUnixMs: number;
  messages: ConversationMessageSnapshot[];
  llmHistory: ChatArchive["llmHistory"];
  readOnly: true;
}

export interface RestoredSessionState {
  messages: ConversationMessageSnapshot[];
  desktopMessageTimeline?: DesktopTimelineTurnSnapshot[];
  activeSession: ActiveSessionSnapshot;
  archiveHistory: ChatArchive["llmHistory"];
  archiveSubagentSessions: NonNullable<ChatArchive["subagentSessions"]>;
  rewind: StoredDesktopRewindMetadata;
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  activeModel?: ModelRef;
  activePlanPath?: string;
  sessionTitleSource?: SessionTitleSource;
  pinnedAtUnixMs?: number;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopMessagesBySessionId?: Map<string, ConversationMessageSnapshot[]>;
  queuedUserTurns?: QueuedUserTurn[];
}

export function isEphemeralCommitSessionPath(filePath: string): boolean {
  return filePath.startsWith(EPHEMERAL_COMMIT_SESSION_PREFIX);
}

export function isEphemeralWorktreeSessionPath(filePath: string): boolean {
  return filePath.startsWith(EPHEMERAL_WORKTREE_SESSION_PREFIX);
}

export function isEphemeralDebugSessionPath(filePath: string): boolean {
  return isEphemeralCommitSessionPath(filePath) || isEphemeralWorktreeSessionPath(filePath);
}

export function rememberEphemeralSessionRecord(
  sessions: EphemeralSessionRecord[],
  record: EphemeralSessionRecord,
): EphemeralSessionRecord[] {
  return [record, ...sessions.filter((session) => session.path !== record.path)].slice(
    0,
    MAX_EPHEMERAL_COMMIT_SESSIONS,
  );
}

export function removeEphemeralSessionRecord(
  sessions: EphemeralSessionRecord[],
  filePath: string,
): EphemeralSessionRecord[] {
  return sessions.filter((session) => session.path !== filePath);
}

export function ephemeralSessionsToListItems(
  sessions: EphemeralSessionRecord[],
): SessionListItem[] {
  return sessions.map((session) => ({
    path: session.path,
    displayName: session.displayName,
    modifiedAtUnixMs: session.modifiedAtUnixMs,
    workspaceRoot: session.workspaceRoot,
    kind: "ephemeral",
    readOnly: true,
    transcriptPath: resolveDesktopSessionTranscriptPath(session.path),
  }));
}

export function buildCommitEphemeralSessionRecord(input: {
  path: string;
  displayName: string;
  workspaceRoot: string;
  messages: ConversationMessageSnapshot[];
  modifiedAtUnixMs?: number;
}): EphemeralSessionRecord {
  return {
    path: input.path,
    displayName: input.displayName,
    workspaceRoot: input.workspaceRoot,
    modifiedAtUnixMs: input.modifiedAtUnixMs ?? Date.now(),
    messages: cloneConversationMessages(input.messages),
    llmHistory: input.messages.map((entry) => ({
      role: entry.role,
      content: entry.content,
      imagePaths: [],
    })),
    readOnly: true,
  };
}

export function restoreEphemeralSessionState(record: EphemeralSessionRecord): RestoredSessionState {
  return {
    messages: cloneConversationMessages(record.messages),
    activeSession: {
      filePath: record.path,
      displayName: record.displayName,
      kind: "ephemeral",
      readOnly: true,
    },
    archiveHistory: cloneArchiveHistory(record.llmHistory),
    archiveSubagentSessions: [],
    rewind: createDesktopRewindMetadata(),
    loopEnabled: false,
    approvalLevel: "default",
  };
}

export function restoreStoredSessionState(input: {
  filePath: string;
  loaded: StoredDesktopSession;
}): RestoredSessionState {
  validateTimelineSnapshotV2(input.loaded.desktopMessageTimeline);
  const runtimeTimeline = hydrateTimelineSnapshotFromPersistence(
    input.loaded.desktopMessageTimeline,
  );
  const messages = timelinePersistedSnapshotToMessages(input.loaded.desktopMessageTimeline);
  const storedActivePlanPath =
    typeof input.loaded.activePlanPath === "string" ? input.loaded.activePlanPath.trim() : "";
  const activePlanPath =
    storedActivePlanPath.length > 0
      ? storedActivePlanPath
      : extractActivePlanPathFromLlmHistory(input.loaded.llmHistory);
  return {
    messages,
    desktopMessageTimeline: runtimeTimeline,
    activeSession: {
      filePath: path.resolve(input.filePath),
      displayName: input.loaded.sessionDisplayName ?? deriveDisplayNameFromMessages(messages),
      kind: "stored",
    },
    archiveHistory: cloneArchiveHistory(input.loaded.llmHistory),
    archiveSubagentSessions: cloneSubagentSessions(input.loaded.subagentSessions ?? []),
    rewind: input.loaded.rewind ?? createDesktopRewindMetadata(),
    loopEnabled: input.loaded.loopEnabled === true,
    approvalLevel: normalizeApprovalLevel(input.loaded.approvalLevel),
    ...((): { activeModel?: ModelRef } => {
      const activeModel = parseStoredSessionActiveModel(input.loaded.activeModel);
      return activeModel ? { activeModel } : {};
    })(),
    ...(activePlanPath ? { activePlanPath } : {}),
    ...(input.loaded.sessionTitleSource === "seed" ||
    input.loaded.sessionTitleSource === "llm" ||
    input.loaded.sessionTitleSource === "manual"
      ? { sessionTitleSource: input.loaded.sessionTitleSource }
      : {}),
    ...(input.loaded.pinnedAtUnixMs ? { pinnedAtUnixMs: input.loaded.pinnedAtUnixMs } : {}),
    ...(input.loaded.contextUsage ? { contextUsage: { ...input.loaded.contextUsage } } : {}),
    ...(input.loaded.subagentDesktopTimelines
      ? {
          subagentDesktopMessagesBySessionId: cloneSubagentTimelinesRecord(
            input.loaded.subagentDesktopTimelines,
          ),
        }
      : {}),
    ...(input.loaded.queuedUserTurns?.length
      ? { queuedUserTurns: cloneQueuedUserTurns(input.loaded.queuedUserTurns) }
      : {}),
  };
}

export function buildStoredDesktopSession(input: {
  llmHistory: ChatArchive["llmHistory"];
  subagentSessions?: ChatArchive["subagentSessions"];
  savedAtUnixMs?: number;
  sessionDisplayName: string;
  sessionTitleSource?: SessionTitleSource;
  pinnedAtUnixMs?: number;
  workspaceRoot: string;
  gitBranch?: string;
  activePlanPath?: string;
  desktopMessageTimeline: DesktopTimelineTurnSnapshot[];
  rewind: StoredDesktopRewindMetadata;
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  activeModel?: ModelRef;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopTimelines?: Record<string, PersistedDesktopTimelineTurnSnapshot[]>;
  queuedUserTurns?: QueuedUserTurn[];
  automationId?: string;
  automationRunId?: string;
}): StoredDesktopSession {
  const desktopMessageTimeline = normalizeTimelineSnapshotForPersistence(
    input.desktopMessageTimeline,
  );
  validateTimelineSnapshotV2(desktopMessageTimeline);
  return {
    chatSchemaVersion: CHAT_SCHEMA_VERSION,
    llmHistory: input.llmHistory,
    ...(input.subagentSessions?.length ? { subagentSessions: input.subagentSessions } : {}),
    loopEnabled: input.loopEnabled,
    approvalLevel: input.approvalLevel,
    ...(input.activeModel ? { activeModel: serializeSessionActiveModel(input.activeModel) } : {}),
    desktopMessageTimeline,
    savedAtUnixMs: input.savedAtUnixMs ?? Date.now(),
    sessionDisplayName: input.sessionDisplayName,
    ...(input.sessionTitleSource ? { sessionTitleSource: input.sessionTitleSource } : {}),
    ...(input.pinnedAtUnixMs ? { pinnedAtUnixMs: input.pinnedAtUnixMs } : {}),
    workspaceRoot: input.workspaceRoot,
    ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
    ...(input.automationId ? { automationId: input.automationId } : {}),
    ...(input.automationRunId ? { automationRunId: input.automationRunId } : {}),
    ...(input.activePlanPath ? { activePlanPath: input.activePlanPath } : {}),
    rewind: input.rewind,
    ...(input.contextUsage ? { contextUsage: { ...input.contextUsage } } : {}),
    ...(input.subagentDesktopTimelines
      ? { subagentDesktopTimelines: input.subagentDesktopTimelines }
      : {}),
    ...(input.queuedUserTurns?.length
      ? { queuedUserTurns: cloneQueuedUserTurns(input.queuedUserTurns) }
      : {}),
  };
}

export function cloneQueuedUserTurns(queued: readonly QueuedUserTurn[]): QueuedUserTurn[] {
  return queued.map((item) => ({
    ...item,
    ...(item.explicitWorkspaceFiles
      ? { explicitWorkspaceFiles: item.explicitWorkspaceFiles.map((file) => ({ ...file })) }
      : {}),
    ...(item.turnSkills
      ? {
          turnSkills: item.turnSkills.map((skill) => ({
            ...skill,
            resources: skill.resources.map((resource) => ({ ...resource })),
          })),
        }
      : {}),
    ...(item.localFileAttachments
      ? { localFileAttachments: item.localFileAttachments.map((attachment) => ({ ...attachment })) }
      : {}),
    ...spreadChipNavigateMeta(item.chipNavigateMeta),
  }));
}

/** Runtime message projection sanitization; see chat-schema.ts for the chat schema v2 persistence boundary. */
export function sanitizeConversationMessagesForPersistence(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return messages.flatMap((message) => {
    const tool = normalizeToolBlockSnapshot(message.tool);
    const aux = normalizeMessageAuxSnapshot(message.aux);
    const normalized: ConversationMessageSnapshot = {
      ...message,
      ...(tool ? { tool } : {}),
      ...(aux ? { aux } : {}),
    };
    if (
      shouldDropEmptyAssistantMessage(normalized, tool, aux) ||
      shouldHideEmptyPendingAssistantSnapshot(normalized)
    ) {
      return [];
    }
    const { canRewind: _canRewind, ...persisted } = normalized;
    return [persisted];
  });
}

/** Minimal llm history for runtime recovery when the on-disk llmHistory is empty but desktop messages already contain turns. */
export function buildLlmHistoryFallbackFromDesktopMessages(
  messages: ConversationMessageSnapshot[],
): ChatArchive["llmHistory"] {
  const projectable = archiveProjectableConversationMessages(messages);
  const fallback = projectable
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        !(message.role === "assistant" && isManualCompactionUiStatusText(message.content)),
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [],
    }));

  return fallback;
}

export function buildArchiveMessagesFromConversation(
  messages: ConversationMessageSnapshot[],
): ChatArchive["messages"] {
  return archiveProjectableConversationMessages(messages).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function buildArchiveAssistantAuxFromConversation(
  messages: ConversationMessageSnapshot[],
): ChatArchive["assistantAux"] {
  return archiveProjectableConversationMessages(messages).flatMap((message, index) => {
    if (!message.aux) {
      return [];
    }
    return [
      {
        messageIndex: index,
        ...(message.aux.thinking ? { thinking: message.aux.thinking } : {}),
        ...(message.aux.compaction ? { compaction: message.aux.compaction } : {}),
        ...(message.aux.finishTaskNotice ? { finishTaskNotice: message.aux.finishTaskNotice } : {}),
      },
    ];
  });
}

/** Runtime archive projection from a persisted v2 timeline snapshot. */
export function buildChatArchiveFromTimeline(
  timeline: DesktopTimelineTurnSnapshot[],
): Pick<ChatArchive, "messages" | "assistantAux"> {
  const messages = timelineRuntimeSnapshotToMessages(timeline);
  return {
    messages: buildArchiveMessagesFromConversation(messages),
    assistantAux: buildArchiveAssistantAuxFromConversation(messages),
  };
}

export function nextMessageIdFromMessages(messages: ConversationMessageSnapshot[]): number {
  return Math.max(0, ...messages.map((message) => message.id)) + 1;
}

export function restoreMessagesFromArchive(
  archive: StoredDesktopSession,
): ConversationMessageSnapshot[] {
  return timelinePersistedSnapshotToMessages(archive.desktopMessageTimeline);
}

export function deriveDisplayNameFromSeed(seed: string): string {
  const trimmed = seed.trim();
  if (!trimmed) {
    return "New conversation";
  }
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

export function deriveDisplayNameFromMessages(messages: ConversationMessageSnapshot[]): string {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  return deriveDisplayNameFromSeed(firstUser?.content ?? "New conversation");
}

function cloneConversationMessages(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return messages.map((message) => ({ ...message }));
}

function cloneSubagentTimelinesRecord(
  record: Record<string, PersistedDesktopTimelineTurnSnapshot[]>,
): Map<string, ConversationMessageSnapshot[]> {
  const next = new Map<string, ConversationMessageSnapshot[]>();
  for (const [sessionId, timeline] of Object.entries(record)) {
    next.set(sessionId, timelinePersistedSnapshotToMessages(timeline));
  }
  return next;
}

export function serializeSubagentTimelinesFromMessages(
  record: Map<string, ConversationMessageSnapshot[]>,
): Record<string, PersistedDesktopTimelineTurnSnapshot[]> | undefined {
  if (record.size === 0) {
    return undefined;
  }
  const serialized: Record<string, PersistedDesktopTimelineTurnSnapshot[]> = {};
  for (const [sessionId, messages] of record.entries()) {
    if (messages.length === 0) {
      continue;
    }
    let nextMessageId = 1;
    const timeline = DesktopMessageTimeline.fromMessages(messages, {
      allocateMessageId: () => nextMessageId++,
      reserveMessageId: (messageId) => {
        if (messageId >= nextMessageId) {
          nextMessageId = messageId + 1;
        }
      },
    });
    const persisted = normalizeTimelineSnapshotForPersistence(timeline.snapshot());
    if (persisted.length > 0) {
      serialized[sessionId] = persisted;
    }
  }
  return Object.keys(serialized).length > 0 ? serialized : undefined;
}

function archiveProjectableConversationMessages(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return sanitizeConversationMessagesForPersistence(messages).filter(
    (message) => !message.tool || message.content.trim().length > 0,
  );
}

function cloneSubagentSessions(
  sessions: NonNullable<ChatArchive["subagentSessions"]>,
): NonNullable<ChatArchive["subagentSessions"]> {
  return cloneArchiveSubagentSessions(sessions);
}

type SessionListActivity = Pick<SessionListItem, "isBusy" | "isBlocked">;

/** Map in-memory bundle runtime to session list activity flags. */
export function sessionListActivityFromBundle(bundle?: SessionBundle): SessionListActivity {
  if (!isSessionBundleBusy(bundle)) {
    return {};
  }
  const runtime = bundle?.runtime;
  if (runtime?.hasPendingApproval() || runtime?.hasPendingQuestions()) {
    return { isBusy: true, isBlocked: true };
  }
  return { isBusy: true };
}
