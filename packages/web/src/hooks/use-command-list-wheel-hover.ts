import { useCallback, useRef } from "react";

/**
 * cmdk only moves selection on pointermove, so wheel-scrolling with a stationary
 * pointer strands the highlight on the row that scrolled away. Re-hit-test the
 * pointer position on each wheel event and select the row now under the cursor
 * by replaying cmdk's own pointer selection (a synthetic bubbling pointermove);
 * disabled rows are unaffected because cmdk never attaches that handler to them.
 *
 * Returns a callback ref for the CommandList element: Radix unmounts dialog
 * content on close, so a callback ref is the reliable attach/detach point.
 */
export function useCommandListWheelHover() {
  const detachRef = useRef<(() => void) | null>(null);

  return useCallback((list: HTMLElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!list) {
      return;
    }

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const selectRowUnderPointer = () => {
      frame = 0;
      const hit = document.elementFromPoint(pointerX, pointerY);
      const item = hit?.closest<HTMLElement>("[cmdk-item]");
      if (!item || !list.contains(item)) {
        return;
      }
      item.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    };

    const onWheel = (event: WheelEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) {
        frame = requestAnimationFrame(selectRowUnderPointer);
      }
    };

    list.addEventListener("wheel", onWheel, { passive: true });
    detachRef.current = () => {
      list.removeEventListener("wheel", onWheel);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
}
