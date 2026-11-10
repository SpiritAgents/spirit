import { useEffect, useState } from "react";

import {
  prefersReducedMotion as readPrefersReducedMotion,
  subscribePrefersReducedMotion,
} from "@/lib/reduce-motion";

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    readPrefersReducedMotion(),
  );

  useEffect(() => {
    const sync = (): void => {
      setPrefersReducedMotion(readPrefersReducedMotion());
    };
    sync();
    return subscribePrefersReducedMotion(sync);
  }, []);

  return prefersReducedMotion;
}
