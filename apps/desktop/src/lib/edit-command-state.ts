export const EDIT_COMMANDS = ["undo", "redo", "cut", "copy", "paste", "selectAll"] as const;

export type EditCommand = (typeof EDIT_COMMANDS)[number];

export type EditCommandState = {
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
  canDictate: boolean;
};

export type EditCommandSourceKind =
  | "none"
  | "lexical"
  | "monaco"
  | "native"
  | "terminal"
  | "readonly";

export type EditCommandSource = {
  kind: EditCommandSourceKind;
  editable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  clipboardHasText: boolean;
};

export type EditFocusProbe = {
  monacoFocused: boolean;
  composerFocused: boolean;
  nativeEditableFocused: boolean;
  terminalFocused: boolean;
  readonlyCopyableSelection: boolean;
};

export const DISABLED_EDIT_COMMAND_STATE: EditCommandState = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canSelectAll: false,
  canDictate: false,
};

export const EDIT_MENU_ITEM_IDS = {
  undo: "edit-undo",
  redo: "edit-redo",
  cut: "edit-cut",
  copy: "edit-copy",
  paste: "edit-paste",
  selectAll: "edit-select-all",
} as const;

export function isEditCommand(value: unknown): value is EditCommand {
  return typeof value === "string" && (EDIT_COMMANDS as readonly string[]).includes(value);
}

function isBooleanFlag(value: unknown): value is boolean {
  return value === true || value === false;
}

export function parseEditCommandState(value: unknown): EditCommandState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isBooleanFlag(record.canUndo) ||
    !isBooleanFlag(record.canRedo) ||
    !isBooleanFlag(record.canCut) ||
    !isBooleanFlag(record.canCopy) ||
    !isBooleanFlag(record.canPaste) ||
    !isBooleanFlag(record.canSelectAll) ||
    !isBooleanFlag(record.canDictate)
  ) {
    return null;
  }
  return {
    canUndo: record.canUndo,
    canRedo: record.canRedo,
    canCut: record.canCut,
    canCopy: record.canCopy,
    canPaste: record.canPaste,
    canSelectAll: record.canSelectAll,
    canDictate: record.canDictate,
  };
}

export function editCommandStateKey(state: EditCommandState): string {
  return [
    state.canUndo ? "1" : "0",
    state.canRedo ? "1" : "0",
    state.canCut ? "1" : "0",
    state.canCopy ? "1" : "0",
    state.canPaste ? "1" : "0",
    state.canSelectAll ? "1" : "0",
    state.canDictate ? "1" : "0",
  ].join("");
}

/** Single-path focus classifier: first matching probe wins, no fallback stacking. */
export function classifyEditFocus(probe: EditFocusProbe): EditCommandSourceKind {
  if (probe.monacoFocused) {
    return "monaco";
  }
  if (probe.composerFocused) {
    return "lexical";
  }
  if (probe.nativeEditableFocused) {
    return "native";
  }
  if (probe.terminalFocused) {
    return "terminal";
  }
  if (probe.readonlyCopyableSelection) {
    return "readonly";
  }
  return "none";
}

export function editCommandDisabled(state: EditCommandState, command: EditCommand): boolean {
  switch (command) {
    case "undo":
      return !state.canUndo;
    case "redo":
      return !state.canRedo;
    case "cut":
      return !state.canCut;
    case "copy":
      return !state.canCopy;
    case "paste":
      return !state.canPaste;
    case "selectAll":
      return !state.canSelectAll;
  }
}

export function deriveEditCommandState(source: EditCommandSource): EditCommandState {
  if (source.kind === "none") {
    return { ...DISABLED_EDIT_COMMAND_STATE };
  }

  if (source.kind === "readonly") {
    return {
      ...DISABLED_EDIT_COMMAND_STATE,
      canCopy: source.hasSelection,
      canSelectAll: true,
    };
  }

  if (source.kind === "terminal") {
    return {
      ...DISABLED_EDIT_COMMAND_STATE,
      canCopy: source.hasSelection,
      canPaste: source.editable && source.clipboardHasText,
      canSelectAll: true,
      canDictate: source.editable,
    };
  }

  return {
    canUndo: source.editable && source.canUndo,
    canRedo: source.editable && source.canRedo,
    canCut: source.editable && source.hasSelection,
    canCopy: source.hasSelection,
    canPaste: source.editable && source.clipboardHasText,
    canSelectAll: true,
    canDictate: source.editable,
  };
}
