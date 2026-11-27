import { useCallback, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  TextSelectionActionMenu,
  TextSelectionActionMenuItem,
} from "@/components/text-selection-action-menu";
import {
  useTerminalSelectionActionMenu,
  readTerminalSelectionLineRange,
} from "@/hooks/use-terminal-selection-action-menu";
import type { TerminalSnippetAttachment } from "@spiritagent/ui/composer";
import type { Terminal } from "@xterm/xterm";

function TerminalSelectionMenu({
  containerRef,
  terminal,
  terminalDisplayName,
  onTerminalAddToThread,
}: {
  containerRef: RefObject<HTMLElement | null>;
  terminal: Terminal | null;
  terminalDisplayName: string;
  onTerminalAddToThread?: (attachment: TerminalSnippetAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onTerminalAddToThread);
  const { open, setOpen, anchor, selectionText, lineRange, dismiss } =
    useTerminalSelectionActionMenu({
      enabled,
      containerRef,
      terminal,
    });

  const handleAddToThread = useCallback(() => {
    const term = terminal;
    if (!term || !onTerminalAddToThread) {
      dismiss();
      return;
    }

    const selectedText = (selectionText.trim() || term.getSelection()).trim();
    if (!selectedText) {
      dismiss();
      return;
    }

    const range = readTerminalSelectionLineRange(term) ?? lineRange;
    const attachment: TerminalSnippetAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      terminalName: terminalDisplayName,
      lineStart: range?.lineStart ?? 0,
      lineEnd: range?.lineEnd ?? 0,
      selectedText,
    };
    onTerminalAddToThread(attachment);
    dismiss();
    term.clearSelection();
  }, [dismiss, lineRange, onTerminalAddToThread, selectionText, terminal, terminalDisplayName]);

  if (!enabled) {
    return null;
  }

  return (
    <TextSelectionActionMenu
      open={open && Boolean(selectionText.trim())}
      anchor={anchor}
      onOpenChange={setOpen}
    >
      <TextSelectionActionMenuItem
        label={t("workspace.addSelectionToThread")}
        onSelect={handleAddToThread}
      />
    </TextSelectionActionMenu>
  );
}

export { TerminalSelectionMenu };
