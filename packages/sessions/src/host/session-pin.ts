import path from "node:path";

import i18n from "../lib/i18n-host.js";
import type { DesktopSnapshot } from "../types.js";
import type { SessionActivationContext } from "./session-activation.js";
import { loadStoredSession, saveStoredSession } from "./storage.js";

function sameSessionPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export interface SessionPinContext extends SessionActivationContext {
  notifySessionListUpdated(): void;
  emitLiveSnapshotUpdate(): void;
}

export async function setSessionPinnedCommand(
  ctx: SessionPinContext,
  filePath: string,
  pinned: boolean,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const trimmedPath = filePath.trim();
    if (!trimmedPath) {
      throw new Error(i18n.t("error.invalidSessionPath"));
    }

    const resolvedPath = path.resolve(trimmedPath);
    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(resolvedPath);
    const activeId = registry.activeSessionId();
    const isActiveSession = activeId !== undefined && sameSessionPath(activeId, resolvedPath);

    if (bundle?.activeSession && path.resolve(bundle.activeSession.filePath) === resolvedPath) {
      if (pinned) {
        bundle.pinnedAtUnixMs = Date.now();
      } else {
        bundle.pinnedAtUnixMs = undefined;
      }
      await ctx.persistSessionBundle(bundle, {
        fromRuntime: bundle.runtime,
        bumpListSortAt: false,
      });
      if (isActiveSession) {
        ctx.emitLiveSnapshotUpdate();
      } else {
        ctx.notifySessionListUpdated();
      }
      ctx.setLastRuntimeError("");
      return ctx.buildSnapshot();
    }

    const stored = await loadStoredSession(resolvedPath);
    if (pinned) {
      await saveStoredSession(resolvedPath, { ...stored, pinnedAtUnixMs: Date.now() });
    } else {
      const unpinned = { ...stored };
      delete unpinned.pinnedAtUnixMs;
      await saveStoredSession(resolvedPath, unpinned);
    }
    ctx.notifySessionListUpdated();
    ctx.setLastRuntimeError("");
    return ctx.buildSnapshot();
  });
}
