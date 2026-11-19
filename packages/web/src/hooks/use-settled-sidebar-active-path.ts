import { useState } from "react";

/** Keep sidebar selection on the prior session until navigation fully settles. */
export function useSettledSidebarActivePath(
  activeFilePath: string | null,
  navigationPending: boolean,
): string | null {
  const [snapshot, setSnapshot] = useState({ activeFilePath, navigationPending });
  if (
    snapshot.activeFilePath !== activeFilePath ||
    snapshot.navigationPending !== navigationPending
  ) {
    setSnapshot({
      activeFilePath: navigationPending ? snapshot.activeFilePath : activeFilePath,
      navigationPending,
    });
  }
  return navigationPending ? snapshot.activeFilePath : activeFilePath;
}
