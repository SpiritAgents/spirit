import { useEffect } from "react";

import { isDarwinElectronShell } from "@/lib/desktop-shell";

const DARWIN_CONVERSATION_SPLIT_CLASS = "spirit-desktop-darwin-conversation-split";

/** After macOS Split, top bars are used for pane dragging; disable window-level title bar dragging to avoid conflicts with HTML5 drag. */
export function useDarwinConversationSplitChrome(paneCount: number): void {
  useEffect(() => {
    if (!isDarwinElectronShell() || typeof document === "undefined") {
      return;
    }
    const splitActive = paneCount > 1;
    document.documentElement.classList.toggle(DARWIN_CONVERSATION_SPLIT_CLASS, splitActive);
    return () => {
      document.documentElement.classList.remove(DARWIN_CONVERSATION_SPLIT_CLASS);
    };
  }, [paneCount]);
}
