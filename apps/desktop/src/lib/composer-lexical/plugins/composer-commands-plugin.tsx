import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_EDITOR } from "lexical";

import { lexicalSelectionToSegmentCaret } from "@/lib/composer-lexical/caret";
import {
  INSERT_ATTACHMENT_CHIP_COMMAND,
  INSERT_PLAIN_TEXT_COMMAND,
  INSERT_SKILL_CHIP_COMMAND,
  INSERT_WORKSPACE_FILE_AT_CARET_COMMAND,
  INSERT_WORKSPACE_FILE_REFERENCE_COMMAND,
  INSERT_SESSION_REFERENCE_COMMAND,
  REMOVE_SKILL_SLASH_COMMAND,
  REPLACE_SKILL_SLASH_COMMAND,
} from "@/lib/composer-lexical/commands";
import {
  caretAtEnd,
  emptySegments,
  insertSegmentAtCaret,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  normalizeWorkspaceFilePath,
  replaceSessionReferenceInSegments,
  replaceSkillSlashQueryInSegments,
  replaceWorkspaceFileReferenceInSegments,
  type RichSegment,
  type SegmentCaret,
} from "@/lib/composer-segment-model";

export type ComposerSegmentsCommitOptions = {
  notifyParent?: boolean;
  syncLoop?: boolean;
  syncAgentMode?: boolean;
  pushEditor?: boolean;
};

export type ComposerSegmentsCommitFn = (
  next: RichSegment[],
  caret?: SegmentCaret | null,
  options?: ComposerSegmentsCommitOptions,
) => void;

type ComposerCommandsPluginProps = {
  segmentsRef: React.MutableRefObject<RichSegment[]>;
  commitSegments: ComposerSegmentsCommitFn;
};

export function ComposerCommandsPlugin({
  segmentsRef,
  commitSegments,
}: ComposerCommandsPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const caretOrEnd = (): SegmentCaret => {
      return (
        lexicalSelectionToSegmentCaret(editor, segmentsRef.current) ??
        caretAtEnd(segmentsRef.current)
      );
    };

    const unregisterInsertAttachment = editor.registerCommand(
      INSERT_ATTACHMENT_CHIP_COMMAND,
      (payload) => {
        editor.focus();
        const current = segmentsRef.current;
        const caret = caretOrEnd();
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(current, caret, payload);
        commitSegments(next, nextCaret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterInsertWorkspaceFileAtCaret = editor.registerCommand(
      INSERT_WORKSPACE_FILE_AT_CARET_COMMAND,
      ({ path, sourceTabId }) => {
        editor.focus();
        const current = segmentsRef.current;
        const caret = caretOrEnd();
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(current, caret, {
          kind: "workspaceFile",
          path: normalizeWorkspaceFilePath(path),
          ...(sourceTabId ? { sourceTabId } : {}),
        });
        commitSegments(next, nextCaret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterInsertWorkspaceFileReference = editor.registerCommand(
      INSERT_WORKSPACE_FILE_REFERENCE_COMMAND,
      ({ path, query, finalize = true, isPlan }) => {
        editor.focus();
        const { segments: next, caret } = replaceWorkspaceFileReferenceInSegments(
          segmentsRef.current,
          query,
          path,
          finalize,
          { isPlan: isPlan === true },
        );
        commitSegments(next, caret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterInsertSessionReference = editor.registerCommand(
      INSERT_SESSION_REFERENCE_COMMAND,
      ({ path, title, content, query, finalize = true }) => {
        editor.focus();
        const { segments: next, caret } = replaceSessionReferenceInSegments(
          segmentsRef.current,
          query,
          { path, title, ...(content !== undefined ? { content } : {}) },
          finalize,
        );
        commitSegments(next, caret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterInsertSkillChip = editor.registerCommand(
      INSERT_SKILL_CHIP_COMMAND,
      ({ alias, clearText, appendTrailingSpace }) => {
        editor.focus();
        const base = clearText ? emptySegments() : mergeAdjacentTextSegments(segmentsRef.current);
        const caret = clearText
          ? caretAtEnd(base)
          : (lexicalSelectionToSegmentCaret(editor, base) ?? caretAtEnd(base));
        let { segments: next, caret: nextCaret } = insertSegmentAtCaret(base, caret, {
          kind: "skill",
          alias,
        });
        if (appendTrailingSpace) {
          const trailing = next[nextCaret.segmentIndex];
          const chipTailAlreadySpaced =
            trailing?.kind === "text" &&
            isComposerPlainEmpty(trailing.value) &&
            nextCaret.offset > 0;
          if (!chipTailAlreadySpaced) {
            ({ segments: next, caret: nextCaret } = insertSegmentAtCaret(next, nextCaret, {
              kind: "text",
              value: " ",
            }));
          }
        }
        commitSegments(next, nextCaret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterInsertPlainText = editor.registerCommand(
      INSERT_PLAIN_TEXT_COMMAND,
      ({ text }) => {
        if (!text) {
          return true;
        }
        editor.focus();
        const current = mergeAdjacentTextSegments(segmentsRef.current);
        const caret = lexicalSelectionToSegmentCaret(editor, current) ?? caretAtEnd(current);
        const seg = current[caret.segmentIndex];
        if (seg?.kind === "text") {
          const before = seg.value.slice(0, caret.offset);
          const after = seg.value.slice(caret.offset);
          const next = mergeAdjacentTextSegments([
            ...current.slice(0, caret.segmentIndex),
            { kind: "text" as const, value: `${before}${text}${after}` },
            ...current.slice(caret.segmentIndex + 1),
          ]);
          commitSegments(next, {
            segmentIndex: caret.segmentIndex,
            offset: caret.offset + text.length,
          });
          return true;
        }
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(current, caret, {
          kind: "text",
          value: text,
        });
        commitSegments(next, nextCaret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterReplaceSkillSlash = editor.registerCommand(
      REPLACE_SKILL_SLASH_COMMAND,
      ({ query, replacement, finalize = false }) => {
        editor.focus();
        const { segments: next, caret } = replaceSkillSlashQueryInSegments(
          segmentsRef.current,
          query,
          replacement,
          finalize,
        );
        commitSegments(next, caret);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterRemoveSkillSlash = editor.registerCommand(
      REMOVE_SKILL_SLASH_COMMAND,
      ({ query }) => {
        editor.dispatchCommand(REPLACE_SKILL_SLASH_COMMAND, {
          query,
          replacement: "",
          finalize: false,
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    return () => {
      unregisterInsertAttachment();
      unregisterInsertWorkspaceFileAtCaret();
      unregisterInsertWorkspaceFileReference();
      unregisterInsertSessionReference();
      unregisterInsertSkillChip();
      unregisterInsertPlainText();
      unregisterReplaceSkillSlash();
      unregisterRemoveSkillSlash();
    };
  }, [commitSegments, editor, segmentsRef]);

  return null;
}
