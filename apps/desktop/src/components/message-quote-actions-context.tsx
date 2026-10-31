import { createContext, useContext, type ReactNode } from "react";

import type { MessageQuoteAttachment, QuoteChipOrigin } from "@/lib/message-quote-attachment";

/**
 * Quote-attachment pipeline of the conversation pane ("Add to Chat | Add to Side Chat"). The
 * DOM-selection menu (ConversationMessageSelectionMenu) cannot see xterm's internal selection,
 * so ShellToolXtermOutput consumes this to offer the same actions for its own selection.
 */
export type MessageQuoteActionsContextValue = {
  quoteSessionPath?: string;
  quoteOrigin?: QuoteChipOrigin;
  onMessageQuoteAddToChat?: (attachment: MessageQuoteAttachment) => void;
  onMessageQuoteAddToSideChat?: (attachment: MessageQuoteAttachment) => void;
};

const MessageQuoteActionsContext = createContext<MessageQuoteActionsContextValue | null>(null);

export function MessageQuoteActionsProvider({
  value,
  children,
}: {
  value: MessageQuoteActionsContextValue;
  children: ReactNode;
}) {
  return (
    <MessageQuoteActionsContext.Provider value={value}>
      {children}
    </MessageQuoteActionsContext.Provider>
  );
}

export function useMessageQuoteActions(): MessageQuoteActionsContextValue | null {
  return useContext(MessageQuoteActionsContext);
}
