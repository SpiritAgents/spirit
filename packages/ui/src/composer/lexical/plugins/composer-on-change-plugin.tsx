import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { LexicalEditor } from "lexical";
import type { RefObject } from "react";

type ComposerOnChangePluginProps = {
  skipEditorSyncRef: RefObject<boolean>;
  onEditorChange(editor: LexicalEditor): void;
};

export function ComposerOnChangePlugin({
  skipEditorSyncRef,
  onEditorChange,
}: ComposerOnChangePluginProps) {
  return (
    <OnChangePlugin
      onChange={(_editorState, editor) => {
        if (skipEditorSyncRef.current) {
          return;
        }
        onEditorChange(editor);
      }}
    />
  );
}
