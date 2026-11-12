import path from "node:path";

import type { ChatArchive } from "@spiritagent/agent-core";

import i18n from "../lib/i18n-host.js";
import type {
  BeginSideChatPaneSessionRequest,
  BeginSideChatPaneSessionResponse,
  DesktopSnapshot,
  ForkSessionIntoSideChatRequest,
} from "../types.js";
import type { DesktopHostRuntime } from "./runtime.js";
import type { SessionBundle } from "./session-bundle.js";
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  sanitizeConversationMessagesForPersistence,
} from "./sessions.js";
import { cloneHostTodoRecords, listSessionTodos, replaceSessionTodos } from "./todos.js";
import {
  buildTruncatedChatArchiveForFork,
  resolveForkAnchorIndex,
  truncateMessagesThroughIndex,
} from "./fork-session.js";
import { populateForkedBundleFromSource } from "./fork-session-host.js";
import type { SessionSplitHostContext } from "./session-split.js";
import { sideChatPaneSessionPath } from "./storage.js";

export interface SideChatSessionHostContext extends SessionSplitHostContext {
  requireRuntime(): DesktopHostRuntime;
  currentRuntime(): DesktopHostRuntime | undefined;
  isBundleConversationBusy(bundle: SessionBundle): boolean;
  isBundleReadOnly(bundle: SessionBundle): boolean;
}

function buildSourceArchiveForFork(
  sourceBundle: SessionBundle,
  ctx: SideChatSessionHostContext,
): ChatArchive {
  const sourceMessages = sourceBundle.messageTimeline.toMessages();
  const archiveMessages = buildArchiveMessagesFromConversation(sourceMessages);
  const archiveAssistantAux = buildArchiveAssistantAuxFromConversation(sourceMessages);
  const runtime =
    sourceBundle.runtime ??
    (ctx.sessionRegistry().getActive() === sourceBundle ? ctx.currentRuntime() : undefined);
  if (runtime) {
    const archive = runtime.toArchive(archiveMessages, archiveAssistantAux);
    archive.loopEnabled = sourceBundle.loopEnabled;
    return archive;
  }
  return {
    messages: archiveMessages,
    assistantAux: archiveAssistantAux,
    llmHistory: sourceBundle.archiveHistory,
    subagentSessions: sourceBundle.archiveSubagentSessions ?? [],
    loopEnabled: sourceBundle.loopEnabled,
  };
}

export async function beginSideChatPaneSessionCommand(
  ctx: SessionSplitHostContext,
  request: BeginSideChatPaneSessionRequest,
): Promise<BeginSideChatPaneSessionResponse> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const paneId = request.paneId.trim();
    if (!paneId) {
      throw new Error("Side-chat pane id is required.");
    }

    const state = ctx.requireState();
    const sessionPath = path.resolve(sideChatPaneSessionPath(paneId));
    const registry = ctx.sessionRegistry();
    registry.beginSideChatPaneSession(state.workspaceRoot, paneId);
    const sideChatBundle = registry.findBySessionPath(sessionPath);
    if (sideChatBundle) {
      sideChatBundle.activeModel = state.config.activeModel;
    }
    await ctx.finalizeTodoScopeForNewActiveBundle(
      registry.findBySessionPath(sessionPath)!,
      state.workspaceRoot,
    );
    return { sessionPath };
  });
}

export async function forkSessionIntoSideChatCommand(
  ctx: SideChatSessionHostContext,
  request: ForkSessionIntoSideChatRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    ctx.clearSubagentViewerTarget();

    const sourceSessionPath = path.resolve(request.sourceSessionPath.trim());
    const targetPaneId = request.targetPaneId.trim();
    if (!sourceSessionPath || !targetPaneId) {
      throw new Error(i18n.t("error.hostNotInitialized"));
    }
    if (!Number.isFinite(request.messageId)) {
      throw new Error(i18n.t("error.invalidMessageId"));
    }

    const registry = ctx.sessionRegistry();
    const sourceBundle = registry.findBySessionPath(sourceSessionPath);
    if (!sourceBundle?.activeSession) {
      throw new Error(i18n.t("error.hostNotInitialized"));
    }
    if (ctx.isBundleReadOnly(sourceBundle)) {
      throw new Error(i18n.t("error.forkReadOnlySession"));
    }
    if (ctx.isBundleConversationBusy(sourceBundle)) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const targetSessionPath = path.resolve(sideChatPaneSessionPath(targetPaneId));
    const targetBundle = registry.findBySessionPath(targetSessionPath);
    if (!targetBundle) {
      throw new Error("Side-chat session not found.");
    }

    const sourceMessages = sourceBundle.messageTimeline.toMessages();
    const anchorIndex = resolveForkAnchorIndex(
      sourceMessages,
      request.messageId,
      request.listIndex,
    );
    if (anchorIndex === null) {
      throw new Error(i18n.t("error.forkInvalidAnchor"));
    }

    const truncatedMessages = truncateMessagesThroughIndex(sourceMessages, anchorIndex);
    if (truncatedMessages.length === 0) {
      throw new Error(i18n.t("error.forkInvalidAnchor"));
    }

    const sourceMessageCount = sourceMessages.length;
    if (sourceBundle.activeSession && sourceMessageCount > 0) {
      await ctx.runSessionEndForBundle?.(sourceBundle, "switch");
      await ctx.persistSessionBundle(sourceBundle, {
        fromRuntime:
          registry.activeSessionId() === sourceBundle.id
            ? ctx.currentRuntime()
            : sourceBundle.runtime,
        bumpListSortAt: false,
      });
    }

    const sourceArchive = buildSourceArchiveForFork(sourceBundle, ctx);
    const archive = buildTruncatedChatArchiveForFork(sourceArchive, sourceMessages, anchorIndex);
    const sideChatDisplayName = sourceBundle.activeSession.displayName.trim();
    const state = ctx.requireState();

    populateForkedBundleFromSource(
      targetBundle,
      {
        workspaceRoot: state.workspaceRoot,
        filePath: targetSessionPath,
        displayName: sideChatDisplayName,
        truncatedMessages: sanitizeConversationMessagesForPersistence(truncatedMessages).map(
          (message) => ({ ...message }),
        ),
        archive,
        sourceBundle,
      },
      ctx,
    );

    await ctx.finalizeTodoScopeForNewActiveBundle(targetBundle, state.workspaceRoot);
    const sourceTodoKey = ctx.resolveTodoSessionKeyForBundle(sourceBundle);
    const forkTodoKey = ctx.resolveTodoSessionKeyForBundle(targetBundle);
    const sourceTodos = cloneHostTodoRecords(await listSessionTodos(sourceTodoKey));
    await replaceSessionTodos(forkTodoKey, sourceTodos);

    await ctx.persistSessionBundle(targetBundle, {
      fromRuntime: targetBundle.runtime,
      bumpListSortAt: false,
    });

    ctx.setLastRuntimeError("");
    return ctx.buildSnapshot();
  });
}
