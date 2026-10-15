import { useCallback, useEffect, type MutableRefObject } from "react";

import { useConversationSplit } from "@/contexts/conversation-split-context";
import { useConversationSessionFocusComposer } from "@/hooks/useConversationSessionFocusComposer";
import type { FocusedPaneComposerControls } from "@/lib/focused-pane-composer-controls";

export type ConversationSessionFocusComposerBridgeProps = {
  composerSessionKey: string;
  surfaceActive: boolean;
  ready: boolean;
  composerAutomationApiRef?: MutableRefObject<FocusedPaneComposerControls | null>;
};

/** Routes session-focus and automation seeding to the focused pane composer. */
export function ConversationSessionFocusComposerBridge({
  composerSessionKey,
  surfaceActive,
  ready,
  composerAutomationApiRef,
}: ConversationSessionFocusComposerBridgeProps) {
  const split = useConversationSplit();
  const focusComposer = useCallback(() => {
    // Read at call time. Split layout stays mounted across settings, and the
    // pane that was focused before leaving is still the one that should receive the caret.
    split.getFocusedPaneComposerControls()?.focusComposer();
  }, [split.getFocusedPaneComposerControls]);

  useEffect(() => {
    if (!composerAutomationApiRef) {
      return;
    }
    const getControls = split.getFocusedPaneComposerControls;
    composerAutomationApiRef.current = {
      focusComposer: () => getControls()?.focusComposer(),
      setComposerText: (text) => getControls()?.setComposerText(text),
      setSlashSelectedIndex: (index) => getControls()?.setSlashSelectedIndex(index),
      prefillSkillChip: (skillName) => getControls()?.prefillSkillChip(skillName),
    };
  }, [composerAutomationApiRef, split.getFocusedPaneComposerControls]);

  useConversationSessionFocusComposer({
    composerSessionKey,
    focusComposer,
    surfaceActive,
    ready,
  });

  return null;
}
