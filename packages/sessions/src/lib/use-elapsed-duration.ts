import { useEffect, useState } from "react";

import { computeDurationMs } from "@/lib/format-ci-duration";

export function useElapsedDuration(
  startedAt: string,
  active: boolean,
  completedAt?: string,
): number {
  const [elapsedMs, setElapsedMs] = useState(() => computeDurationMs(startedAt, completedAt));

  useEffect(() => {
    if (!active) {
      setElapsedMs(computeDurationMs(startedAt, completedAt));
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
  }, [active, completedAt, startedAt]);

  return elapsedMs;
}
