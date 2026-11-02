import { useEffect, type RefObject } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_LOW } from "lexical";

type SlashSelectionPluginProps = {
  contentEditableRef: RefObject<HTMLDivElement | null>;
  reportSelectionChange: () => void;
  enabled: boolean;
};

export function SlashSelectionPlugin({
  contentEditableRef,
  reportSelectionChange,
  enabled,
}: SlashSelectionPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const root = contentEditableRef.current;
    if (!root) {
      return;
    }

    const onDocumentSelectionChange = () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.rangeCount === 0 ||
        !root.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        return;
      }
      reportSelectionChange();
    };

    root.addEventListener("mouseup", reportSelectionChange);
    root.addEventListener("keyup", reportSelectionChange);
    document.addEventListener("selectionchange", onDocumentSelectionChange);

    const unregisterSelectionChange = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        reportSelectionChange();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      root.removeEventListener("mouseup", reportSelectionChange);
      root.removeEventListener("keyup", reportSelectionChange);
      document.removeEventListener("selectionchange", onDocumentSelectionChange);
      unregisterSelectionChange();
    };
  }, [contentEditableRef, editor, enabled, reportSelectionChange]);

  return null;
}
