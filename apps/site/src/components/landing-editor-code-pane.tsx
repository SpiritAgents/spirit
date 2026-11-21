import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  COMPLETION_DEMO_BASE,
  buildCompletionDemoSolidText,
  COMPLETION_DEMO_STEPS,
} from "@/lib/landing-code-completion-demo-script";
import { highlightLandingTypeScript } from "@/lib/landing-code-completion-highlighter";
import { cn } from "@/lib/utils";

type LandingEditorCodePaneProps = {
  active: boolean;
  solidText: string;
  ghostText: string | null;
  resetFading?: boolean;
  className?: string;
};

const LINE_CLASS = "[&_.line]:inline";
const FADE_CLASS = "transition-opacity duration-280 ease-out";
const FULL_COMPLETION_TEXT = buildCompletionDemoSolidText(COMPLETION_DEMO_STEPS.length);
const RESET_TAIL_TEXT = FULL_COMPLETION_TEXT.slice(COMPLETION_DEMO_BASE.length);

type CursorPosition = {
  top: number;
  left: number;
  height: number;
};

function stripShikiWrapper(html: string): string {
  return html.replace(/^<pre[^>]*><code[^>]*>/, "").replace(/<\/code><\/pre>\s*$/, "");
}

function measureTextOffset(container: HTMLElement, charOffset: number): CursorPosition | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let remaining = charOffset;
  let textNode = walker.nextNode() as Text | null;

  while (textNode) {
    const length = textNode.data.length;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(textNode, remaining);
      range.setEnd(textNode, remaining);
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        height: Math.max(rect.height, 14),
      };
    }
    remaining -= length;
    textNode = walker.nextNode() as Text | null;
  }

  return null;
}

export function LandingEditorCodePane({
  active,
  solidText,
  ghostText,
  resetFading = false,
  className,
}: LandingEditorCodePaneProps) {
  const [beforeHtml, setBeforeHtml] = useState("");
  const [resetTailHtml, setResetTailHtml] = useState("");
  const resetTailTextRef = useRef("");
  const [afterHtml, setAfterHtml] = useState("");
  const [cursorResult, setCursorResult] = useState<{
    key: string;
    position: CursorPosition | null;
  }>({ key: "", position: null });
  const [completionsHidden, setCompletionsHidden] = useState(false);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [displaySplitAt, setDisplaySplitAt] = useState(solidText.length);
  const beforeTextRef = useRef("");
  const afterTextRef = useRef("");
  const [baseHtmlCache, setBaseHtmlCache] = useState("");

  const isBaseState = solidText === COMPLETION_DEMO_BASE && !ghostText && !resetFading;
  const [previousResetFading, setPreviousResetFading] = useState(resetFading);
  if (previousResetFading !== resetFading) {
    setPreviousResetFading(resetFading);
    setCompletionsHidden(false);
  }
  if (ghostText && displaySplitAt !== solidText.length) {
    setDisplaySplitAt(solidText.length);
  }
  if (isBaseState) {
    if (displaySplitAt !== solidText.length) {
      setDisplaySplitAt(solidText.length);
    }
    if (resetTailHtml) {
      setResetTailHtml("");
    }
  }

  // Back at the base state, the tail highlight is discarded; the "already highlighted" ref must
  // be invalidated too, or the next loop never re-highlights and the fade-out shows nothing.
  useEffect(() => {
    if (isBaseState) {
      resetTailTextRef.current = "";
    }
  }, [isBaseState]);

  useEffect(() => {
    if (!resetFading) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      setCompletionsHidden(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [resetFading]);

  const splitAt = ghostText ? solidText.length : displaySplitAt;

  const beforeText = ghostText
    ? solidText
    : isBaseState
      ? COMPLETION_DEMO_BASE
      : solidText.slice(0, splitAt);

  const afterText = ghostText ?? (isBaseState ? "" : solidText.slice(splitAt));
  const displayedAfterHtml = afterText ? afterHtml : "";

  const beforeHighlightText = resetFading ? COMPLETION_DEMO_BASE : beforeText;
  const showResetTail = resetFading && solidText === FULL_COMPLETION_TEXT;
  const showSplitLayout = Boolean(afterText && displayedAfterHtml && !resetFading);

  const afterOpacity = resetFading ? 0 : ghostText ? 0.65 : 1;
  const resetTailOpacity = resetFading ? (completionsHidden ? 0 : 1) : 1;

  const cursorCharOffset = resetFading
    ? COMPLETION_DEMO_BASE.length
    : ghostText
      ? beforeText.length
      : showSplitLayout
        ? beforeText.length + afterText.length
        : beforeText.length;

  useEffect(() => {
    if (!active || ghostText || resetFading || solidText !== FULL_COMPLETION_TEXT) {
      return;
    }

    if (resetTailTextRef.current === RESET_TAIL_TEXT) {
      return;
    }

    let cancelled = false;
    resetTailTextRef.current = RESET_TAIL_TEXT;

    void highlightLandingTypeScript(RESET_TAIL_TEXT).then((html) => {
      if (!cancelled) {
        setResetTailHtml(stripShikiWrapper(html));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [active, ghostText, resetFading, solidText]);

  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    if (!active) {
      setBeforeHtml("");
      setResetTailHtml("");
      setAfterHtml("");
      setDisplaySplitAt(solidText.length);
    }
  }

  useEffect(() => {
    if (!active) {
      beforeTextRef.current = "";
      resetTailTextRef.current = "";
      afterTextRef.current = "";
      return;
    }

    let cancelled = false;
    const jobs: Promise<void>[] = [];

    if (beforeHighlightText !== beforeTextRef.current) {
      beforeTextRef.current = beforeHighlightText;
      jobs.push(
        highlightLandingTypeScript(beforeHighlightText).then((html) => {
          if (!cancelled) {
            const stripped = stripShikiWrapper(html);
            setBeforeHtml(stripped);
            if (beforeHighlightText === COMPLETION_DEMO_BASE) {
              setBaseHtmlCache(stripped);
            }
          }
        }),
      );
    }

    if (!resetFading && afterText !== afterTextRef.current) {
      afterTextRef.current = afterText;
      if (afterText) {
        jobs.push(
          highlightLandingTypeScript(afterText).then((html) => {
            if (!cancelled) {
              setAfterHtml(stripShikiWrapper(html));
            }
          }),
        );
      }
    }

    void Promise.all(jobs);

    return () => {
      cancelled = true;
    };
  }, [active, beforeHighlightText, afterText, resetFading]);

  const displayedBeforeHtml = resetFading && baseHtmlCache ? baseHtmlCache : beforeHtml;
  const cursorLayoutKey = JSON.stringify([
    active,
    cursorCharOffset,
    displayedBeforeHtml,
    resetTailHtml,
    displayedAfterHtml,
    showSplitLayout,
    showResetTail,
  ]);
  const cursorPos = cursorResult.key === cursorLayoutKey ? cursorResult.position : null;

  useLayoutEffect(() => {
    if (!active || !contentRef.current) {
      setCursorResult({ key: cursorLayoutKey, position: null });
      return;
    }

    setCursorResult({
      key: cursorLayoutKey,
      position: measureTextOffset(contentRef.current, cursorCharOffset),
    });
  }, [active, cursorCharOffset, cursorLayoutKey]);

  return (
    <div className={cn("min-h-0 min-w-0 flex-1 overflow-hidden bg-background", className)}>
      <div className="spirit-scroll h-full overflow-auto px-3 py-2.5">
        <pre
          className={cn(
            "relative m-0 font-mono text-[11px] leading-[18px] whitespace-pre-wrap break-words",
            "[&_.shiki]:!bg-transparent [&_.shiki]:!p-0",
          )}
        >
          <code className="block text-foreground dark:text-[#e6edf3]">
            {displayedBeforeHtml ? (
              <span ref={contentRef} className="inline">
                <span
                  data-code-part="before"
                  className={LINE_CLASS}
                  dangerouslySetInnerHTML={{ __html: displayedBeforeHtml }}
                />
                {showResetTail ? (
                  <span
                    data-code-part="reset-tail"
                    className={cn(LINE_CLASS, FADE_CLASS)}
                    style={{ opacity: resetTailOpacity }}
                    dangerouslySetInnerHTML={{ __html: resetTailHtml }}
                  />
                ) : null}
                {showSplitLayout && !resetFading ? (
                  <span
                    key={afterText}
                    data-code-part="after"
                    className={cn(
                      LINE_CLASS,
                      FADE_CLASS,
                      ghostText && !resetFading && "animate-in fade-in duration-300",
                    )}
                    style={{ opacity: afterOpacity }}
                    dangerouslySetInnerHTML={{ __html: displayedAfterHtml }}
                  />
                ) : null}
              </span>
            ) : (
              <span className="text-foreground/40">{solidText || COMPLETION_DEMO_BASE}</span>
            )}
          </code>
          {cursorPos ? (
            <span
              data-code-cursor
              className={cn(
                "pointer-events-none absolute w-px bg-foreground/80",
                FADE_CLASS,
                ghostText && !resetFading && "animate-pulse",
              )}
              style={{
                top: cursorPos.top + 2,
                left: cursorPos.left,
                height: cursorPos.height,
                opacity: resetFading && completionsHidden ? 0 : 1,
              }}
              aria-hidden
            />
          ) : null}
        </pre>
      </div>
    </div>
  );
}
