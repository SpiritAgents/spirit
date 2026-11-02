import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { editorStateToRichSegments } from "../bridge/editor-to-rich-segments.js";
import { richSegmentsToEditorState } from "../bridge/rich-segments-to-editor.js";
import { normalizeComposerSegmentsPolicy } from "../composer-lexical-policy.js";
import type { DesktopAgentMode } from "../../agent-mode.js";
import {
  hasLoopSegment,
  insertLoopSegment,
  removeLoopSegment,
} from "../../composer-loop-segments.js";
import {
  mergeAdjacentTextSegments,
  segmentsEqual,
  type RichSegment,
} from "../../composer-segment-model.js";

type LoopChipPluginProps = {
  loopEnabled: boolean;
  agentMode: DesktopAgentMode;
  agentModeChipDismissed: boolean;
  skipEditorSyncRef: React.MutableRefObject<boolean>;
  onSegmentsNormalized(segments: RichSegment[]): void;
  onLoopEnabledChange?(enabled: boolean): void;
};

export function LoopChipPlugin({
  loopEnabled,
  agentMode,
  agentModeChipDismissed,
  skipEditorSyncRef,
  onSegmentsNormalized,
  onLoopEnabledChange,
}: LoopChipPluginProps) {
  const [editor] = useLexicalComposerContext();
  const prevLoopEnabledRef = useRef(false);

  useEffect(() => {
    const prev = prevLoopEnabledRef.current;
    prevLoopEnabledRef.current = loopEnabled;

    const raw = editorStateToRichSegments(editor);

    if (!loopEnabled) {
      if (prev && hasLoopSegment(raw)) {
        const stripped = normalizeComposerSegmentsPolicy(removeLoopSegment(raw), {
          agentMode,
          agentModeChipDismissed,
        });
        skipEditorSyncRef.current = true;
        richSegmentsToEditorState(stripped, editor);
        skipEditorSyncRef.current = false;
        onSegmentsNormalized(stripped);
        onLoopEnabledChange?.(false);
      }
      return;
    }

    if (!prev && !hasLoopSegment(raw)) {
      const { segments: inserted } = insertLoopSegment(mergeAdjacentTextSegments(raw));
      const next = normalizeComposerSegmentsPolicy(inserted, {
        agentMode,
        agentModeChipDismissed,
      });
      if (segmentsEqual(next, raw)) {
        return;
      }
      skipEditorSyncRef.current = true;
      richSegmentsToEditorState(next, editor);
      skipEditorSyncRef.current = false;
      onSegmentsNormalized(next);
    }
  }, [
    agentMode,
    agentModeChipDismissed,
    editor,
    loopEnabled,
    onLoopEnabledChange,
    onSegmentsNormalized,
    skipEditorSyncRef,
  ]);

  return null;
}
