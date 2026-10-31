import { useEffect, useState } from "react";

export type ResizeDirection = "right" | "left" | "down" | "up";

export function resizeCursor(
  value: number,
  min: number,
  max: number,
  grow: ResizeDirection,
): "col-resize" | "row-resize" | "e-resize" | "w-resize" | "n-resize" | "s-resize" | "default" {
  if (min >= max) return "default";
  if (value <= min) {
    return ({ right: "e-resize", left: "w-resize", down: "s-resize", up: "n-resize" } as const)[
      grow
    ];
  }
  if (value >= max) {
    return ({ right: "w-resize", left: "e-resize", down: "n-resize", up: "s-resize" } as const)[
      grow
    ];
  }
  return grow === "right" || grow === "left" ? "col-resize" : "row-resize";
}

export function junctionResizeCursor(xRatio: number, yRatio: number, min: number, max: number) {
  const xPinned = xRatio <= min || xRatio >= max;
  const yPinned = yRatio <= min || yRatio >= max;
  if (xPinned && yPinned) return "default";
  if (xPinned) return resizeCursor(xRatio, min, max, "right");
  if (yPinned) return resizeCursor(yRatio, min, max, "down");
  return "move";
}

export function useDragResizeCursor() {
  const [controller] = useState(() => {
    let style: HTMLStyleElement | null = null;
    let currentCursor: string | null = null;
    return {
      update(cursor: string) {
        if (!style || currentCursor === cursor) return;
        currentCursor = cursor;
        style.textContent = `html, html *, html *::before, html *::after { cursor: ${cursor} !important; }`;
      },
      start(cursor: string) {
        if (!style) {
          style = document.createElement("style");
          document.head.appendChild(style);
        }
        this.update(cursor);
      },
      end() {
        style?.remove();
        style = null;
        currentCursor = null;
      },
    };
  });
  useEffect(() => () => controller.end(), [controller]);
  return controller;
}
