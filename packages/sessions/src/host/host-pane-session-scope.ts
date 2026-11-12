import path from "node:path";

import type { SessionRegistry } from "./session-registry.js";

export interface PaneSessionScopeHostContext {
  sessionRegistry(): SessionRegistry;
  syncActiveRuntimePointer(): void;
}

/** Temporarily activate a split pane session for turn commands, then restore foreground. */
export async function withOptionalPaneSessionActivation<T>(
  ctx: PaneSessionScopeHostContext,
  sessionPath: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const trimmed = sessionPath?.trim();
  if (!trimmed) {
    return run();
  }

  const registry = ctx.sessionRegistry();
  const resolved = path.resolve(trimmed);
  const previousActive = registry.getActive();
  const previousActiveId = registry.activeSessionId();
  let restored = false;

  const restore = () => {
    if (!restored && previousActive && previousActiveId) {
      registry.activateExisting(previousActive);
      ctx.syncActiveRuntimePointer();
      restored = true;
    }
  };

  try {
    const target = registry.findBySessionPath(resolved);
    if (!target) {
      throw new Error("Session not found.");
    }
    if (registry.getActive() !== target) {
      registry.activateExisting(target);
      ctx.syncActiveRuntimePointer();
    }
    return await run();
  } finally {
    restore();
  }
}
