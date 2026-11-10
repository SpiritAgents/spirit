export type PrDiffLineRange = {
  lineStart: number;
  lineEnd: number;
};

export const UNIFIED_DIFF_LINE_CLASS = "unified-diff-line";
export const UNIFIED_DIFF_GUTTER_CLASS = "unified-diff-gutter";
export const UNIFIED_DIFF_CODE_CLASS = "unified-diff-code";

const ELEMENT_NODE = 1;

function isHtmlElement(node: unknown): node is HTMLElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "nodeType" in node &&
    (node as { nodeType: number }).nodeType === ELEMENT_NODE &&
    "classList" in node
  );
}

export function findChangedFileFromNode(node: Node | null, root: HTMLElement): string | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (isHtmlElement(current)) {
      const filename = current.dataset.prChangedFile;
      if (filename) {
        return filename;
      }
    }
    current = current.parentNode;
  }
  return null;
}

export function resolveChangedFileFromSelection(
  selection: Selection,
  root: HTMLElement,
): string | null {
  const anchorFile = findChangedFileFromNode(selection.anchorNode, root);
  const focusFile = findChangedFileFromNode(selection.focusNode, root);
  if (!anchorFile || !focusFile || anchorFile !== focusFile) {
    return null;
  }
  return anchorFile;
}

export function isNodeInUnifiedDiffCode(node: Node | null, diffRoot: HTMLElement): boolean {
  let current: Node | null = node;
  while (current && current !== diffRoot) {
    if (isHtmlElement(current) && current.classList.contains(UNIFIED_DIFF_CODE_CLASS)) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function parseGutterLineNumber(gutter: Element): number | null {
  const text = gutter.textContent?.trim() ?? "";
  if (!text || !/^\d+$/u.test(text)) {
    return null;
  }
  return Number(text);
}

function diffLineFromNode(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (isHtmlElement(current) && current.classList.contains(UNIFIED_DIFF_LINE_CLASS)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function collectDiffLinesForSelection(root: HTMLElement, selection: Selection): HTMLElement[] {
  const range = selection.getRangeAt(0);
  const rows = new Set<HTMLElement>();
  for (const row of collectDiffLinesInRange(range, root)) {
    rows.add(row);
  }
  const startRow = diffLineFromNode(range.startContainer);
  const endRow = diffLineFromNode(range.endContainer);
  if (startRow) {
    rows.add(startRow);
  }
  if (endRow) {
    rows.add(endRow);
  }
  return [...rows];
}

function lineNumberFromDiffRow(row: HTMLElement): number | null {
  const gutter = row.querySelector(`.${UNIFIED_DIFF_GUTTER_CLASS}`);
  if (!gutter) {
    return null;
  }
  return parseGutterLineNumber(gutter);
}

function collectDiffLinesInRange(range: Range, root: HTMLElement): HTMLElement[] {
  const rows = Array.from(root.querySelectorAll(`div.${UNIFIED_DIFF_LINE_CLASS}`)).filter(
    isHtmlElement,
  );
  return rows.filter((row) => {
    try {
      return range.intersectsNode(row);
    } catch {
      return false;
    }
  });
}

/** Resolve unified diff gutter line numbers for the current DOM selection. */
export function resolveDiffSelectionLineRange(
  root: HTMLElement,
  selection: Selection | null,
): PrDiffLineRange | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const rows = collectDiffLinesForSelection(root, selection);
  const lineNumbers = rows
    .map((row) => lineNumberFromDiffRow(row))
    .filter((value): value is number => value != null);

  if (lineNumbers.length > 0) {
    return {
      lineStart: Math.min(...lineNumbers),
      lineEnd: Math.max(...lineNumbers),
    };
  }

  const startRow = diffLineFromNode(range.startContainer);
  const endRow = diffLineFromNode(range.endContainer);
  const fallback = [startRow, endRow]
    .filter((row): row is HTMLElement => row != null)
    .map((row) => lineNumberFromDiffRow(row))
    .filter((value): value is number => value != null);

  if (fallback.length === 0) {
    return null;
  }

  return {
    lineStart: Math.min(...fallback),
    lineEnd: Math.max(...fallback),
  };
}

export function readPlainSelectionText(selection: Selection | null): string {
  if (!selection) {
    return "";
  }
  const text = selection.toString();
  return /^\s*$/u.test(text) ? "" : text;
}

export function readDiffSelectionText(selection: Selection | null): string {
  return readPlainSelectionText(selection);
}
