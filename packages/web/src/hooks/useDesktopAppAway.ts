import { useEffect, useRef, useState } from "react";

/** Tracks whether the user has left the desktop window (Electron main process truth). */
export function useDesktopAppAway(): boolean {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.getAppAwayFromUser || !bridge.reportRendererVisibility) {
      return;
    }

    let cancelled = false;

    const reportVisibility = () => {
      void bridge.reportRendererVisibility(document.hidden);
    };

    void bridge.getAppAwayFromUser().then((value) => {
      if (!cancelled) {
        setAway(value);
      }
    });

    reportVisibility();

    const unsubscribeAway = bridge.subscribeAppAwayChanged?.((next) => {
      setAway(next);
    });

    document.addEventListener("visibilitychange", reportVisibility);
    window.addEventListener("focus", reportVisibility);
    window.addEventListener("blur", reportVisibility);

    return () => {
      cancelled = true;
      unsubscribeAway?.();
      document.removeEventListener("visibilitychange", reportVisibility);
      window.removeEventListener("focus", reportVisibility);
      window.removeEventListener("blur", reportVisibility);
    };
  }, []);

  return away;
}

export function useDesktopNotifyRefresh(onRefresh: () => void): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeNotifyRefresh) {
      return;
    }
    return bridge.subscribeNotifyRefresh(() => {
      onRefreshRef.current();
    });
  }, []);
}
