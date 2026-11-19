import { useEffect, useState } from "react";

import { computeDurationMs } from "./format-ci-duration.js";

export function useElapsedDuration(
  startedAt: string,
  active: boolean,
  completedAt?: string,
): number {
  const [elapsedMs, setElapsedMs] = useState(() => computeDurationMs(startedAt, completedAt));
  const [previousStartedAt, setPreviousStartedAt] = useState(startedAt);
  const [previousActive, setPreviousActive] = useState(active);
  if (previousStartedAt !== startedAt || previousActive !== active) {
    setPreviousStartedAt(startedAt);
    setPreviousActive(active);
    setElapsedMs(computeDurationMs(startedAt, completedAt));
  }

  useEffect(() => {
    if (!active) {
      return;
    }

    const tick = () => {
      setElapsedMs(computeDurationMs(startedAt));
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, startedAt]);

  return active ? elapsedMs : computeDurationMs(startedAt, completedAt);
}
