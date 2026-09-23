import path from "node:path";

import i18n from "../lib/i18n-host.js";
import type { DesktopSnapshot } from "../types.js";
import type { SessionActivationContext } from "./session-activation.js";
import { loadStoredSession, saveStoredSession } from "./storage.js";

function sameSessionPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export interface SessionRenameContext extends SessionActivationContext {
  bundleRuntimeIsBusy(sessionPath: string): boolean;
  notifySessionListUpdated(): void;
  emitLiveSnapshotUpdate(): void;
}

export async function renameSessionCommand(
  ctx: SessionRenameContext,
  filePath: string,
  displayName: string,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const trimmedPath = filePath.trim();
    if (!trimmedPath) {
      throw new Error(i18n.t("error.invalidSessionPath"));
    }

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      throw new Error(i18n.t("error.emptyChatDisplayName"));
    }

    const resolvedPath = path.resolve(trimmedPath);
    if (ctx.bundleRuntimeIsBusy(resolvedPath)) {
      throw new Error(i18n.t("error.cannotRenameBusyChat"));
    }

    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(resolvedPath);
    const activeId = registry.activeSessionId();
    const isActiveSession = activeId !== undefined && sameSessionPath(activeId, resolvedPath);

    if (bundle?.activeSession && path.resolve(bundle.activeSession.filePath) === resolvedPath) {
      bundle.activeSession.displayName = trimmedName;
      bundle.sessionTitleSource = "manual";
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
    await saveStoredSession(resolvedPath, {
      ...stored,
      sessionDisplayName: trimmedName,
      sessionTitleSource: "manual",
    });
    ctx.notifySessionListUpdated();
    ctx.setLastRuntimeError("");
    return ctx.buildSnapshot();
  });
}
