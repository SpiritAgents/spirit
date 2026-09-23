import { readFile } from "node:fs/promises";
import path from "node:path";

import i18n from "../lib/i18n-host.js";
import type { DesktopSnapshot } from "../types.js";
import { deleteSessionRewindData } from "./rewind.js";
import { deleteDesktopTranscriptSessionDirForChatPath } from "./transcript-session.js";
import {
  ensureStoredSessionBundleRegistered,
  finishSessionActivationCommand,
  type SessionActivationContext,
} from "./session-activation.js";
import type { SessionBundle } from "./session-bundle.js";
import { sameSessionPath } from "./session-path.js";
import type { SessionSplitHostContext } from "./session-split.js";
import { isEphemeralDebugSessionPath } from "./sessions.js";
import { deleteStoredSession, isSplitProvisionalSessionPath, spiritDataDir } from "./storage.js";

export interface SessionDeleteContext
  extends
    SessionActivationContext,
    Pick<SessionSplitHostContext, "visiblePaneSessionPaths" | "setVisiblePaneSessionPaths"> {
  removeEphemeralSession(filePath: string): void;
  bundleRuntimeIsBusy(sessionPath: string): boolean;
  disposeSessionRuntime(bundle: SessionBundle): Promise<void>;
}

/** Reads the rewind sessionId before deleting the session file, for linked cleanup of the rewind sidecar directory. */
async function readRewindSessionIdFromDisk(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { rewind?: { sessionId?: unknown } };
    const sessionId = parsed.rewind?.sessionId;
    return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function deleteSessionCommand(
  ctx: SessionDeleteContext,
  filePath: string,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const trimmed = filePath.trim();
    if (!trimmed) {
      throw new Error(i18n.t("error.invalidSessionPath"));
    }

    const resolvedPath = path.resolve(trimmed);
    if (ctx.bundleRuntimeIsBusy(resolvedPath)) {
      throw new Error(i18n.t("error.cannotDeleteBusyChat"));
    }

    const state = ctx.requireState();
    const registry = ctx.sessionRegistry();
    const activeId = registry.activeSessionId();
    const wasActive = activeId !== undefined && sameSessionPath(activeId, resolvedPath);
    const closingBundle = wasActive ? registry.getActive() : undefined;

    if (closingBundle) {
      await ctx.runSessionEndForBundle?.(closingBundle, "close");
    }

    const visiblePaths = ctx.visiblePaneSessionPaths();
    const deletedFromMultiPane =
      visiblePaths.length > 1 && visiblePaths.some((entry) => sameSessionPath(entry, resolvedPath));
    const nextVisible = deletedFromMultiPane
      ? visiblePaths.filter((entry) => !sameSessionPath(entry, resolvedPath))
      : visiblePaths;
    const needsSuccessor = wasActive || !registry.hasActive();

    // Preload the successor: finish the disk load before removing the old bundle,
    // so that "remove old bundle → establish new active" below completes atomically and synchronously,
    // avoiding a dangling activeId across an await (the throttled snapshot timer firing in the await gap would crash in requireActive).
    let successor: SessionBundle | undefined;
    if (needsSuccessor && deletedFromMultiPane) {
      for (const sessionPath of nextVisible) {
        let candidate = registry.findBySessionPath(sessionPath);
        if (!candidate && !isSplitProvisionalSessionPath(sessionPath)) {
          try {
            candidate = (await ensureStoredSessionBundleRegistered(ctx, sessionPath)) ?? undefined;
          } catch {
            // the persisted layout may reference a deleted session file
          }
        }
        if (candidate) {
          successor = candidate;
          break;
        }
      }
    }

    // —— atomic section start: remove the old bundle and synchronously establish the new active; no await allowed in between ——
    const removedBundle = registry.removeBySessionPath(resolvedPath);
    if (deletedFromMultiPane) {
      ctx.setVisiblePaneSessionPaths(nextVisible);
    }
    let newActive: SessionBundle | undefined;
    let newActiveIsFreshDraft = false;
    if (needsSuccessor) {
      ctx.clearSubagentViewerTarget();
      if (deletedFromMultiPane && successor) {
        newActive = registry.activateExisting(successor);
      } else if (deletedFromMultiPane) {
        newActive = registry.ensureDraft(state.workspaceRoot);
      } else {
        newActive = registry.beginNewActive(state.workspaceRoot);
        newActiveIsFreshDraft = true;
      }
      ctx.syncActiveRuntimePointer();
    }
    // —— atomic section end: activeId is valid again; safe to cross awaits ——

    if (newActive) {
      if (newActiveIsFreshDraft) {
        await ctx.finalizeTodoScopeForNewActiveBundle(newActive, state.workspaceRoot);
        ctx.resetStreamingPlacementState(true, newActive);
      }
      await finishSessionActivationCommand(ctx, newActive);
    }
    if (removedBundle) {
      await ctx.disposeSessionRuntime(removedBundle);
    }

    let rewindSessionId = removedBundle?.rewind.sessionId;
    if (isEphemeralDebugSessionPath(resolvedPath)) {
      ctx.removeEphemeralSession(resolvedPath);
    } else {
      if (!rewindSessionId) {
        rewindSessionId = await readRewindSessionIdFromDisk(resolvedPath);
      }
      await deleteStoredSession(resolvedPath);
    }
    if (rewindSessionId) {
      await deleteSessionRewindData(spiritDataDir(), rewindSessionId);
    }
    await deleteDesktopTranscriptSessionDirForChatPath(resolvedPath);

    ctx.setLastRuntimeError("");
    return ctx.buildSnapshot();
  });
}
