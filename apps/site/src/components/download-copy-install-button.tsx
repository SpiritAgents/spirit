import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { horizontalEdgeFadeMaskStyle } from "@/lib/mask-styles";
import {
  resolveSpiritCliInstallCommand,
  SPIRIT_CLI_INSTALL_CURL,
} from "@/lib/spirit-cli-install-command";
import { cn } from "@/lib/utils";

const BUTTON_CLASSNAME =
  "h-9 max-w-full cursor-pointer rounded-full border border-foreground/12 bg-primary px-4 font-mono text-primary-foreground hover:bg-primary/90";

const EDGE_EPSILON_PX = 1;
const MASK_FADE_MS = 150;
/** Right edge fades slower so the fade-out keeps pace with the scroll's ease-out tail. */
const MASK_FADE_RIGHT_MS = 600;
/** Reading pace: slow enough to scan the command, not a flourish. */
const SCROLL_MS_PER_PX = 28;
const SCROLL_MIN_MS = 1400;
const SCROLL_MAX_MS = 3200;
/** Fraction of the run that stays linear before the ease-out tail. */
const SCROLL_LINEAR_PORTION = 0.6;

/**
 * Linear start, eased stop: constant speed `2/(1+a)` for the first `a` of the run,
 * then a quadratic ease-out tail that decelerates to a dead stop. Position and
 * velocity both match at the joint (C1-continuous), so the bend is invisible.
 */
function scrollEaseLinearOut(t: number): number {
  const a = SCROLL_LINEAR_PORTION;
  if (t <= a) {
    return (2 / (1 + a)) * t;
  }
  const c = 1 / (1 - a * a);
  return 1 - c * (1 - t) * (1 - t);
}

type DownloadCopyInstallButtonProps = {
  className?: string;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollDurationMs(distancePx: number): number {
  return Math.min(
    SCROLL_MAX_MS,
    Math.max(SCROLL_MIN_MS, Math.round(distancePx * SCROLL_MS_PER_PX)),
  );
}

export function DownloadCopyInstallButton({ className }: DownloadCopyInstallButtonProps) {
  const { messages } = useI18n();
  const [copied, setCopied] = useState(false);
  const [command, setCommand] = useState(SPIRIT_CLI_INSTALL_CURL);
  const [overflowPx, setOverflowPx] = useState(0);
  const [offsetPx, setOffsetPx] = useState(0);
  const [maskAnimated, setMaskAnimated] = useState(false);

  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setCommand(resolveSpiritCliInstallCommand());
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) {
      return;
    }

    const measure = () => {
      const next = Math.max(0, text.scrollWidth - viewport.clientWidth);
      setOverflowPx(next);
      if (offsetRef.current > next) {
        offsetRef.current = next;
        setOffsetPx(next);
      }
    };

    measure();
    void document.fonts.ready.then(measure);

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [command]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const stopScrollAnimation = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const setOffsetImmediate = (value: number) => {
    offsetRef.current = value;
    setOffsetPx(value);
  };

  const animateOffsetTo = (target: number, durationMs: number) => {
    stopScrollAnimation();
    const start = offsetRef.current;
    const delta = target - start;
    if (Math.abs(delta) < EDGE_EPSILON_PX || durationMs <= 0) {
      setOffsetImmediate(target);
      return;
    }

    const startedAt = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const next = start + delta * scrollEaseLinearOut(t);
      offsetRef.current = next;
      setOffsetPx(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      rafRef.current = null;
      setOffsetImmediate(target);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const handlePointerEnter = () => {
    if (overflowPx <= EDGE_EPSILON_PX) {
      return;
    }
    setMaskAnimated(true);
    if (prefersReducedMotion()) {
      setOffsetImmediate(overflowPx);
      return;
    }
    animateOffsetTo(overflowPx, scrollDurationMs(overflowPx));
  };

  const handlePointerLeave = () => {
    stopScrollAnimation();
    setMaskAnimated(false);
    setOffsetImmediate(0);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Fallback for restricted clipboard contexts.
      const textarea = document.createElement("textarea");
      textarea.value = command;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedWithExecCommand = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (copiedWithExecCommand) {
        setCopied(true);
      }
    }
  };

  const showLeftMask = offsetPx > EDGE_EPSILON_PX;
  const showRightMask = overflowPx - offsetPx > EDGE_EPSILON_PX;

  return (
    <Button
      type="button"
      size="sm"
      className={cn(BUTTON_CLASSNAME, className)}
      aria-label={copied ? messages.download.copied : messages.download.copyInstall}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onClick={() => {
        void handleCopy();
      }}
    >
      {copied ? (
        <Check className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <Copy className="size-3.5 shrink-0" aria-hidden />
      )}
      <span
        ref={viewportRef}
        className="min-w-0 overflow-hidden"
        style={horizontalEdgeFadeMaskStyle(showLeftMask, showRightMask, {
          animate: maskAnimated,
          durationMs: MASK_FADE_MS,
          rightDurationMs: MASK_FADE_RIGHT_MS,
        })}
      >
        <span
          ref={textRef}
          className="inline-block whitespace-nowrap will-change-transform"
          style={{ transform: `translate3d(${-offsetPx}px, 0, 0)` }}
        >
          {command}
        </span>
      </span>
    </Button>
  );
}
