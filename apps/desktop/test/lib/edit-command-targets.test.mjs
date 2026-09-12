/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  dispatchEditCommand,
  queryFocusedEditCommandState,
  registerEditCommandTarget,
  resetEditCommandTargetsForTests,
  resolveFocusedEditTarget,
} from "../../src/lib/edit-command-targets.ts";

afterEach(() => {
  resetEditCommandTargetsForTests();
  document.body.replaceChildren();
});

test("resolveFocusedEditTarget returns none without a focused adapter", () => {
  assert.deepEqual(resolveFocusedEditTarget(document.body, window.getSelection()), {
    kind: "none",
  });
});

test("resolveFocusedEditTarget prefers a focused monaco adapter", () => {
  const root = document.createElement("div");
  root.className = "monaco-editor";
  const textarea = document.createElement("textarea");
  root.append(textarea);
  document.body.append(root);
  textarea.focus();

  let dispatched = "";
  registerEditCommandTarget({
    kind: "monaco",
    root,
    hasTextFocus: () => true,
    query: () => ({
      editable: true,
      canUndo: true,
      canRedo: false,
      hasSelection: true,
    }),
    dispatch: (command) => {
      dispatched = command;
    },
  });

  const target = resolveFocusedEditTarget(document.activeElement, window.getSelection());
  assert.equal(target.kind, "monaco");
  assert.deepEqual(queryFocusedEditCommandState({ clipboardHasText: true }), {
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canSelectAll: true,
    canDictate: true,
  });
  assert.equal(dispatchEditCommand("undo"), true);
  assert.equal(dispatched, "undo");
});

test("resolveFocusedEditTarget routes composer contenteditable to a lexical adapter", () => {
  const surface = document.createElement("div");
  surface.dataset.spiritSurface = "composer-surface";
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  surface.append(editable);
  document.body.append(surface);

  registerEditCommandTarget({
    kind: "lexical",
    root: surface,
    query: () => ({
      editable: true,
      canUndo: false,
      canRedo: true,
      hasSelection: false,
    }),
    dispatch: () => {},
  });

  assert.equal(resolveFocusedEditTarget(editable, window.getSelection()).kind, "lexical");
  assert.deepEqual(
    queryFocusedEditCommandState({ clipboardHasText: false, activeElement: editable }),
    {
      canUndo: false,
      canRedo: true,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: true,
      canDictate: true,
    },
  );
});

test("dispatchEditCommand uses the last focused adapter after the menu steals focus", () => {
  const root = document.createElement("div");
  root.className = "monaco-editor";
  const textarea = document.createElement("textarea");
  root.append(textarea);
  document.body.append(root);
  textarea.focus();

  let dispatched = "";
  registerEditCommandTarget({
    kind: "monaco",
    root,
    hasTextFocus: () => document.activeElement === textarea,
    query: () => ({
      editable: true,
      canUndo: true,
      canRedo: false,
      hasSelection: true,
    }),
    dispatch: (command) => {
      dispatched = command;
    },
  });

  queryFocusedEditCommandState({ clipboardHasText: true });
  const decoy = document.createElement("button");
  document.body.append(decoy);
  decoy.focus();

  assert.equal(
    resolveFocusedEditTarget(document.activeElement, window.getSelection()).kind,
    "none",
  );
  assert.equal(dispatchEditCommand("copy"), true);
  assert.equal(dispatched, "copy");
});

test("resolveFocusedEditTarget treats a focused textual input as native", () => {
  const input = document.createElement("input");
  input.type = "text";
  document.body.append(input);
  input.focus();
  input.value = "hello";
  input.setSelectionRange(0, 5);

  assert.equal(
    resolveFocusedEditTarget(document.activeElement, window.getSelection()).kind,
    "native",
  );
  const state = queryFocusedEditCommandState({ clipboardHasText: true });
  assert.equal(state.canCopy, true);
  assert.equal(state.canCut, true);
  assert.equal(state.canPaste, true);
  assert.equal(state.canSelectAll, true);
  assert.equal(state.canDictate, true);
});
