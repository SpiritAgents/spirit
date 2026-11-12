import assert from "node:assert/strict";
import { test } from "vitest";

import {
  classifyEditFocus,
  deriveEditCommandState,
  DISABLED_EDIT_COMMAND_STATE,
  editCommandDisabled,
  editCommandStateKey,
  isEditCommand,
  parseEditCommandState,
} from "../../src/lib/edit-command-state.ts";

const emptyProbe = {
  monacoFocused: false,
  composerFocused: false,
  nativeEditableFocused: false,
  terminalFocused: false,
  readonlyCopyableSelection: false,
};

const editableSource = {
  editable: true,
  canUndo: true,
  canRedo: true,
  hasSelection: true,
  clipboardHasText: true,
  clipboardHasImage: false,
  clipboardHasFile: false,
};

test("parseEditCommandState accepts a complete flag object", () => {
  const state = {
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: false,
    canSelectAll: true,
    canDictate: true,
  };
  assert.deepEqual(parseEditCommandState(state), state);
  assert.equal(parseEditCommandState({ ...state, canUndo: "yes" }), null);
  assert.equal(parseEditCommandState(null), null);
});

test("editCommandDisabled mirrors each can* flag for the title-bar menu", () => {
  const state = {
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: false,
    canPaste: true,
    canSelectAll: false,
    canDictate: true,
  };
  assert.equal(editCommandDisabled(state, "undo"), false);
  assert.equal(editCommandDisabled(state, "redo"), true);
  assert.equal(editCommandDisabled(state, "cut"), false);
  assert.equal(editCommandDisabled(state, "copy"), true);
  assert.equal(editCommandDisabled(state, "paste"), false);
  assert.equal(editCommandDisabled(state, "selectAll"), true);
});

test("isEditCommand accepts only the six menu commands", () => {
  assert.equal(isEditCommand("undo"), true);
  assert.equal(isEditCommand("selectAll"), true);
  assert.equal(isEditCommand("cut"), true);
  assert.equal(isEditCommand("unknown"), false);
  assert.equal(isEditCommand(null), false);
});

test("editCommandStateKey is stable for identical flags", () => {
  assert.equal(
    editCommandStateKey(DISABLED_EDIT_COMMAND_STATE),
    editCommandStateKey({
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
      canDictate: false,
    }),
  );
  assert.notEqual(
    editCommandStateKey(DISABLED_EDIT_COMMAND_STATE),
    editCommandStateKey({ ...DISABLED_EDIT_COMMAND_STATE, canCopy: true }),
  );
});

test("classifyEditFocus uses a single priority path", () => {
  assert.equal(classifyEditFocus(emptyProbe), "none");
  assert.equal(classifyEditFocus({ ...emptyProbe, monacoFocused: true }), "monaco");
  assert.equal(
    classifyEditFocus({
      ...emptyProbe,
      monacoFocused: true,
      composerFocused: true,
      nativeEditableFocused: true,
    }),
    "monaco",
  );
  assert.equal(classifyEditFocus({ ...emptyProbe, composerFocused: true }), "lexical");
  assert.equal(
    classifyEditFocus({
      ...emptyProbe,
      composerFocused: true,
      nativeEditableFocused: true,
      terminalFocused: true,
    }),
    "lexical",
  );
  assert.equal(classifyEditFocus({ ...emptyProbe, nativeEditableFocused: true }), "native");
  assert.equal(
    classifyEditFocus({
      ...emptyProbe,
      nativeEditableFocused: true,
      terminalFocused: true,
      readonlyCopyableSelection: true,
    }),
    "native",
  );
  assert.equal(classifyEditFocus({ ...emptyProbe, terminalFocused: true }), "terminal");
  assert.equal(
    classifyEditFocus({
      ...emptyProbe,
      terminalFocused: true,
      readonlyCopyableSelection: true,
    }),
    "terminal",
  );
  assert.equal(classifyEditFocus({ ...emptyProbe, readonlyCopyableSelection: true }), "readonly");
});

test("deriveEditCommandState disables every command when there is no target", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "none",
      ...editableSource,
    }),
    DISABLED_EDIT_COMMAND_STATE,
  );
});

test("deriveEditCommandState enables undo redo cut copy paste for an editable editor", () => {
  for (const kind of ["lexical", "monaco", "native"]) {
    assert.deepEqual(deriveEditCommandState({ kind, ...editableSource }), {
      canUndo: true,
      canRedo: true,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
      canDictate: true,
    });
  }
});

test("deriveEditCommandState requires history before undo or redo", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "lexical",
      editable: true,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      clipboardHasText: true,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: true,
      canSelectAll: true,
      canDictate: true,
    },
  );
});

test("deriveEditCommandState enables composer paste for image and file clipboards", () => {
  const base = {
    editable: true,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    clipboardHasText: false,
  };
  assert.equal(
    deriveEditCommandState({
      kind: "lexical",
      ...base,
      clipboardHasImage: true,
      clipboardHasFile: false,
    }).canPaste,
    true,
  );
  assert.equal(
    deriveEditCommandState({
      kind: "lexical",
      ...base,
      clipboardHasImage: false,
      clipboardHasFile: true,
    }).canPaste,
    true,
  );
  assert.equal(
    deriveEditCommandState({
      kind: "lexical",
      ...base,
      editable: false,
      clipboardHasImage: true,
      clipboardHasFile: true,
    }).canPaste,
    false,
  );
});

test("deriveEditCommandState keeps non-composer targets text-only for paste", () => {
  const base = {
    editable: true,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    clipboardHasText: false,
    clipboardHasImage: true,
    clipboardHasFile: true,
  };
  for (const kind of ["monaco", "native", "terminal"]) {
    assert.equal(deriveEditCommandState({ kind, ...base }).canPaste, false);
  }
});

test("deriveEditCommandState requires a selection for cut and copy", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "monaco",
      editable: true,
      canUndo: true,
      canRedo: false,
      hasSelection: false,
      clipboardHasText: false,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: true,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: true,
      canDictate: true,
    },
  );
});

test("deriveEditCommandState disables cut and paste when the target is read-only", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "monaco",
      editable: false,
      canUndo: true,
      canRedo: true,
      hasSelection: true,
      clipboardHasText: true,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: true,
      canPaste: false,
      canSelectAll: true,
      canDictate: false,
    },
  );
});

test("deriveEditCommandState treats readonly surfaces as copy-only", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "readonly",
      ...editableSource,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: true,
      canPaste: false,
      canSelectAll: true,
      canDictate: false,
    },
  );
  assert.deepEqual(
    deriveEditCommandState({
      kind: "readonly",
      editable: false,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      clipboardHasText: true,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: true,
      canDictate: false,
    },
  );
});

test("deriveEditCommandState treats terminals as copy and paste only", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "terminal",
      editable: true,
      canUndo: true,
      canRedo: true,
      hasSelection: true,
      clipboardHasText: true,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
      canDictate: true,
    },
  );
  assert.deepEqual(
    deriveEditCommandState({
      kind: "terminal",
      editable: true,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      clipboardHasText: false,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: true,
      canDictate: true,
    },
  );
});

test("deriveEditCommandState disables paste and dictation for a read-only terminal", () => {
  assert.deepEqual(
    deriveEditCommandState({
      kind: "terminal",
      editable: false,
      canUndo: false,
      canRedo: false,
      hasSelection: true,
      clipboardHasText: true,
      clipboardHasImage: false,
      clipboardHasFile: false,
    }),
    {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: true,
      canPaste: false,
      canSelectAll: true,
      canDictate: false,
    },
  );
});
