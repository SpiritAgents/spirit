import { useEffect, useMemo, useRef, useState } from "react";

import { LandingEditorShell } from "@/components/landing-editor-shell";
import { useLandingSectionInView } from "@/hooks/use-landing-section-in-view";
import {
  COMPLETION_DEMO_FINAL_HOLD_MS,
  COMPLETION_DEMO_GHOST_HOLD_MS,
  COMPLETION_DEMO_INITIAL_DELAY_MS,
  COMPLETION_DEMO_RESET_FADE_MS,
  COMPLETION_DEMO_RESET_MS,
  COMPLETION_DEMO_STEP_GAP_MS,
  COMPLETION_DEMO_STEPS,
  buildCompletionDemoSolidText,
  getCompletionDemoGhostText,
} from "@/lib/landing-code-completion-demo-script";
import { preloadLandingCodeHighlighter } from "@/lib/landing-code-completion-highlighter";
import { cn } from "@/lib/utils";

type LandingCodeCompletionDemoProps = {
  className?: string;
};

export function LandingCodeCompletionDemo({ className }: LandingCodeCompletionDemoProps) {
  const { ref, inView } = useLandingSectionInView(0.15);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [ghostVisible, setGhostVisible] = useState(false);
  const [resetFading, setResetFading] = useState(false);
  const timersRef = useRef<number[]>([]);

  const solidText = useMemo(() => buildCompletionDemoSolidText(acceptedCount), [acceptedCount]);
  const ghostText = useMemo(
    () => getCompletionDemoGhostText(acceptedCount, ghostVisible),
    [acceptedCount, ghostVisible],
  );
  const [previousInView, setPreviousInView] = useState(inView);
  if (previousInView !== inView) {
    setPreviousInView(inView);
    setAcceptedCount(0);
    setGhostVisible(false);
    setResetFading(false);
  }

  useEffect(() => {
    if (inView) {
      preloadLandingCodeHighlighter();
    }
  }, [inView]);

  useEffect(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];

    if (!inView) {
      return;
    }

    const schedule = (fn: () => void, delayMs: number) => {
      const id = window.setTimeout(fn, delayMs);
      timersRef.current.push(id);
    };

    const runLoop = () => {
      setAcceptedCount(0);
      setGhostVisible(false);
      setResetFading(false);

      let delay = COMPLETION_DEMO_INITIAL_DELAY_MS;

      COMPLETION_DEMO_STEPS.forEach((_, stepIndex) => {
        schedule(() => {
          setGhostVisible(true);
        }, delay);
        delay += COMPLETION_DEMO_GHOST_HOLD_MS;

        schedule(() => {
          setGhostVisible(false);
          setAcceptedCount(stepIndex + 1);
        }, delay);

        if (stepIndex < COMPLETION_DEMO_STEPS.length - 1) {
          delay += COMPLETION_DEMO_STEP_GAP_MS;
        }
      });

      schedule(() => {
        setResetFading(true);
      }, delay + COMPLETION_DEMO_FINAL_HOLD_MS);

      schedule(
        () => {
          setResetFading(false);
          setAcceptedCount(0);
          setGhostVisible(false);
          schedule(runLoop, COMPLETION_DEMO_RESET_MS);
        },
        delay + COMPLETION_DEMO_FINAL_HOLD_MS + COMPLETION_DEMO_RESET_FADE_MS,
      );
    };

    runLoop();

    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, [inView]);

  return (
    <div ref={ref} aria-hidden className={cn("pointer-events-none select-none", className)}>
      <LandingEditorShell
        active={inView}
        solidText={solidText}
        ghostText={ghostText}
        resetFading={resetFading}
        className="h-full w-full"
      />
    </div>
  );
}
