/**
 * Scroll-time :hover keepalive.
 *
 * Blink re-evaluates :hover and pointer boundary events only after its hover state is
 * marked dirty, which happens after a layout pass or when a scroll finishes
 * (ScrollableArea::OnScrollFinished). A continuous scroll gesture — trackpad momentum
 * or a smooth-scroll animation — triggers neither per frame, so :hover freezes on
 * whatever element the pointer rested on until the gesture ends. Discrete wheel
 * notches are unaffected because each notch is a finished scroll.
 *
 * Toggling a layout-affecting property on a zero-sized hidden node once per scroll
 * frame forces a layout pass, which marks the hover state dirty and lets Chromium
 * recompute hover under the stationary pointer on its own. Measured cost is
 * ~0.1–0.2 ms per scroll frame; nothing runs while no scroll events flow.
 */
let installed = false;

export function installScrollHoverKeepalive(): void {
  if (installed || typeof document === "undefined") {
    return;
  }
  installed = true;

  // Touch-primary devices have no stationary pointer hover to keep alive.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return;
  }

  const node = document.createElement("div");
  node.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:0;visibility:hidden;pointer-events:none;";
  node.setAttribute("aria-hidden", "true");
  node.dataset.scrollHoverKeepalive = "";
  if (document.body) {
    document.body.appendChild(node);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(node), {
      once: true,
    });
  }

  let frame = 0;
  let toggled = false;
  document.addEventListener(
    "scroll",
    () => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        toggled = !toggled;
        // The node's stylesheet width starts at 1px, so the first write must differ
        // from it; a same-value write would not dirty layout.
        node.style.width = toggled ? "0.5px" : "1px";
        // Force the layout pass synchronously so Blink's post-layout tasks (and with
        // them the hover-state recompute) run within this same frame.
        void document.body.offsetHeight;
      });
    },
    { capture: true, passive: true },
  );
}
