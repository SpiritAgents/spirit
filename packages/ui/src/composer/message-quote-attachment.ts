export type QuoteChipOrigin = "session" | "side-chat";

export interface MessageQuoteAttachment {
  id: string;
  /** Selected conversation text frozen at insert time. */
  selectedText: string;
  /** Host-only: chat session path of the quoted message. Never sent to the agent. */
  sessionPath?: string;
  /** Host-only: quoted message id. Never sent to the agent. */
  messageId?: number;
  /** Host-only: whether the quote came from a side-chat pane. Never sent to the agent. */
  origin?: QuoteChipOrigin;
}
