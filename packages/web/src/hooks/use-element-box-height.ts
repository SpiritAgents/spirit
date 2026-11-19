import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Observe an element's border-box height (px, rounded up) for aligning overlays and scroll-area padding.
 *
 * Must measure synchronously in a layout effect: the scroll bed padding is derived from this height;
 * updating after paint (useEffect / RO callback) would lay out the first frame of a page switch with a
 * stale height, then the padding shrink causes a scrollHeight jump and a visible shift. When
 * `remeasureKey` changes (e.g. the composer layout switch between empty session and session with
 * content), re-measure pre-paint within the same commit.
 */
export function useElementBoxHeight<T extends HTMLElement>(remeasureKey?: unknown) {
  const [element, setElement] = useState<T | null>(null);
  const [heightPx, setHeightPx] = useState(0);
  const previousMeasurementRef = useRef<{ element: T | null; key: unknown } | null>(null);
  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  useLayoutEffect(() => {
    if (!element) {
      return;
    }

    const previous = previousMeasurementRef.current;
    const shouldMeasure = previous?.element !== element || previous.key !== remeasureKey;
    previousMeasurementRef.current = { element, key: remeasureKey };
    const syncHeight = () => {
      setHeightPx(Math.ceil(element.getBoundingClientRect().height));
    };

    if (shouldMeasure) {
      syncHeight();
    }
    const observer = new ResizeObserver(syncHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, remeasureKey]);

  return { ref, heightPx: element ? heightPx : 0 };
}
