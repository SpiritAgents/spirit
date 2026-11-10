import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function useTruncatedElement<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const updateTruncation = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setIsTruncated(element.scrollWidth > element.clientWidth);
  }, []);

  useLayoutEffect(() => {
    updateTruncation();
  }, [dependency, updateTruncation]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateTruncation();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [updateTruncation]);

  return { ref, isTruncated };
}
