import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import type { DesktopAgentMode } from "../../agent-mode.js";
import {
  hasAgentModeSegment,
  insertAgentModeSegment,
  isAgentModeChipKind,
  type AgentModeChipKind,
} from "../../composer-agent-mode-segments.js";
import { editorStateToRichSegments } from "../bridge/editor-to-rich-segments.js";
import { richSegmentsToEditorState } from "../bridge/rich-segments-to-editor.js";
import { normalizeComposerSegmentsPolicy } from "../composer-lexical-policy.js";
import {
  mergeAdjacentTextSegments,
  segmentsEqual,
  type RichSegment,
} from "../../composer-segment-model.js";
import { shouldPinAgentModeChip } from "../../composer-agent-mode-policy.js";

type AgentModeChipPluginProps = {
  agentMode: DesktopAgentMode;
  agentModeChipDismissed: boolean;
  segmentsRef: React.MutableRefObject<RichSegment[]>;
  skipEditorSyncRef: React.MutableRefObject<boolean>;
  onSegmentsNormalized(segments: RichSegment[]): void;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
  onAgentModeChange?(mode: DesktopAgentMode): void;
};

export function AgentModeChipPlugin({
  agentMode,
  agentModeChipDismissed,
  segmentsRef,
  skipEditorSyncRef,
  onSegmentsNormalized,
  onAgentModeChipDismissChange,
  onAgentModeChange,
}: AgentModeChipPluginProps) {
  const [editor] = useLexicalComposerContext();
  const prevAgentModeRef = useRef(agentMode);
  const dismissedRef = useRef(agentModeChipDismissed);

  useEffect(() => {
    dismissedRef.current = agentModeChipDismissed;
  }, [agentModeChipDismissed]);

  useEffect(() => {
    const prev = prevAgentModeRef.current;
    prevAgentModeRef.current = agentMode;

    if (!isAgentModeChipKind(agentMode)) {
      if (isAgentModeChipKind(prev) && hasAgentModeSegment(editorStateToRichSegments(editor))) {
        const raw = editorStateToRichSegments(editor);
        const next = normalizeComposerSegmentsPolicy(raw, {
          agentMode,
          agentModeChipDismissed: true,
        });
        queueMicrotask(() => {
          skipEditorSyncRef.current = true;
          richSegmentsToEditorState(next, editor);
          skipEditorSyncRef.current = false;
          onSegmentsNormalized(next);
          onAgentModeChange?.("agent");
        });
      }
      return;
    }

    if (prev === agentMode || dismissedRef.current) {
      return;
    }

    const raw = editorStateToRichSegments(editor);
    const { segments: inserted } = insertAgentModeSegment(
      mergeAdjacentTextSegments(raw),
      agentMode as AgentModeChipKind,
    );
    const next = normalizeComposerSegmentsPolicy(inserted, {
      agentMode,
      agentModeChipDismissed: dismissedRef.current,
    });
    if (segmentsEqual(next, raw)) {
      return;
    }
    // Defer the editor write out of the effect window: with chip decorators the update
    // makes @lexical/react flushSync synchronously, which React dev-mode flags in effects.
    queueMicrotask(() => {
      skipEditorSyncRef.current = true;
      richSegmentsToEditorState(next, editor);
      skipEditorSyncRef.current = false;
      dismissedRef.current = false;
      onAgentModeChipDismissChange?.(false);
      onSegmentsNormalized(next);
    });
  }, [
    agentMode,
    editor,
    onAgentModeChange,
    onAgentModeChipDismissChange,
    onSegmentsNormalized,
    skipEditorSyncRef,
  ]);

  useEffect(() => {
    if (!shouldPinAgentModeChip({ hostMode: agentMode, dismissed: agentModeChipDismissed })) {
      return;
    }
    const raw = editorStateToRichSegments(editor);
    const next = normalizeComposerSegmentsPolicy(raw, {
      agentMode,
      agentModeChipDismissed,
    });
    if (segmentsEqual(next, raw)) {
      return;
    }
    queueMicrotask(() => {
      skipEditorSyncRef.current = true;
      richSegmentsToEditorState(next, editor);
      skipEditorSyncRef.current = false;
      if (!segmentsEqual(next, segmentsRef.current)) {
        onSegmentsNormalized(next);
      }
    });
  }, [
    agentMode,
    agentModeChipDismissed,
    editor,
    onSegmentsNormalized,
    segmentsRef,
    skipEditorSyncRef,
  ]);

  return null;
}
