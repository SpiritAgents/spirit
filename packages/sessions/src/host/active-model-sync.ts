import { modelRefsEqual } from "@spiritagent/host-internal";

import type { ModelRef } from "../types.js";
import type { DesktopConfigFile } from "./storage.js";
import { resolvePaneModelRef } from "./model-config-access.js";
import type { SessionBundle } from "./session-bundle.js";

export interface HostActiveModelState {
  config: Pick<DesktopConfigFile, "activeModel" | "providers">;
}

export function resolveEffectivePaneActiveModel(
  bundle: Pick<SessionBundle, "activeModel">,
  state: HostActiveModelState,
): ModelRef {
  const fromBundle = resolvePaneModelRef(state.config, bundle.activeModel);
  if (fromBundle) {
    return fromBundle;
  }
  return state.config.activeModel;
}

export function needsHostActiveModelSync(
  bundle: Pick<SessionBundle, "activeModel">,
  state: HostActiveModelState,
): boolean {
  const effective = resolveEffectivePaneActiveModel(bundle, state);
  return !modelRefsEqual(effective, state.config.activeModel);
}

export function resolvePaneModelProjection(input: {
  bundle: SessionBundle;
  state: HostActiveModelState;
  isForegroundActive: boolean;
}): { activeModel: ModelRef } | undefined {
  if (input.isForegroundActive) {
    return undefined;
  }

  return {
    activeModel: resolveEffectivePaneActiveModel(input.bundle, input.state),
  };
}

/** Capture the current global model on a pane bundle before another pane mutates host config. */
export function freezePaneActiveModelIfNeeded(
  bundle: SessionBundle,
  state: HostActiveModelState,
): void {
  if (!resolvePaneModelRef(state.config, bundle.activeModel)) {
    bundle.activeModel = { ...state.config.activeModel };
  }
}

export function ensureVisiblePaneActiveModels(
  bundles: SessionBundle[],
  state: HostActiveModelState,
): void {
  for (const bundle of bundles) {
    freezePaneActiveModelIfNeeded(bundle, state);
  }
}
