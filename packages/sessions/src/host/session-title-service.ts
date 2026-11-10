import path from "node:path";

import { loadStoredSession, saveStoredSession } from "./storage.js";
import type { SessionRegistry } from "./session-registry.js";
import type { SessionBundle } from "./session-bundle.js";

export async function applyGeneratedSessionTitle(input: {
  sessionPath: string;
  title: string;
  registry: SessionRegistry;
  runSerialized: <T>(work: () => Promise<T>, label?: string) => Promise<T>;
  persistBundle: (bundle: SessionBundle) => Promise<void>;
  notifySessionListUpdated: () => void;
  onActiveSessionTitleApplied?: () => void;
}): Promise<void> {
  const resolvedPath = path.resolve(input.sessionPath);
  await input.runSerialized(async () => {
    const bundle = input.registry.findBySessionPath(resolvedPath);
    if (bundle?.activeSession && path.resolve(bundle.activeSession.filePath) === resolvedPath) {
      if (bundle.sessionTitleSource === "manual") {
        return;
      }
      bundle.activeSession.displayName = input.title;
      bundle.sessionTitleSource = "llm";
      await input.persistBundle(bundle);
      // Active session: snapshot push + renderer sidebar patch; skip async listSessions.
      input.onActiveSessionTitleApplied?.();
      return;
    }

    const stored = await loadStoredSession(resolvedPath);
    if (stored.sessionTitleSource === "llm" || stored.sessionTitleSource === "manual") {
      return;
    }
    await saveStoredSession(resolvedPath, {
      ...stored,
      sessionDisplayName: input.title,
      sessionTitleSource: "llm",
    });
    input.notifySessionListUpdated();
  });
}
