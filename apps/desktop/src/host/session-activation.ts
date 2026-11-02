import path from "node:path";

import { resolveEffectivePaneActiveModel } from "./active-model-sync.js";

import type { SessionEndHookInput, SessionStartHookInput } from "@spiritagent/agent-core";

import { resolveDesktopAgentMode } from "@spiritagent/ui/composer";
import i18n from "../lib/i18n-host.js";
import type { ConversationMessageSnapshot, DesktopGitSnapshot, DesktopSnapshot } from "../types.js";
import type { DesktopHostRuntime } from "./runtime.js";
import type { SessionBundle } from "./session-bundle.js";
import type { SessionRegistry } from "./session-registry.js";
import {
  loadStoredSession,
  isProvisionalSessionPath,
  isSideChatProvisionalSessionPath,
  isSplitProvisionalSessionPath,
  parseSideChatPaneIdFromSessionPath,
  parseSplitPaneIdFromSessionPath,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
} from "./storage.js";
import {
  isEphemeralDebugSessionPath,
  restoreEphemeralSessionState,
  restoreStoredSessionState,
  type EphemeralSessionRecord,
} from "./sessions.js";
import type { DesktopTimelineTurnSnapshot, DesktopMessageTimeline } from "./message-timeline.js";
import { basicInfoHostFromClientHost, currentApiBase, sameWorkspaceRoot } from "./service-utils.js";
import type { HostExtensionEvent } from "@spiritagent/host-internal";
import { cancelPendingWorktreeBootstrapOnBundle } from "./worktree-bootstrap-orchestrator.js";
import { resolveStoredSessionWorkspaceRoot } from "./resolve-session-workspace-root.js";

interface ActivationState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
}

export interface SessionActivationContext {
  runSerialized<T>(work: () => Promise<T>, label?: string): Promise<T>;
  ensureInitialized(
    workspaceRootOverride?: string,
    options?: {
      fastPath?: boolean;
      preserveRecentWorkspaces?: boolean;
      deferRuntimeRefresh?: boolean;
    },
  ): Promise<void>;
  requireState(): ActivationState;
  isInitialized(): boolean;
  currentWorkspaceRoot(): string | undefined;
  currentRuntime(): DesktopHostRuntime | undefined;
  sessionRegistry(): SessionRegistry;
  persistSessionBundle(
    bundle: SessionBundle,
    options: { fromRuntime?: DesktopHostRuntime; bumpListSortAt?: boolean },
  ): Promise<void>;
  finalizeTodoScopeForNewActiveBundle(bundle: SessionBundle, workspaceRoot: string): Promise<void>;
  resetStreamingPlacementState(full: boolean, bundle: SessionBundle): void;
  findEphemeralSession(filePath: string): EphemeralSessionRecord | undefined;
  createMessageTimelineFromMessages(
    messages: ConversationMessageSnapshot[],
    timelineSnapshot?: DesktopTimelineTurnSnapshot[],
  ): DesktopMessageTimeline;
  syncPlanStateForBundle(bundle: SessionBundle): Promise<void>;
  syncHostWorkspaceRootToActiveBundle(bundle: SessionBundle): Promise<boolean>;
  syncHostActiveModelToActiveBundle(bundle: SessionBundle): Promise<boolean>;
  tickSession(bundle: SessionBundle): Promise<void>;
  syncActiveRuntimePointer(): void;
  refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void>;
  flushDeferredRuntimeRefreshIfIdle(bundle?: SessionBundle): Promise<void>;
  ensureToolExecutor(bundle: SessionBundle): Promise<unknown>;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  resolveTodoSessionKeyForBundle(bundle: SessionBundle): string;
  setLastRuntimeError(error: string): void;
  scheduleSessionExtensionWarmup(event: HostExtensionEvent): void;
  buildSnapshot(): DesktopSnapshot;
  buildSnapshotProjectedForBundle(bundle: SessionBundle): DesktopSnapshot;
  clearSubagentViewerTarget(): void;
  runSessionEndForBundle?(
    bundle: SessionBundle,
    reason: SessionEndHookInput["reason"],
  ): Promise<void>;
  runSessionStartForBundle?(
    bundle: SessionBundle,
    source: SessionStartHookInput["source"],
  ): Promise<void>;
}

/** Register a stored chat session in the registry without foreground activation side effects. */
export async function ensureStoredSessionBundleRegistered(
  ctx: SessionActivationContext,
  filePath: string,
): Promise<SessionBundle | null> {
  const resolvedPath = path.resolve(filePath);
  const existing = ctx.sessionRegistry().findBySessionPath(resolvedPath);
  if (existing) {
    return existing;
  }

  if (isEphemeralDebugSessionPath(filePath)) {
    return null;
  }
  if (isSplitProvisionalSessionPath(resolvedPath)) {
    return null;
  }
  if (isProvisionalSessionPath(resolvedPath) && !isSideChatProvisionalSessionPath(resolvedPath)) {
    return null;
  }

  const loaded = await loadStoredSession(filePath);
  const workspaceRoot = loaded.workspaceRoot
    ? await resolveStoredSessionWorkspaceRoot({
        workspaceRoot: loaded.workspaceRoot,
        gitBranch: loaded.gitBranch,
      })
    : ctx.requireState().workspaceRoot;
  const sameWorkspace =
    ctx.isInitialized() &&
    Boolean(ctx.currentWorkspaceRoot()) &&
    sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, workspaceRoot);
  await ctx.ensureInitialized(workspaceRoot, {
    ...(sameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
    preserveRecentWorkspaces: true,
  });
  const restored = restoreStoredSessionState({
    filePath,
    loaded,
  });
  const bundle = ctx
    .sessionRegistry()
    .upsertFromRestored(workspaceRoot, restored, (messages, timelineSnapshot) =>
      ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
    );
  bundle.listSortSavedAtUnixMs = loaded.savedAtUnixMs;
  return bundle;
}

export async function resetSessionCommand(ctx: SessionActivationContext): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    ctx.clearSubagentViewerTarget();

    const state = ctx.requireState();
    const leaving = ctx.sessionRegistry().getActive();
    const leavingMessageCount = leaving?.messageTimeline.toMessages().length ?? 0;
    if (leaving?.activeSession && leavingMessageCount > 0) {
      await ctx.runSessionEndForBundle?.(leaving, "switch");
      await ctx.persistSessionBundle(leaving, {
        fromRuntime:
          ctx.sessionRegistry().activeSessionId() === leaving.id ? ctx.currentRuntime() : undefined,
        bumpListSortAt: false,
      });
    }
    const bundle = ctx.sessionRegistry().beginNewActive(state.workspaceRoot);
    ctx.syncActiveRuntimePointer();
    await ctx.finalizeTodoScopeForNewActiveBundle(bundle, state.workspaceRoot);
    ctx.resetStreamingPlacementState(true, bundle);
    await finishSessionActivationCommand(ctx, bundle, { sessionStartSource: "startup" });
    ctx.setLastRuntimeError("");
    ctx.scheduleSessionExtensionWarmup({
      type: "onSessionReset",
      detail: {
        workspaceRoot: state.workspaceRoot,
      },
    });
    return ctx.buildSnapshot();
  });
}

export async function openSessionCommand(
  ctx: SessionActivationContext,
  filePath: string,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    ctx.clearSubagentViewerTarget();

    const leaving = ctx.sessionRegistry().getActive();
    const leavingMessageCount = leaving?.messageTimeline.toMessages().length ?? 0;
    if (
      leaving?.activeSession &&
      leaving.activeSession.kind !== "ephemeral" &&
      leavingMessageCount > 0
    ) {
      cancelPendingWorktreeBootstrapOnBundle(leaving);
      await ctx.runSessionEndForBundle?.(leaving, "switch");
      await ctx.persistSessionBundle(leaving, {
        fromRuntime:
          leaving.runtime?.isBusy() && ctx.sessionRegistry().activeSessionId() === leaving.id
            ? ctx.currentRuntime()
            : undefined,
        bumpListSortAt: false,
      });
    }

    if (isEphemeralDebugSessionPath(filePath)) {
      const ephemeral = ctx.findEphemeralSession(filePath);
      if (!ephemeral) {
        throw new Error(i18n.t("error.ephemeralSessionExpired"));
      }
      const ephemeralSameWorkspace = Boolean(
        ctx.isInitialized() &&
        ctx.currentWorkspaceRoot() &&
        sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, ephemeral.workspaceRoot),
      );
      await ctx.ensureInitialized(ephemeral.workspaceRoot, {
        preserveRecentWorkspaces: true,
        ...(ephemeralSameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
      });
      const restored = restoreEphemeralSessionState(ephemeral);
      const bundle = ctx
        .sessionRegistry()
        .upsertFromRestored(ephemeral.workspaceRoot, restored, (messages, timelineSnapshot) =>
          ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
        );
      await finishSessionActivationCommand(ctx, bundle, { sessionStartSource: "open" });
      ctx.setLastRuntimeError("");
      return ctx.buildSnapshot();
    }

    const resolvedPath = path.resolve(filePath);
    const warmBundle = ctx.sessionRegistry().findBySessionPath(resolvedPath);
    const warmMessageCount = warmBundle?.messageTimeline.toMessages().length ?? 0;
    if (warmBundle?.activeSession && warmMessageCount > 0) {
      await ctx.ensureInitialized(warmBundle.workspaceRoot, { fastPath: true });
      ctx.sessionRegistry().activateExisting(warmBundle);
      await finishSessionActivationCommand(ctx, warmBundle, { sessionStartSource: "resume" });
      ctx.setLastRuntimeError("");
      ctx.scheduleSessionExtensionWarmup({
        type: "onSessionOpened",
        detail: {
          filePath: resolvedPath,
          displayName: warmBundle.activeSession.displayName,
        },
      });
      return ctx.buildSnapshot();
    }

    if (
      warmBundle?.activeSession &&
      (isProvisionalSessionPath(resolvedPath) || isSplitProvisionalSessionPath(resolvedPath)) &&
      !isSideChatProvisionalSessionPath(resolvedPath)
    ) {
      await ctx.ensureInitialized(warmBundle.workspaceRoot, { fastPath: true });
      ctx.sessionRegistry().activateExisting(warmBundle);
      await finishSessionActivationCommand(ctx, warmBundle, { sessionStartSource: "open" });
      ctx.setLastRuntimeError("");
      return ctx.buildSnapshot();
    }

    if (isSplitProvisionalSessionPath(resolvedPath)) {
      const paneId = parseSplitPaneIdFromSessionPath(resolvedPath);
      if (paneId) {
        await ctx.ensureInitialized(undefined, { fastPath: true });
        const state = ctx.requireState();
        const bundle = ctx.sessionRegistry().beginSplitPaneSession(state.workspaceRoot, paneId);
        ctx.sessionRegistry().activateExisting(bundle);
        await finishSessionActivationCommand(ctx, bundle, { sessionStartSource: "open" });
        ctx.setLastRuntimeError("");
        return ctx.buildSnapshot();
      }
    }

    if (isSideChatProvisionalSessionPath(resolvedPath)) {
      const paneId = parseSideChatPaneIdFromSessionPath(resolvedPath);
      if (paneId) {
        await ctx.ensureInitialized(undefined, { fastPath: true });
        const state = ctx.requireState();
        let bundle = ctx.sessionRegistry().findBySessionPath(resolvedPath);
        if (!bundle) {
          try {
            bundle = (await ensureStoredSessionBundleRegistered(ctx, resolvedPath)) ?? undefined;
          } catch {
            bundle = undefined;
          }
        }
        if (!bundle) {
          bundle = ctx.sessionRegistry().beginSideChatPaneSession(state.workspaceRoot, paneId);
        }
        ctx.sessionRegistry().activateExisting(bundle);
        await finishSessionActivationCommand(ctx, bundle, { sessionStartSource: "open" });
        ctx.setLastRuntimeError("");
        return ctx.buildSnapshot();
      }
    }

    const loaded = await loadStoredSession(filePath);
    const workspaceRoot = loaded.workspaceRoot
      ? await resolveStoredSessionWorkspaceRoot({
          workspaceRoot: loaded.workspaceRoot,
          gitBranch: loaded.gitBranch,
        })
      : ctx.requireState().workspaceRoot;
    const sameWorkspace =
      ctx.isInitialized() &&
      Boolean(ctx.currentWorkspaceRoot()) &&
      sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, workspaceRoot);
    await ctx.ensureInitialized(workspaceRoot, {
      ...(sameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
      preserveRecentWorkspaces: true,
    });
    const restored = restoreStoredSessionState({
      filePath,
      loaded,
    });
    const bundle = ctx
      .sessionRegistry()
      .upsertFromRestored(workspaceRoot, restored, (messages, timelineSnapshot) =>
        ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
      );
    bundle.listSortSavedAtUnixMs = loaded.savedAtUnixMs;
    const sessionStartSource: SessionStartHookInput["source"] =
      restored.messages.length > 0 || restored.archiveHistory.length > 0 ? "resume" : "open";
    await finishSessionActivationCommand(ctx, bundle, { sessionStartSource });
    ctx.setLastRuntimeError("");
    ctx.scheduleSessionExtensionWarmup({
      type: "onSessionOpened",
      detail: {
        filePath: path.resolve(filePath),
        displayName: bundle.activeSession!.displayName,
      },
    });
    return ctx.buildSnapshot();
  });
}

/** Load or warm a session bundle without changing host foreground activation (remote web open). */
async function registerSessionBundleForOpen(
  ctx: SessionActivationContext,
  filePath: string,
): Promise<SessionBundle> {
  if (isEphemeralDebugSessionPath(filePath)) {
    const ephemeral = ctx.findEphemeralSession(filePath);
    if (!ephemeral) {
      throw new Error(i18n.t("error.ephemeralSessionExpired"));
    }
    const ephemeralSameWorkspace = Boolean(
      ctx.isInitialized() &&
      ctx.currentWorkspaceRoot() &&
      sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, ephemeral.workspaceRoot),
    );
    await ctx.ensureInitialized(ephemeral.workspaceRoot, {
      preserveRecentWorkspaces: true,
      ...(ephemeralSameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
    });
    const restored = restoreEphemeralSessionState(ephemeral);
    return ctx
      .sessionRegistry()
      .upsertFromRestored(ephemeral.workspaceRoot, restored, (messages, timelineSnapshot) =>
        ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
      );
  }

  const resolvedPath = path.resolve(filePath);
  const warmBundle = ctx.sessionRegistry().findBySessionPath(resolvedPath);
  if (warmBundle?.activeSession) {
    await ctx.ensureInitialized(warmBundle.workspaceRoot, { fastPath: true });
    return warmBundle;
  }

  if (isSplitProvisionalSessionPath(resolvedPath)) {
    const paneId = parseSplitPaneIdFromSessionPath(resolvedPath);
    if (paneId) {
      await ctx.ensureInitialized(undefined, { fastPath: true });
      const state = ctx.requireState();
      return ctx.sessionRegistry().beginSplitPaneSession(state.workspaceRoot, paneId);
    }
  }

  if (isSideChatProvisionalSessionPath(resolvedPath)) {
    const paneId = parseSideChatPaneIdFromSessionPath(resolvedPath);
    if (paneId) {
      await ctx.ensureInitialized(undefined, { fastPath: true });
      const state = ctx.requireState();
      const existing = ctx.sessionRegistry().findBySessionPath(resolvedPath);
      if (existing) {
        return existing;
      }
      try {
        const loaded = await ensureStoredSessionBundleRegistered(ctx, resolvedPath);
        if (loaded) {
          return loaded;
        }
      } catch {
        // Fall through to empty side-chat slot.
      }
      return ctx.sessionRegistry().beginSideChatPaneSession(state.workspaceRoot, paneId);
    }
  }

  const loaded = await loadStoredSession(filePath);
  const workspaceRoot = loaded.workspaceRoot
    ? await resolveStoredSessionWorkspaceRoot({
        workspaceRoot: loaded.workspaceRoot,
        gitBranch: loaded.gitBranch,
      })
    : ctx.requireState().workspaceRoot;
  const sameWorkspace =
    ctx.isInitialized() &&
    Boolean(ctx.currentWorkspaceRoot()) &&
    sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, workspaceRoot);
  await ctx.ensureInitialized(workspaceRoot, {
    ...(sameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
    preserveRecentWorkspaces: true,
  });
  const restored = restoreStoredSessionState({
    filePath,
    loaded,
  });
  const bundle = ctx
    .sessionRegistry()
    .upsertFromRestored(workspaceRoot, restored, (messages, timelineSnapshot) =>
      ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
    );
  bundle.listSortSavedAtUnixMs = loaded.savedAtUnixMs;
  return bundle;
}

export async function openSessionBackgroundCommand(
  ctx: SessionActivationContext,
  filePath: string,
  options?: { clientHost?: import("../types.js").DesktopClientHost },
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    const bundle = await registerSessionBundleForOpen(ctx, filePath);
    const basicInfoHost = basicInfoHostFromClientHost(options?.clientHost);
    if (basicInfoHost) {
      bundle.basicInfoHost = basicInfoHost;
    }
    ctx.setLastRuntimeError("");
    return ctx.buildSnapshotProjectedForBundle(bundle);
  });
}

/** Create a new empty session for remote web without changing host foreground activation. */
export async function resetSessionBackgroundCommand(
  ctx: SessionActivationContext,
  options?: { clientHost?: import("../types.js").DesktopClientHost },
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    ctx.clearSubagentViewerTarget();
    const state = ctx.requireState();
    const bundle = ctx.sessionRegistry().beginNewBackground(state.workspaceRoot);
    const basicInfoHost = basicInfoHostFromClientHost(options?.clientHost);
    if (basicInfoHost) {
      bundle.basicInfoHost = basicInfoHost;
    }
    await ctx.finalizeTodoScopeForNewActiveBundle(bundle, state.workspaceRoot);
    ctx.setLastRuntimeError("");
    return ctx.buildSnapshotProjectedForBundle(bundle);
  });
}

export function runtimeActivationSignature(
  ctx: SessionActivationContext,
  bundle: SessionBundle,
): string {
  const state = ctx.requireState();
  return JSON.stringify({
    model: resolveEffectivePaneActiveModel(bundle, state),
    imageModel: state.config.imageGenerationModel ?? "",
    apiBase: currentApiBase(state.config),
    workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
    agentMode: resolveDesktopAgentMode(state.config),
    approvalLevel: bundle.approvalLevel,
    loopEnabled: bundle.loopEnabled,
    todoSessionKey: ctx.resolveTodoSessionKeyForBundle(bundle),
  });
}

export function isBundleRuntimeFresh(
  ctx: SessionActivationContext,
  bundle: SessionBundle,
): boolean {
  if (!bundle.runtime || bundle.runtime.isBusy() || !bundle.runtimeTransport) {
    return false;
  }
  if (!bundle.runtimeActivationSignature) {
    return false;
  }
  return bundle.runtimeActivationSignature === runtimeActivationSignature(ctx, bundle);
}

/** After registry switch: wire runtime for new loads, resume in-flight runs without resetting timeline. */
export async function finishSessionActivationCommand(
  ctx: SessionActivationContext,
  bundle: SessionBundle,
  options?: { sessionStartSource?: SessionStartHookInput["source"] },
): Promise<void> {
  const adoptedWorkspaceRoot = await ctx.syncHostWorkspaceRootToActiveBundle(bundle);
  if (!adoptedWorkspaceRoot) {
    await ctx.syncPlanStateForBundle(bundle);
  }
  await ctx.syncHostActiveModelToActiveBundle(bundle);
  if (bundle.runtime?.isBusy()) {
    await ctx.tickSession(bundle);
    ctx.syncActiveRuntimePointer();
    return;
  }
  ctx.resetStreamingPlacementState(true, bundle);
  if (isBundleRuntimeFresh(ctx, bundle)) {
    await ctx.refreshTodoSnapshotForBundle(bundle);
    await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
    ctx.syncActiveRuntimePointer();
    if (options?.sessionStartSource) {
      await ctx.runSessionStartForBundle?.(bundle, options.sessionStartSource);
    }
    return;
  }
  await ctx.refreshTodoSnapshotForBundle(bundle);
  await ctx.refreshRuntimeForBundle(bundle);
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  ctx.syncActiveRuntimePointer();
  if (options?.sessionStartSource) {
    await ctx.runSessionStartForBundle?.(bundle, options.sessionStartSource);
  }
}
