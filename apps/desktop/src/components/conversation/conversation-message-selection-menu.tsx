import { useCallback, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  TextSelectionActionMenu,
  TextSelectionActionMenuItem,
  TextSelectionActionMenuSegmentedItems,
} from "@/components/text-selection-action-menu";
import { useTextSelectionActionMenu } from "@/hooks/use-text-selection-action-menu";
import type { MessageQuoteAttachment, QuoteChipOrigin } from "@/lib/message-quote-attachment";

function quotedMessageIdFromSelection(selection: Selection | null): number | undefined {
  const node = selection?.anchorNode;
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const row = element?.closest("[data-conversation-message-id]");
  if (!(row instanceof HTMLElement)) {
    return undefined;
  }
  const parsed = Number(row.dataset.conversationMessageId);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function makeMessageQuoteAttachment(
  selectedText: string,
  selection: Selection | null,
  sessionPath: string | undefined,
  origin: QuoteChipOrigin | undefined,
): MessageQuoteAttachment {
  const messageId = quotedMessageIdFromSelection(selection);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    selectedText,
    ...(sessionPath ? { sessionPath } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    ...(origin ? { origin } : {}),
  };
}

/** Selections inside contenteditable such as the Rewind inline editor do not trigger the quote menu. */
function isSelectionOutsideEditable(selection: Selection): boolean {
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    if (element?.closest('[contenteditable="true"]')) {
      return false;
    }
  }
  return true;
}

export function ConversationMessageSelectionMenu({
  rootRef,
  quoteSessionPath,
  quoteOrigin,
  onMessageQuoteAddToChat,
  onMessageQuoteAddToSideChat,
}: {
  rootRef: RefObject<HTMLElement | null>;
  quoteSessionPath?: string;
  quoteOrigin?: QuoteChipOrigin;
  onMessageQuoteAddToChat?: (attachment: MessageQuoteAttachment) => void;
  onMessageQuoteAddToSideChat?: (attachment: MessageQuoteAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onMessageQuoteAddToChat);
  const { open, setOpen, anchor, selectionText, dismiss } = useTextSelectionActionMenu({
    enabled,
    rootRef,
    isSelectionAllowed: isSelectionOutsideEditable,
  });

  const confirmSelection = useCallback(
    (onAdd: ((attachment: MessageQuoteAttachment) => void) | undefined) => {
      const selection = typeof window !== "undefined" ? window.getSelection() : null;
      const selectedText = (selectionText.trim() || selection?.toString() || "").trim();
      if (!onAdd || !selectedText) {
        dismiss();
        return;
      }

      onAdd(makeMessageQuoteAttachment(selectedText, selection, quoteSessionPath, quoteOrigin));
      dismiss();
      selection?.removeAllRanges();
    },
    [dismiss, quoteOrigin, quoteSessionPath, selectionText],
  );

  const handleAddToChat = useCallback(() => {
    confirmSelection(onMessageQuoteAddToChat);
  }, [confirmSelection, onMessageQuoteAddToChat]);

  const handleAddToSideChat = useCallback(() => {
    confirmSelection(onMessageQuoteAddToSideChat);
  }, [confirmSelection, onMessageQuoteAddToSideChat]);

  if (!enabled) {
    return null;
  }

  return (
    <TextSelectionActionMenu
      open={open && Boolean(selectionText.trim())}
      anchor={anchor}
      onOpenChange={setOpen}
    >
      {onMessageQuoteAddToSideChat ? (
        <TextSelectionActionMenuSegmentedItems
          segments={[
            { label: t("workspace.addSelectionToChat"), onSelect: handleAddToChat },
            { label: t("workspace.addSelectionToSideChat"), onSelect: handleAddToSideChat },
          ]}
        />
      ) : (
        <TextSelectionActionMenuItem
          label={t("workspace.addSelectionToChat")}
          onSelect={handleAddToChat}
        />
      )}
    </TextSelectionActionMenu>
  );
}
