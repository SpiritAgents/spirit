import type { ToolBlockSnapshot } from "../types.js";

/** Minimal tool cards show the same shimmer as Thinking during the preview / pending-approval / running phases. */
export function toolCallPhaseShowsShimmer(phase: ToolBlockSnapshot["phase"]): boolean {
  return phase === "preview" || phase === "pending-approval" || phase === "running";
}
