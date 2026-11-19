import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedCount } from "./animated-count";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { delayDisplaySeconds, durationSegments } from "@/lib/delay-tool-display";
import type { ToolBlockSnapshot } from "@/types";

export function DelayToolDuration({ tool }: { tool: ToolBlockSnapshot }) {
  const { i18n } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [seconds, setSeconds] = useState(() => delayDisplaySeconds(tool));
  const displayed = useRef(seconds);
  const finished = tool.phase === "succeeded" || tool.phase === "failed";
  const wasFinished = useRef(finished);
  const deadline = tool.delay?.deadlineUnixMs;
  const readCurrentSeconds = useEffectEvent(() => delayDisplaySeconds(tool));
  useEffect(() => {
    let frame: number | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const effectInitial = readCurrentSeconds();
    const update = (value: number | undefined) => {
      displayed.current = value;
      setSeconds(value);
    };
    const animate =
      finished &&
      !wasFinished.current &&
      !reduced &&
      displayed.current !== undefined &&
      effectInitial !== undefined;
    wasFinished.current = finished;
    if (animate) {
      const from = displayed.current!;
      const target = effectInitial!;
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 320);
        update(Math.round(from + (target - from) * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } else {
      update(effectInitial);
    }
    const refresh = () => {
      if (!finished && deadline !== undefined) {
        update(readCurrentSeconds());
      }
    };
    if (!finished && deadline !== undefined) {
      timer = setInterval(refresh, 1000);
      document.addEventListener("visibilitychange", refresh);
    }
    return () => {
      clearInterval(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", refresh);
    };
    // The live clock is recalculated by the timer, not by parent rerenders.
  }, [finished, deadline, reduced]);

  const parts =
    seconds === undefined ? [] : durationSegments(seconds, i18n.resolvedLanguage ?? i18n.language);
  const text = parts.map((part) => part.number + part.suffix + part.separator).join("");
  const signature = parts.map((part) => `${part.unit}:${part.suffix}`).join("|");
  const content = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const [outgoing, setOutgoing] = useState<string>();
  const previousMeasureSignatureRef = useRef(signature);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    const signatureChanged = previousMeasureSignatureRef.current !== signature;
    previousMeasureSignatureRef.current = signature;
    if (signatureChanged) {
      measure();
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [content, previousMeasureSignatureRef, signature]);
  const [previousFrame, setPreviousFrame] = useState({ text, signature });
  if (previousFrame.text !== text || previousFrame.signature !== signature) {
    if (previousFrame.signature !== signature && !reduced) {
      setOutgoing(previousFrame.text);
    }
    setPreviousFrame({ text, signature });
  }
  if (reduced && outgoing !== undefined) {
    setOutgoing(undefined);
  }
  useLayoutEffect(() => {
    if (outgoing === undefined) return;
    const timer = setTimeout(() => setOutgoing(undefined), 240);
    return () => clearTimeout(timer);
  }, [outgoing]);
  return (
    <span
      className="spirit-delay-duration"
      style={{ width }}
      role="timer"
      aria-label={text}
      aria-live="off"
    >
      {outgoing ? (
        <span className="spirit-delay-duration-outgoing" aria-hidden>
          {outgoing}
        </span>
      ) : null}
      <span
        ref={content}
        key={signature}
        className={outgoing !== undefined ? "spirit-delay-duration-enter" : undefined}
        aria-hidden
      >
        {parts.map((part) => (
          <span key={part.unit} className="inline-flex items-baseline whitespace-pre">
            <AnimatedCount value={part.value} text={part.number} />
            <span>
              {part.suffix}
              {part.separator}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
