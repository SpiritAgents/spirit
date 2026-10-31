import { useCallback, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import * as monaco from "monaco-editor";

import {
  TextSelectionActionMenu,
  TextSelectionActionMenuItem,
} from "@/components/text-selection-action-menu";
import {
  useMonacoSelectionActionMenu,
  readMonacoSelectionLineRange,
} from "@/hooks/use-monaco-selection-action-menu";
import { useTextSelectionActionMenu } from "@/hooks/use-text-selection-action-menu";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type * as Monaco from "monaco-editor";

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;

function makeFileSnippetAttachment(
  filePath: string,
  selectedText: string,
  lineStart: number,
  lineEnd: number,
): FileSnippetAttachment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filePath,
    lineStart,
    lineEnd,
    selectedText,
  };
}

export function FileDomSelectionMenu({
  rootRef,
  filePath,
  onFileSnippetAddToChat,
}: {
  rootRef: RefObject<HTMLElement | null>;
  filePath: string;
  onFileSnippetAddToChat?: (attachment: FileSnippetAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onFileSnippetAddToChat && filePath);
  const { open, setOpen, anchor, selectionText, dismiss } = useTextSelectionActionMenu({
    enabled,
    rootRef,
  });

  const handleAddToChat = useCallback(() => {
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!onFileSnippetAddToChat || !filePath) {
      dismiss();
      return;
    }

    const selectedText = (selectionText.trim() || selection?.toString() || "").trim();
    if (!selectedText) {
      dismiss();
      return;
    }

    onFileSnippetAddToChat(makeFileSnippetAttachment(filePath, selectedText, 0, 0));
    dismiss();
    selection?.removeAllRanges();
  }, [dismiss, filePath, onFileSnippetAddToChat, selectionText]);

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
        label={t("workspace.addSelectionToChat")}
        onSelect={handleAddToChat}
      />
    </TextSelectionActionMenu>
  );
}

export function FileMonacoSelectionMenu({
  containerRef,
  editor,
  filePath,
  onFileSnippetAddToChat,
}: {
  containerRef: RefObject<HTMLElement | null>;
  editor: MonacoEditor | null;
  filePath: string;
  onFileSnippetAddToChat?: (attachment: FileSnippetAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onFileSnippetAddToChat && filePath);
  const { open, setOpen, anchor, selectionText, lineRange, dismiss } = useMonacoSelectionActionMenu(
    {
      enabled,
      containerRef,
      editor,
    },
  );

  const handleAddToChat = useCallback(() => {
    const activeEditor = editor;
    if (!activeEditor || !onFileSnippetAddToChat || !filePath) {
      dismiss();
      return;
    }

    const selectedText = selectionText.trim();
    if (!selectedText) {
      dismiss();
      return;
    }

    const range = readMonacoSelectionLineRange(activeEditor) ?? lineRange;
    onFileSnippetAddToChat(
      makeFileSnippetAttachment(filePath, selectedText, range?.lineStart ?? 0, range?.lineEnd ?? 0),
    );
    dismiss();

    const selection = activeEditor.getSelection();
    if (selection) {
      activeEditor.setSelection(
        new monaco.Selection(
          selection.startLineNumber,
          selection.startColumn,
          selection.startLineNumber,
          selection.startColumn,
        ),
      );
    }
  }, [dismiss, editor, filePath, lineRange, onFileSnippetAddToChat, selectionText]);

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
        label={t("workspace.addSelectionToChat")}
        onSelect={handleAddToChat}
      />
    </TextSelectionActionMenu>
  );
}
