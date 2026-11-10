import { useEffect } from "react";

import { useConversationSplit } from "@/contexts/conversation-split-context";
import { shouldRedirectKeydownToComposer } from "@/lib/composer-typing-focus-redirect";

export type ConversationTypingFocusRedirectBridgeProps = {
  enabled: boolean;
};

/** Redirects plain typing to the focused pane composer when focus sits outside any editable. */
export function ConversationTypingFocusRedirectBridge({
  enabled,
}: ConversationTypingFocusRedirectBridgeProps) {
  const split = useConversationSplit();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const getControls = split.getFocusedPaneComposerControls;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldRedirectKeydownToComposer(event)) {
        return;
      }
      // Only focus synchronously; do not preventDefault or inject characters manually: let the
      // native key pipeline deliver the character into the just-focused contenteditable. The first
      // character can only land as the raw letter because the OS has already dispatched it;
      // subsequent keys are then taken over by the IME normally.
      getControls()?.focusComposer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, split.getFocusedPaneComposerControls]);

  return null;
}
