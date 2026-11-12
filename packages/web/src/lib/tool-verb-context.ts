import type { ToolBlockSnapshot } from "../types.js";

/**
 * Map tool phase to i18next context suffix for verb tense.
 * - preview / running / pending-approval → 'running' (progressive)
 * - succeeded → 'succeeded' (past tense / completion)
 * - failed / unknown → undefined (fallback to base key)
 *
 * Locales define context-suffixed keys (e.g. tool.edit_running) where needed;
 * missing keys fall back to the base verb via i18next.
 */
export function phaseToVerbContext(phase: ToolBlockSnapshot["phase"]): string | undefined {
  switch (phase) {
    case "preview":
    case "running":
    case "pending-approval":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
    default:
      return undefined;
  }
}
