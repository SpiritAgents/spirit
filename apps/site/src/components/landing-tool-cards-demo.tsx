import { useEffect, useMemo, useRef, useState } from "react";

import { LandingToolCardsConversation } from "@/components/landing-tool-cards-conversation";
import { useI18n } from "@/i18n/provider";
import { useLandingSectionInView } from "@/hooks/use-landing-section-in-view";
import {
  TOOL_CARDS_DEMO_DELTA_SEQUENCE,
  TOOL_CARDS_DEMO_DELTA_TICK_MS,
  TOOL_CARDS_DEMO_FINAL_HOLD_MS,
  TOOL_CARDS_DEMO_STREAM_CHAR_MS,
  TOOL_CARDS_DEMO_TOOL_GAP_MS,
  buildToolCardsDemoItems,
  createInitialToolCardsSnapshot,
  type ToolCardsDemoSnapshot,
} from "@/lib/landing-tool-cards-demo-script";
import { cn } from "@/lib/utils";

type LandingToolCardsDemoProps = {
  className?: string;
};

export function LandingToolCardsDemo({ className }: LandingToolCardsDemoProps) {
  const { messages } = useI18n();
  const copy = messages.landing.trio.toolCards;
  const { ref, inView } = useLandingSectionInView(0.15);
  const [snapshot, setSnapshot] = useState<ToolCardsDemoSnapshot>(createInitialToolCardsSnapshot);
  const [enteringItemId, setEnteringItemId] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const streamIntervalRef = useRef<number | null>(null);
  const animatedIdsRef = useRef(new Set<string>());
  const [previousInView, setPreviousInView] = useState(inView);
  if (previousInView !== inView) {
    setPreviousInView(inView);
    if (!inView) {
      setSnapshot(createInitialToolCardsSnapshot());
      setEnteringItemId(null);
    }
  }

  const items = useMemo(() => buildToolCardsDemoItems(snapshot, copy), [snapshot, copy]);

  useEffect(() => {
    const clearTimers = () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
      if (streamIntervalRef.current !== null) {
        window.clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
      }
    };

    const schedule = (fn: () => void, delayMs: number) => {
      const id = window.setTimeout(fn, delayMs);
      timersRef.current.push(id);
    };

    const markEntering = (id: string) => {
      if (animatedIdsRef.current.has(id)) {
        return;
      }
      animatedIdsRef.current.add(id);
      setEnteringItemId(id);
      schedule(() => {
        setEnteringItemId((current) => (current === id ? null : current));
      }, 320);
    };

    const runLoop = () => {
      setSnapshot({ ...createInitialToolCardsSnapshot(), showUser: true });
      setEnteringItemId(null);
      animatedIdsRef.current.clear();

      let delay = TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({ ...prev, searchPhase: "running" }));
        markEntering("search");
      }, delay);
      delay += TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({ ...prev, searchPhase: "succeeded" }));
      }, delay);
      delay += TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({ ...prev, readPhase: "running" }));
        markEntering("read");
      }, delay);
      delay += TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({ ...prev, readPhase: "succeeded" }));
      }, delay);
      delay += TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({
          ...prev,
          editPhase: "running",
          editDelta: { added: 1, removed: 1 },
        }));
        markEntering("edit");
      }, delay);

      TOOL_CARDS_DEMO_DELTA_SEQUENCE.slice(1).forEach((value) => {
        delay += TOOL_CARDS_DEMO_DELTA_TICK_MS;
        schedule(() => {
          setSnapshot((prev) => ({
            ...prev,
            editDelta: { added: value, removed: value },
          }));
        }, delay);
      });

      delay += TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({ ...prev, editPhase: "succeeded" }));
      }, delay);
      delay += TOOL_CARDS_DEMO_TOOL_GAP_MS;

      schedule(() => {
        setSnapshot((prev) => ({
          ...prev,
          showAssistant: true,
          assistantText: "",
          assistantPending: true,
        }));
        markEntering("assistant");

        let charIndex = 0;
        const fullText = copy.assistantMessage;

        streamIntervalRef.current = window.setInterval(() => {
          charIndex += 1;
          const nextText = fullText.slice(0, charIndex);
          const done = charIndex >= fullText.length;

          setSnapshot((prev) => ({
            ...prev,
            assistantText: nextText,
            assistantPending: !done,
          }));

          if (done && streamIntervalRef.current !== null) {
            window.clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
          }
        }, TOOL_CARDS_DEMO_STREAM_CHAR_MS);
      }, delay);

      const streamDuration = copy.assistantMessage.length * TOOL_CARDS_DEMO_STREAM_CHAR_MS;
      delay += streamDuration + TOOL_CARDS_DEMO_FINAL_HOLD_MS;

      schedule(() => {
        runLoop();
      }, delay);
    };

    const startLoop = () => {
      clearTimers();
      runLoop();
    };

    clearTimers();

    if (!inView) {
      animatedIdsRef.current.clear();
      return clearTimers;
    }

    startLoop();

    return clearTimers;
  }, [inView, copy.assistantMessage]);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none h-full min-h-0 select-none", className)}
    >
      <LandingToolCardsConversation items={items} enteringItemId={enteringItemId} />
    </div>
  );
}
