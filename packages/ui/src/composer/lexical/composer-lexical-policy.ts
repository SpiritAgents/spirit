import type { DesktopAgentMode } from "../agent-mode.js";
import {
  applyAgentModeChipPolicy,
  type AgentModeChipPolicy,
} from "../composer-agent-mode-policy.js";
import { mergeAdjacentTextSegments, type RichSegment } from "../composer-segment-model.js";
import { ensureLoopChipTypingTail, ensureLoopPinned } from "../composer-loop-segments.js";

export type StructuralChipPolicyOptions = {
  agentMode: DesktopAgentMode;
  agentModeChipDismissed: boolean;
};

/** Single entry: pin loop + agent-mode chips on segment state (Lexical path). */
export function normalizeComposerSegmentsPolicy(
  segments: readonly RichSegment[],
  policy: StructuralChipPolicyOptions,
): RichSegment[] {
  const agentPolicy: AgentModeChipPolicy = {
    hostMode: policy.agentMode,
    dismissed: policy.agentModeChipDismissed,
  };
  return applyAgentModeChipPolicy(
    ensureLoopChipTypingTail(ensureLoopPinned(mergeAdjacentTextSegments([...segments]))),
    agentPolicy,
  );
}
