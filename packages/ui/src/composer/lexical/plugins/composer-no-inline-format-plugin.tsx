import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_BEFORE_EDITOR, FORMAT_TEXT_COMMAND } from "lexical";

/**
 * Composer uses Lexical for chips, not as a user-facing rich-text editor.
 * Lexical 0.46 has no editorConfig switch for inline formats (`disabledFormats`
 * is still facebook/lexical#7298); the supported override is this command.
 *
 * Host Cmd+B is handled in window capture and never reaches here. This plugin
 * is the only guard for Cmd/Ctrl+I, Cmd/Ctrl+U, and beforeinput `format*`.
 * Delete it once upstream `disabledFormats` lands.
 */
export function ComposerNoInlineFormatPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(FORMAT_TEXT_COMMAND, () => true, COMMAND_PRIORITY_BEFORE_EDITOR);
  }, [editor]);

  return null;
}
