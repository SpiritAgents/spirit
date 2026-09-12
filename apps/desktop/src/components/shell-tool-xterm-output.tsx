import { useEffect, useLayoutEffect, useRef } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

import {
  notifyEditCommandTargetsChanged,
  registerEditCommandTarget,
  writeEditClipboardText,
} from "@/lib/edit-command-targets";
import { readShellToolMonochromeTheme, stripAnsiSgrSequences } from "@/lib/shell-tool-xterm-theme";
import { cn } from "@/lib/utils";

/** Matches the tool card's `font-mono text-xs leading-relaxed`. */
const SHELL_TOOL_XTERM_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const SHELL_TOOL_XTERM_FONT_SIZE = 12;
const SHELL_TOOL_XTERM_LINE_HEIGHT = 1.625;
/** max-h-96 */
const SHELL_TOOL_XTERM_MAX_HEIGHT_PX = 384;
const SHELL_TOOL_XTERM_MIN_HEIGHT_PX = 96;
const SHELL_TOOL_XTERM_SCROLLBACK = 50_000;
/**
 * Display buffer cap (characters): roughly on the order of scrollback × column width, avoiding a
 * full re-scan on every streaming chunk and unbounded string retention.
 * The host-side stdout collection is separately capped at 8MiB; the streaming chunk path can be
 * longer, so the UI keeps only the tail.
 */
const SHELL_TOOL_XTERM_DISPLAY_MAX_CHARS = 512 * 1024;

export type ShellToolXtermOutputProps = {
  text: string;
  followTail?: boolean;
  className?: string;
};

function rowHeightPx(term: Terminal): number {
  const rowsEl = term.element?.querySelector(".xterm-rows");
  const cellHeight = rowsEl instanceof HTMLElement ? rowsEl.clientHeight : 0;
  if (cellHeight > 0 && term.rows > 0) {
    return cellHeight / term.rows;
  }
  return SHELL_TOOL_XTERM_FONT_SIZE * SHELL_TOOL_XTERM_LINE_HEIGHT;
}

function clampHeightPx(height: number): number {
  return Math.min(
    SHELL_TOOL_XTERM_MAX_HEIGHT_PX,
    Math.max(SHELL_TOOL_XTERM_MIN_HEIGHT_PX, Math.ceil(height)),
  );
}

/** Keeps only the tail display window, preventing long output from growing unbounded on the React/xterm path. */
function takeDisplayTail(text: string): string {
  if (text.length <= SHELL_TOOL_XTERM_DISPLAY_MAX_CHARS) {
    return text;
  }
  return text.slice(text.length - SHELL_TOOL_XTERM_DISPLAY_MAX_CHARS);
}

/** Estimates the height delta from the number of visible text lines (scans only the delta, avoiding a full split every time). */
function estimateHeightDeltaPx(deltaText: string, cols: number): number {
  if (deltaText.length === 0) {
    return 0;
  }
  const lines = deltaText.split(/\r\n|\n|\r/);
  const safeCols = Math.max(cols, 20);
  let rows = 0;
  for (const line of lines) {
    rows += Math.max(1, Math.ceil(Math.max(line.length, 1) / safeCols));
  }
  // split counts an extra empty-line start when there is no trailing newline; a pure delta only needs the line count
  return rows * SHELL_TOOL_XTERM_FONT_SIZE * SHELL_TOOL_XTERM_LINE_HEIGHT;
}

function measureContentHeightPx(term: Terminal): number {
  const rows = Math.max(1, term.buffer.active.length);
  return clampHeightPx(rows * rowHeightPx(term));
}

function isXtermViewportAtBottom(term: Terminal): boolean {
  const { viewportY, baseY } = term.buffer.active;
  return viewportY >= baseY;
}

/**
 * Read-only output for the Shell tool card: uses xterm to consume ANSI / CR, with the theme forced
 * to monochrome to match the card's text color.
 *
 * followTail is sticky: it auto-scrolls to the latest output only while the user is still at the
 * bottom; it pauses after scrolling up and resumes upon returning to the bottom.
 */
export function ShellToolXtermOutput({
  text,
  followTail = false,
  className,
}: ShellToolXtermOutputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** Display window already written to the terminal (may be the tail of the full text). */
  const writtenDisplayRef = useRef<string>("");
  const followTailRef = useRef(followTail);
  const stickToBottomRef = useRef(true);
  const writeGenerationRef = useRef(0);
  const prevFollowTailRef = useRef(followTail);

  useLayoutEffect(() => {
    followTailRef.current = followTail;
    if (followTail && !prevFollowTailRef.current) {
      stickToBottomRef.current = true;
    }
    prevFollowTailRef.current = followTail;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      fontSize: SHELL_TOOL_XTERM_FONT_SIZE,
      lineHeight: SHELL_TOOL_XTERM_LINE_HEIGHT,
      fontFamily: SHELL_TOOL_XTERM_FONT_FAMILY,
      fontWeight: "normal",
      scrollback: SHELL_TOOL_XTERM_SCROLLBACK,
      theme: readShellToolMonochromeTheme(host),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    host.style.height = `${SHELL_TOOL_XTERM_MIN_HEIGHT_PX}px`;
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    writtenDisplayRef.current = "";
    stickToBottomRef.current = true;

    const applyTheme = (): void => {
      term.options.theme = readShellToolMonochromeTheme(host);
    };
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!host.isConnected) {
        return;
      }
      fitAddon.fit();
    });
    resizeObserver.observe(host);

    // Releasing stick only counts user input (same approach as the conversation streaming bottom
    // anchor): scrolls triggered by content growth do not release it.
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) {
        stickToBottomRef.current = false;
      }
    };
    const scrollDisposable = term.onScroll(() => {
      // Restore only, never release: keep following the tail after returning to the bottom
      if (isXtermViewportAtBottom(term)) {
        stickToBottomRef.current = true;
      }
    });
    host.addEventListener("wheel", onWheel, { passive: true });

    const selectionDisposable = term.onSelectionChange(() => {
      notifyEditCommandTargetsChanged();
    });
    const unregisterEditCommand = registerEditCommandTarget({
      kind: "terminal",
      root: host,
      query: () => ({
        editable: false,
        canUndo: false,
        canRedo: false,
        hasSelection: term.hasSelection(),
      }),
      dispatch: (command) => {
        if (command === "copy") {
          const selected = term.getSelection();
          if (selected) {
            writeEditClipboardText(selected);
          }
          return;
        }
        if (command === "selectAll") {
          term.selectAll();
        }
      },
    });

    return () => {
      writeGenerationRef.current += 1;
      host.removeEventListener("wheel", onWheel);
      unregisterEditCommand();
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      themeObserver.disconnect();
      resizeObserver.disconnect();
      fitRef.current = null;
      termRef.current = null;
      writtenDisplayRef.current = "";
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    const host = hostRef.current;
    if (!term || !fitAddon || !host) {
      return;
    }

    const maybeScrollToBottom = (): void => {
      if (followTailRef.current && stickToBottomRef.current) {
        term.scrollToBottom();
      }
    };

    const nextDisplay = takeDisplayTail(text);
    const previousDisplay = writtenDisplayRef.current;
    if (nextDisplay === previousDisplay) {
      maybeScrollToBottom();
      return;
    }

    const generation = ++writeGenerationRef.current;
    const atMaxHeight =
      Number.parseFloat(host.style.height) >= SHELL_TOOL_XTERM_MAX_HEIGHT_PX - 0.5;

    const afterWrite = (): void => {
      if (generation !== writeGenerationRef.current || !host.isConnected) {
        return;
      }
      host.style.height = `${measureContentHeightPx(term)}px`;
      fitAddon.fit();
      maybeScrollToBottom();
    };

    const appendDelta = nextDisplay.startsWith(previousDisplay) && previousDisplay.length > 0;
    if (appendDelta) {
      const deltaRaw = nextDisplay.slice(previousDisplay.length);
      const deltaWrite = stripAnsiSgrSequences(deltaRaw);
      // write is async: below the cap, raise the height by the delta to avoid full re-estimation.
      if (!atMaxHeight && deltaWrite.length > 0) {
        const currentHeight =
          Number.parseFloat(host.style.height) || SHELL_TOOL_XTERM_MIN_HEIGHT_PX;
        host.style.height = `${clampHeightPx(
          currentHeight + estimateHeightDeltaPx(deltaWrite, term.cols),
        )}px`;
        fitAddon.fit();
      }
      term.write(deltaWrite, afterWrite);
    } else {
      const writeText = stripAnsiSgrSequences(nextDisplay);
      if (!atMaxHeight) {
        host.style.height = `${clampHeightPx(
          estimateHeightDeltaPx(writeText, term.cols) || SHELL_TOOL_XTERM_MIN_HEIGHT_PX,
        )}px`;
        fitAddon.fit();
      }
      term.reset();
      if (writeText.length > 0) {
        term.write(writeText, afterWrite);
      } else {
        afterWrite();
      }
    }
    writtenDisplayRef.current = nextDisplay;
  }, [text, followTail]);

  return (
    <div
      ref={hostRef}
      className={cn("shell-tool-xterm w-full min-w-0 overflow-hidden", className)}
      style={{ maxHeight: SHELL_TOOL_XTERM_MAX_HEIGHT_PX }}
      aria-label="Shell output"
    />
  );
}
