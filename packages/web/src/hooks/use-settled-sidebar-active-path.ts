import { useRef } from "react";

/** Keep sidebar selection on the prior session until navigation fully settles. */
export function useSettledSidebarActivePath(
  activeFilePath: string | null,
  navigationPending: boolean,
): string | null {
  const settledRef = useRef<string | null>(activeFilePath);
  if (!navigationPending) {
    settledRef.current = activeFilePath;
  }
  return navigationPending ? settledRef.current : activeFilePath;
}
