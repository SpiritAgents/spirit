import { selectAllTextInElement } from "@/lib/contained-text-selection";
import {
  classifyEditFocus,
  deriveEditCommandState,
  DISABLED_EDIT_COMMAND_STATE,
  type EditCommand,
  type EditCommandSource,
  type EditCommandState,
  type EditFocusProbe,
} from "@/lib/edit-command-state";
import { readPlainSelectionText } from "@/lib/pr-diff-selection";

const COMPOSER_SURFACE_SELECTOR = "[data-spirit-surface='composer-surface']";
const TERMINAL_SURFACE_SELECTOR = ".workspace-terminal-xterm, .shell-tool-xterm, .xterm";
const MONACO_SURFACE_SELECTOR = ".monaco-editor";

const TEXTUAL_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "url",
  "tel",
  "password",
  "email",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

export type RegisteredEditAdapter = {
  kind: "lexical" | "monaco" | "terminal";
  root: HTMLElement;
  hasTextFocus?: () => boolean;
  query: () => Pick<EditCommandSource, "editable" | "canUndo" | "canRedo" | "hasSelection">;
  dispatch: (command: EditCommand) => void;
};

export type ResolvedEditTarget =
  | { kind: "none" }
  | { kind: "native"; element: HTMLElement }
  | { kind: "readonly"; root: HTMLElement | null }
  | { kind: "lexical"; adapter: RegisteredEditAdapter }
  | { kind: "monaco"; adapter: RegisteredEditAdapter }
  | { kind: "terminal"; adapter: RegisteredEditAdapter };

const adapters = new Set<RegisteredEditAdapter>();
const changeListeners = new Set<() => void>();

export function subscribeEditCommandTargetsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function notifyEditCommandTargetsChanged(): void {
  for (const listener of changeListeners) {
    listener();
  }
}

export function registerEditCommandTarget(adapter: RegisteredEditAdapter): () => void {
  adapters.add(adapter);
  notifyEditCommandTargetsChanged();
  return () => {
    adapters.delete(adapter);
    notifyEditCommandTargetsChanged();
  };
}

export function resetEditCommandTargetsForTests(): void {
  adapters.clear();
  changeListeners.clear();
}

export function readEditClipboardText(): string {
  try {
    const text = window.spiritDesktop?.readClipboardText?.();
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

export function writeEditClipboardText(text: string): void {
  const bridge = window.spiritDesktop;
  if (bridge?.writeClipboardText) {
    bridge.writeClipboardText(text);
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

export function readEditClipboardHasText(): boolean {
  return readEditClipboardText().length > 0;
}

export function isNativeTextEditableElement(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }
  if (element.closest(COMPOSER_SURFACE_SELECTOR)) {
    return false;
  }
  if (element.closest(MONACO_SURFACE_SELECTOR) || element.closest(TERMINAL_SURFACE_SELECTOR)) {
    return false;
  }
  if (element.tagName === "TEXTAREA") {
    const textarea = element as HTMLTextAreaElement;
    return !textarea.readOnly && !textarea.disabled;
  }
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (!TEXTUAL_INPUT_TYPES.has(input.type)) {
      return false;
    }
    return !input.readOnly && !input.disabled;
  }
  return element.isContentEditable;
}

function asHtmlElement(node: Node | null): HTMLElement | null {
  if (node instanceof HTMLElement) {
    return node;
  }
  return node?.parentElement ?? null;
}

function findAdapter(
  kind: RegisteredEditAdapter["kind"],
  node: Node | null,
): RegisteredEditAdapter | undefined {
  if (!node) {
    return undefined;
  }
  for (const adapter of adapters) {
    if (adapter.kind === kind && adapter.root.contains(node)) {
      return adapter;
    }
  }
  return undefined;
}

function hasReadonlyCopyableSelection(selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || !readPlainSelectionText(selection)) {
    return false;
  }
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = asHtmlElement(node);
    if (!element) {
      continue;
    }
    if (element.closest(COMPOSER_SURFACE_SELECTOR)) {
      return false;
    }
    if (element.closest(MONACO_SURFACE_SELECTOR) || element.closest(TERMINAL_SURFACE_SELECTOR)) {
      return false;
    }
    if (isNativeTextEditableElement(element) || element.closest('[contenteditable="true"]')) {
      return false;
    }
  }
  return true;
}

function readonlySelectionRoot(selection: Selection | null): HTMLElement | null {
  const node = selection?.anchorNode ?? null;
  return asHtmlElement(node);
}

export function probeEditFocus(
  activeElement: Element | null,
  selection: Selection | null,
): EditFocusProbe {
  const active = activeElement instanceof HTMLElement ? activeElement : null;
  const monacoAdapter = findAdapter("monaco", active);
  const lexicalAdapter = findAdapter("lexical", active);
  const terminalAdapter = findAdapter("terminal", active);

  return {
    monacoFocused: Boolean(monacoAdapter && (monacoAdapter.hasTextFocus?.() ?? true)),
    composerFocused: Boolean(lexicalAdapter),
    nativeEditableFocused: isNativeTextEditableElement(active),
    terminalFocused: Boolean(
      terminalAdapter || Boolean(active?.closest(TERMINAL_SURFACE_SELECTOR)),
    ),
    readonlyCopyableSelection: hasReadonlyCopyableSelection(selection),
  };
}

export function resolveFocusedEditTarget(
  activeElement: Element | null = typeof document === "undefined" ? null : document.activeElement,
  selection: Selection | null = typeof window === "undefined" ? null : window.getSelection(),
): ResolvedEditTarget {
  const kind = classifyEditFocus(probeEditFocus(activeElement, selection));
  const active = activeElement instanceof HTMLElement ? activeElement : null;

  if (kind === "monaco") {
    const adapter = findAdapter("monaco", active);
    return adapter ? { kind: "monaco", adapter } : { kind: "none" };
  }
  if (kind === "lexical") {
    const adapter = findAdapter("lexical", active);
    return adapter ? { kind: "lexical", adapter } : { kind: "none" };
  }
  if (kind === "native") {
    return active ? { kind: "native", element: active } : { kind: "none" };
  }
  if (kind === "terminal") {
    const adapter = findAdapter("terminal", active);
    return adapter ? { kind: "terminal", adapter } : { kind: "none" };
  }
  if (kind === "readonly") {
    return { kind: "readonly", root: readonlySelectionRoot(selection) };
  }
  return { kind: "none" };
}

function queryCommandEnabled(command: "undo" | "redo"): boolean {
  if (typeof document === "undefined" || typeof document.queryCommandEnabled !== "function") {
    return false;
  }
  try {
    return document.queryCommandEnabled(command);
  } catch {
    return false;
  }
}

function nativeHasSelection(element: HTMLElement, selection: Selection | null): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    return start != null && end != null && start !== end;
  }
  if (!selection || selection.isCollapsed) {
    return false;
  }
  return Boolean(
    (selection.anchorNode && element.contains(selection.anchorNode)) ||
    (selection.focusNode && element.contains(selection.focusNode)),
  );
}

function queryNativeSource(
  element: HTMLElement,
  selection: Selection | null,
  clipboardHasText: boolean,
): EditCommandSource {
  return {
    kind: "native",
    editable: isNativeTextEditableElement(element),
    canUndo: queryCommandEnabled("undo"),
    canRedo: queryCommandEnabled("redo"),
    hasSelection: nativeHasSelection(element, selection),
    clipboardHasText,
  };
}

export function queryFocusedEditCommandSource(options?: {
  clipboardHasText?: boolean;
  activeElement?: Element | null;
  selection?: Selection | null;
}): EditCommandSource {
  const clipboardHasText = options?.clipboardHasText ?? readEditClipboardHasText();
  const activeElement =
    options?.activeElement === undefined
      ? typeof document === "undefined"
        ? null
        : document.activeElement
      : options.activeElement;
  const selection =
    options?.selection === undefined
      ? typeof window === "undefined"
        ? null
        : window.getSelection()
      : options.selection;
  const target = resolveFocusedEditTarget(activeElement, selection);

  if (target.kind === "none") {
    return {
      kind: "none",
      editable: false,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      clipboardHasText,
    };
  }

  if (target.kind === "native") {
    return queryNativeSource(target.element, selection, clipboardHasText);
  }

  if (target.kind === "readonly") {
    return {
      kind: "readonly",
      editable: false,
      canUndo: false,
      canRedo: false,
      hasSelection: Boolean(
        selection && !selection.isCollapsed && readPlainSelectionText(selection),
      ),
      clipboardHasText,
    };
  }

  const queried = target.adapter.query();
  return {
    kind: target.kind,
    clipboardHasText,
    ...queried,
  };
}

export function queryFocusedEditCommandState(options?: {
  clipboardHasText?: boolean;
  activeElement?: Element | null;
  selection?: Selection | null;
}): EditCommandState {
  return deriveEditCommandState(queryFocusedEditCommandSource(options));
}

function tryExecCommand(command: string, value?: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

function replaceNativeTextSelection(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;
  const next = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
  const cursor = start + text.length;
  element.focus();
  if (typeof element.setRangeText === "function") {
    element.setRangeText(text, start, end, "end");
  } else {
    element.value = next;
    element.setSelectionRange(cursor, cursor);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchNativeEditCommand(element: HTMLElement, command: EditCommand): void {
  element.focus();
  if (command === "undo" || command === "redo") {
    tryExecCommand(command);
    return;
  }
  if (command === "selectAll") {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.select();
      return;
    }
    tryExecCommand("selectAll");
    return;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    const selected = element.value.slice(start, end);
    if (command === "copy") {
      if (!tryExecCommand("copy")) {
        writeEditClipboardText(selected);
      }
      return;
    }
    if (command === "cut") {
      if (!tryExecCommand("cut")) {
        writeEditClipboardText(selected);
        replaceNativeTextSelection(element, "");
      }
      return;
    }
    if (command === "paste") {
      if (!tryExecCommand("paste")) {
        replaceNativeTextSelection(element, readEditClipboardText());
      }
    }
    return;
  }

  if (command === "copy" || command === "cut") {
    const selected = window.getSelection()?.toString() ?? "";
    if (!tryExecCommand(command)) {
      writeEditClipboardText(selected);
      if (command === "cut") {
        tryExecCommand("delete");
      }
    }
    return;
  }
  if (command === "paste") {
    const text = readEditClipboardText();
    if (!tryExecCommand("paste")) {
      tryExecCommand("insertText", text);
    }
  }
}

function dispatchReadonlyEditCommand(root: HTMLElement | null, command: EditCommand): void {
  if (command === "copy") {
    const selected = window.getSelection()?.toString() ?? "";
    if (!tryExecCommand("copy")) {
      writeEditClipboardText(selected);
    }
    return;
  }
  if (command === "selectAll" && root) {
    selectAllTextInElement(root);
  }
}

export function dispatchEditCommand(command: EditCommand): boolean {
  const target = resolveFocusedEditTarget();
  if (target.kind === "none") {
    return false;
  }
  if (target.kind === "native") {
    dispatchNativeEditCommand(target.element, command);
    return true;
  }
  if (target.kind === "readonly") {
    dispatchReadonlyEditCommand(target.root, command);
    return command === "copy" || command === "selectAll";
  }
  target.adapter.dispatch(command);
  return true;
}

export function emptyEditCommandState(): EditCommandState {
  return { ...DISABLED_EDIT_COMMAND_STATE };
}
