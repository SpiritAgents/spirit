import { useEffect, useRef } from "react";

import {
  codeCompletionOperationToInlineItemAtCursor,
  type CodeCompletionOperation,
} from "@spiritagent/code-completion/monaco";
import {
  codeCompletionOperationToDeleteDiffPreviewAtCursor,
  type InlineDeleteDiffPreviewSpec,
} from "@spiritagent/code-completion/delete-diff-preview";
import * as monaco from "monaco-editor";

import { useHostApi } from "@/hooks/useHostApi";
import {
  applyDeletePreviewEdit,
  DeleteDiffPreviewWidget,
  deletePreviewDecoration,
} from "@/lib/monaco-code-completion-delete-preview";
import { monacoLanguageId } from "@/lib/monaco-language";
import type { CodeCompletionOperationSnapshot } from "@/types";

const COMPLETION_DEBOUNCE_MS = 600;
const JOURNAL_DEBOUNCE_MS = 500;
const CURSOR_AFTER_CONTENT_GRACE_MS = 50;
const DELETE_PREVIEW_CONTEXT_KEY = "spirit.codeCompletion.deletePreviewActive";

type PendingFetch = {
  position: monaco.Position;
  model: monaco.editor.ITextModel;
};

type CompletionCache = {
  line: number;
  column: number;
  items: monaco.languages.InlineCompletion[];
};

type DeletePreviewState = {
  spec: InlineDeleteDiffPreviewSpec;
  decorations: monaco.editor.IEditorDecorationsCollection;
  widget: DeleteDiffPreviewWidget | null;
};

function positionsEqual(a: monaco.Position, b: monaco.Position): boolean {
  return a.lineNumber === b.lineNumber && a.column === b.column;
}

function isMonacoCanceled(error: unknown): boolean {
  if (error instanceof Error && error.name === "Canceled") {
    return true;
  }
  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { name?: string }).name === "Canceled";
  }
  return false;
}

function toInlineItem(
  operation: CodeCompletionOperationSnapshot,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.InlineCompletion | undefined {
  const spec = codeCompletionOperationToInlineItemAtCursor(operation as CodeCompletionOperation, {
    lineText: model.getLineContent(position.lineNumber),
    cursorLine: position.lineNumber,
    cursorColumn: position.column,
  });
  if (!spec) {
    return undefined;
  }
  return {
    range: new monaco.Range(
      spec.startLineNumber,
      spec.startColumn,
      spec.endLineNumber,
      spec.endColumn,
    ),
    insertText: spec.insertText,
  };
}

export function useMonacoCodeCompletion(options: {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  relativePath: string;
  enabled: boolean;
  readOnly: boolean;
  baselineText: string;
}): void {
  const { editor, relativePath, enabled, readOnly, baselineText } = options;
  const { api } = useHostApi();
  const relativePathRef = useRef(relativePath);
  const baselineRef = useRef(baselineText);
  const cacheRef = useRef<CompletionCache | null>(null);
  const deletePreviewRef = useRef<DeletePreviewState | null>(null);
  const deletePreviewActiveRef = useRef<monaco.editor.IContextKey<boolean> | null>(null);
  const acceptDeletePreviewRef = useRef<(() => void) | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchTokenRef = useRef(0);
  const fetchInFlightRef = useRef(false);
  const pendingFetchRef = useRef<PendingFetch | null>(null);
  const scheduledTargetRef = useRef<{ line: number; column: number } | null>(null);
  const lastContentChangeAtRef = useRef(0);

  relativePathRef.current = relativePath;
  baselineRef.current = baselineText;

  // The context key and Tab command are created once per editor instance: the context key belongs to
  // that editor's contextKeyService; caching across instances would write state to a destroyed editor,
  // silently breaking Tab accept after a rebuild. addCommand cannot be unregistered, so it can only be
  // destroyed together with the editor.
  useEffect(() => {
    if (!editor) {
      deletePreviewActiveRef.current = null;
      return;
    }
    // The editor arrives via React state, which lags its real lifecycle: the owning effect in
    // WorkspaceMonacoEditor disposes the instance synchronously while the state update that would
    // clear this prop only lands in a later render, so this effect can mount against an editor
    // that is already disposed. A disposed standalone editor detaches its model; skip it and wait
    // for the live instance instead of throwing inside a passive effect (which unmounts the tree).
    if (editor.getModel() === null) {
      return;
    }
    deletePreviewActiveRef.current = editor.createContextKey<boolean>(
      DELETE_PREVIEW_CONTEXT_KEY,
      false,
    );
    editor.addCommand(
      monaco.KeyCode.Tab,
      () => {
        acceptDeletePreviewRef.current?.();
      },
      DELETE_PREVIEW_CONTEXT_KEY,
    );
    return () => {
      deletePreviewActiveRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !api || readOnly || !enabled) {
      return;
    }

    const languageId = monacoLanguageId(relativePath);
    const deletePreviewActiveKey = deletePreviewActiveRef.current;
    if (!deletePreviewActiveKey) {
      return;
    }

    const clearInlineGhostCache = () => {
      cacheRef.current = null;
    };

    const clearDeletePreview = () => {
      const state = deletePreviewRef.current;
      if (state) {
        state.decorations.clear();
        if (state.widget) {
          editor.removeContentWidget(state.widget);
        }
        deletePreviewRef.current = null;
      }
      deletePreviewActiveKey.set(false);
    };

    const clearAllPreviews = () => {
      clearInlineGhostCache();
      clearDeletePreview();
    };

    const showDeletePreview = (spec: InlineDeleteDiffPreviewSpec) => {
      clearAllPreviews();
      const decorations = editor.createDecorationsCollection([deletePreviewDecoration(spec)]);
      let widget: DeleteDiffPreviewWidget | null = null;
      if (spec.previewText.length > 0) {
        widget = new DeleteDiffPreviewWidget(editor, spec);
        editor.addContentWidget(widget);
      }
      deletePreviewRef.current = { spec, decorations, widget };
      deletePreviewActiveKey.set(true);
    };

    const acceptDeletePreview = () => {
      const state = deletePreviewRef.current;
      if (!state) {
        return;
      }
      applyDeletePreviewEdit(editor, state.spec);
      clearDeletePreview();
    };
    acceptDeletePreviewRef.current = acceptDeletePreview;

    const executeFetch = async (
      requestPosition: monaco.Position,
      model: monaco.editor.ITextModel,
    ) => {
      const fetchToken = ++fetchTokenRef.current;
      await api.abortCodeCompletion();
      if (fetchToken !== fetchTokenRef.current) {
        return;
      }

      try {
        const result = await api.requestCodeCompletion({
          relativePath: relativePathRef.current,
          languageId,
          documentText: model.getValue(),
          cursorLine: requestPosition.lineNumber,
          cursorColumn: requestPosition.column,
        });

        if (fetchToken !== fetchTokenRef.current) {
          return;
        }

        const editorPosition = editor.getPosition();
        if (!editorPosition || !positionsEqual(editorPosition, requestPosition)) {
          return;
        }

        const operation = result.operations[0];
        if (!operation) {
          clearAllPreviews();
          return;
        }

        if (operation.kind === "delete") {
          const deleteSpec = codeCompletionOperationToDeleteDiffPreviewAtCursor(
            operation as CodeCompletionOperation,
            {
              documentText: model.getValue(),
              cursorLine: requestPosition.lineNumber,
              cursorColumn: requestPosition.column,
            },
          );
          if (!deleteSpec) {
            clearAllPreviews();
            return;
          }
          showDeletePreview(deleteSpec);
          return;
        }

        clearDeletePreview();
        const item = toInlineItem(operation, model, requestPosition);
        if (!item) {
          clearInlineGhostCache();
          return;
        }

        cacheRef.current = {
          line: requestPosition.lineNumber,
          column: requestPosition.column,
          items: [item],
        };
        editor.trigger(null, "editor.action.inlineSuggest.trigger", {});
      } catch (error) {
        if (!isMonacoCanceled(error)) {
          console.warn("[code-completion] fetch failed:", error);
        }
      }
    };

    const drainFetchQueue = async () => {
      if (fetchInFlightRef.current) {
        return;
      }
      const pending = pendingFetchRef.current;
      if (!pending) {
        return;
      }
      pendingFetchRef.current = null;
      fetchInFlightRef.current = true;
      try {
        await executeFetch(pending.position, pending.model);
      } finally {
        fetchInFlightRef.current = false;
        if (pendingFetchRef.current) {
          void drainFetchQueue();
        }
      }
    };

    const scheduleFetch = (position: monaco.Position, model: monaco.editor.ITextModel) => {
      const target = { line: position.lineNumber, column: position.column };
      const alreadyScheduled =
        scheduledTargetRef.current?.line === target.line &&
        scheduledTargetRef.current?.column === target.column &&
        (debounceTimerRef.current !== undefined || fetchInFlightRef.current);
      if (alreadyScheduled) {
        return;
      }

      scheduledTargetRef.current = target;
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = undefined;
        pendingFetchRef.current = { position, model };
        if (fetchInFlightRef.current) {
          fetchTokenRef.current += 1;
          void api.abortCodeCompletion();
        }
        void drainFetchQueue();
      }, COMPLETION_DEBOUNCE_MS);
    };

    const provider = monaco.languages.registerInlineCompletionsProvider(languageId, {
      provideInlineCompletions: (model, position) => {
        if (model !== editor.getModel()) {
          return { items: [] };
        }
        const cache = cacheRef.current;
        if (cache && cache.line === position.lineNumber && cache.column === position.column) {
          return { items: cache.items, enableForwardStability: true };
        }

        return { items: [] };
      },
      freeInlineCompletions: () => {},
    });

    const contentDisposable = editor.onDidChangeModelContent(() => {
      const position = editor.getPosition();
      const model = editor.getModel();
      if (!position || !model) {
        return;
      }
      lastContentChangeAtRef.current = Date.now();
      clearAllPreviews();
      scheduledTargetRef.current = null;
      scheduleFetch(position, model);
    });

    const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
      if (Date.now() - lastContentChangeAtRef.current < CURSOR_AFTER_CONTENT_GRACE_MS) {
        return;
      }
      const model = editor.getModel();
      if (!model) {
        return;
      }
      clearAllPreviews();
      scheduledTargetRef.current = null;
      scheduleFetch(event.position, model);
    });

    return () => {
      acceptDeletePreviewRef.current = null;
      contentDisposable.dispose();
      cursorDisposable.dispose();
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = undefined;
      }
      provider.dispose();
      fetchTokenRef.current += 1;
      pendingFetchRef.current = null;
      fetchInFlightRef.current = false;
      scheduledTargetRef.current = null;
      clearAllPreviews();
      void api.abortCodeCompletion();
    };
  }, [api, editor, enabled, readOnly, relativePath]);

  useEffect(() => {
    if (!editor || !api || readOnly || !enabled) {
      return;
    }

    let journalTimer: ReturnType<typeof setTimeout> | undefined;
    const disposable = editor.onDidChangeModelContent(() => {
      if (journalTimer !== undefined) {
        clearTimeout(journalTimer);
      }
      journalTimer = setTimeout(() => {
        void api.recordCodeCompletionFileState({
          relativePath: relativePathRef.current,
          baselineText: baselineRef.current,
          currentText: editor.getValue(),
        });
      }, JOURNAL_DEBOUNCE_MS);
    });

    return () => {
      if (journalTimer !== undefined) {
        clearTimeout(journalTimer);
      }
      disposable.dispose();
    };
  }, [api, editor, enabled, readOnly]);
}
