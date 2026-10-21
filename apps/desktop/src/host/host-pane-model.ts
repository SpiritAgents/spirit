import path from "node:path";

import type { DesktopSnapshot, SwitchPaneModelRequest } from "../types.js";
import type { SessionBundle } from "./session-bundle.js";
import type { SessionSplitHostContext } from "./session-split.js";
import { freezePaneActiveModelIfNeeded } from "./active-model-sync.js";
import { modelExistsInProvider } from "@spiritagent/host-internal";

export interface PaneModelHostContext extends SessionSplitHostContext {
  adoptActiveModelForForeground(modelRef: import("../types.js").ModelRef): Promise<void>;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  invalidatePaneSessionSliceCache(sessionPath: string): void;
  invalidateAllPaneSessionSliceCache(): void;
  persistCurrentSessionIfNeeded(): Promise<void>;
}

export async function switchPaneModelCommand(
  ctx: PaneModelHostContext,
  request: SwitchPaneModelRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const sessionPath = path.resolve(request.sessionPath.trim());
    if (!sessionPath) {
      throw new Error("Split pane session path is required.");
    }

    const modelRef = request.modelRef;
    if (!modelRef.providerId.trim() || !modelRef.name.trim()) {
      throw new Error("Model ref is required.");
    }

    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(sessionPath);
    if (!bundle) {
      throw new Error("Session not found.");
    }

    const state = ctx.requireState();
    if (!modelExistsInProvider(state.config.providers, modelRef.providerId, modelRef.name)) {
      throw new Error(`Model not found: ${modelRef.providerId}::${modelRef.name}`);
    }

    const isForeground = registry.getActive() === bundle;
    if (ctx.visiblePaneSessionPaths().length > 1) {
      const previous = registry.getActive();
      if (previous && previous !== bundle) {
        freezePaneActiveModelIfNeeded(previous, state);
      }
      freezePaneActiveModelIfNeeded(bundle, state);
    }
    bundle.activeModel = modelRef;

    if (isForeground) {
      await ctx.adoptActiveModelForForeground(modelRef);
    } else if (bundle.runtime && !bundle.runtime.isBusy()) {
      await ctx.refreshRuntimeForBundle(bundle);
      await ctx.persistCurrentSessionIfNeeded();
    }

    ctx.invalidatePaneSessionSliceCache(sessionPath);
    if (!isForeground) {
      ctx.invalidateAllPaneSessionSliceCache();
    }

    return ctx.buildSnapshot();
  });
}
