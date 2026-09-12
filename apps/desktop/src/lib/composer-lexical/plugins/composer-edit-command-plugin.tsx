import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";

import {
  notifyEditCommandTargetsChanged,
  readEditClipboardText,
  registerEditCommandTarget,
  writeEditClipboardText,
  type RegisteredEditAdapter,
} from "@/lib/edit-command-targets";
import type { EditCommand } from "@/lib/edit-command-state";

const COMPOSER_SURFACE_SELECTOR = "[data-spirit-surface='composer-surface']";

function readLexicalSelectionText(): string {
  const selection = $getSelection();
  return selection?.getTextContent() ?? "";
}

function dispatchLexicalEditCommand(editor: LexicalEditor, command: EditCommand): void {
  if (command === "undo") {
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    return;
  }
  if (command === "redo") {
    editor.dispatchCommand(REDO_COMMAND, undefined);
    return;
  }
  if (command === "selectAll") {
    editor.update(() => {
      $getRoot().select();
    });
    return;
  }
  if (command === "copy" || command === "cut") {
    let text = "";
    editor.getEditorState().read(() => {
      text = readLexicalSelectionText();
    });
    writeEditClipboardText(text);
    if (command === "cut") {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.removeText();
        }
      });
    }
    return;
  }
  if (command === "paste") {
    const text = readEditClipboardText();
    if (!text) {
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertRawText(text);
      }
    });
  }
}

export function ComposerEditCommandPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let canUndo = false;
    let canRedo = false;
    let unregisterTarget: (() => void) | undefined;

    const attach = (root: HTMLElement) => {
      unregisterTarget?.();
      const surface = root.closest(COMPOSER_SURFACE_SELECTOR);
      const adapterRoot = surface instanceof HTMLElement ? surface : root;
      const adapter: RegisteredEditAdapter = {
        kind: "lexical",
        root: adapterRoot,
        query: () => {
          let hasSelection = false;
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            hasSelection = $isRangeSelection(selection) && !selection.isCollapsed();
          });
          return {
            editable: editor.isEditable(),
            canUndo,
            canRedo,
            hasSelection,
          };
        },
        dispatch: (command) => {
          dispatchLexicalEditCommand(editor, command);
        },
      };
      unregisterTarget = registerEditCommandTarget(adapter);
    };

    const currentRoot = editor.getRootElement();
    if (currentRoot) {
      attach(currentRoot);
    }

    const unregisterRoot = editor.registerRootListener((root) => {
      if (root) {
        attach(root);
      }
    });
    const unregisterCanUndo = editor.registerCommand(
      CAN_UNDO_COMMAND,
      (payload) => {
        canUndo = payload;
        notifyEditCommandTargetsChanged();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterCanRedo = editor.registerCommand(
      CAN_REDO_COMMAND,
      (payload) => {
        canRedo = payload;
        notifyEditCommandTargetsChanged();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        notifyEditCommandTargetsChanged();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterRoot();
      unregisterCanUndo();
      unregisterCanRedo();
      unregisterSelection();
      unregisterTarget?.();
    };
  }, [editor]);

  return null;
}
