import type { CSSProperties } from "react";

export type ViewportBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Radix virtual trigger: fixed positioning uses getBoundingClientRect viewport coordinates directly. */
export function scaleRootFixedAnchorStyle(rect: ViewportBox): CSSProperties {
  return {
    position: "fixed",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    pointerEvents: "none",
  };
}
