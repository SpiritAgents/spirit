import type { CSSProperties } from "react";

/** Occlusion shape in viewport coordinates (black in the mask = do not paint messages) */
export type ConversationScrollOccludeShape = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Uniform corner radius (pill / four-corner rounded rect) */
  rx: number;
  ry: number;
  /** Top corners only (TODO attach to the composer); the bottom edge stays square to avoid over-clipping the bottom corners or under-clipping the square ones */
  roundTopOnly?: boolean;
};

export type ConversationScrollOccludeMaskInput = {
  viewportWidth: number;
  viewportHeight: number;
  shapes: readonly ConversationScrollOccludeShape[];
  /**
   * A viewport-wide bottom band starting at this Y (viewport coordinate): seals the gap outside
   * the composer's bottom corners plus the approval bar.
   * The area outside the composer's top corners is not in this band, so messages can still show
   * through the gap there.
   */
  bottomSlabFromY?: number;
};

function clampShape(
  shape: ConversationScrollOccludeShape,
  vw: number,
  vh: number,
): ConversationScrollOccludeShape | null {
  const x = Math.max(0, shape.x);
  const y = Math.max(0, shape.y);
  const right = Math.min(vw, shape.x + shape.width);
  const bottom = Math.min(vh, shape.y + shape.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0.5 || height <= 0.5) {
    return null;
  }
  // Uniform cap of min(w,h)/2: a rounded-full radius clamped separately to w/2 and h/2 would
  // become an ellipse (rx≠ry), leaving the pill corners outside the mask → text bleeds through.
  const maxR = Math.min(width, height) / 2;
  return {
    x,
    y,
    width,
    height,
    rx: Math.min(Math.max(0, shape.rx), maxR),
    ry: Math.min(Math.max(0, shape.ry), maxR),
    roundTopOnly: shape.roundTopOnly,
  };
}

/** Derive a shape in viewport-relative coordinates from the viewport and element rects */
export function conversationScrollOccludeShapeFromRects(
  viewportRect: DOMRectReadOnly,
  elementRect: DOMRectReadOnly,
  rx: number,
  ry: number,
  options?: { roundTopOnly?: boolean },
): ConversationScrollOccludeShape {
  return {
    x: elementRect.left - viewportRect.left,
    y: elementRect.top - viewportRect.top,
    width: elementRect.width,
    height: elementRect.height,
    rx,
    ry,
    ...(options?.roundTopOnly ? { roundTopOnly: true } : {}),
  };
}

export function readElementUniformBorderRadius(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return Math.max(
    0,
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
    Number.parseFloat(style.borderBottomRightRadius) || 0,
    Number.parseFloat(style.borderBottomLeftRadius) || 0,
  );
}

/** Take only the top corner radii (TODO: rounded top, square bottom) */
export function readElementTopBorderRadius(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return Math.max(
    0,
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
  );
}

function shapeToSvg(shape: ConversationScrollOccludeShape): string {
  const x = shape.x.toFixed(2);
  const y = shape.y.toFixed(2);
  const w = shape.width.toFixed(2);
  const h = shape.height.toFixed(2);
  if (shape.roundTopOnly) {
    const r = Math.min(shape.rx, shape.ry, shape.width / 2, shape.height);
    if (r <= 0.5) {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>`;
    }
    const rStr = r.toFixed(2);
    const x2 = (shape.x + shape.width).toFixed(2);
    const y2 = (shape.y + shape.height).toFixed(2);
    const xR = (shape.x + r).toFixed(2);
    const xWR = (shape.x + shape.width - r).toFixed(2);
    const yR = (shape.y + r).toFixed(2);
    // Rounded top, square bottom
    return `<path d="M${x},${yR} A${rStr},${rStr} 0 0 1 ${xR},${y} H${xWR} A${rStr},${rStr} 0 0 1 ${x2},${yR} V${y2} H${x} Z" fill="black"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${shape.rx.toFixed(2)}" ry="${shape.ry.toFixed(2)}" fill="black"/>`;
}

/**
 * Build the conversation scroll viewport mask: white = paint messages, black = do not paint.
 * Each shape clips only its own outline (the gaps outside the top corners of Changes/TODO/composer are not clipped); the bottom band seals the area outside the bottom corners and the approval bar.
 */
export function buildConversationScrollOccludeMaskStyle(
  input: ConversationScrollOccludeMaskInput,
): CSSProperties | undefined {
  const vw = Math.ceil(input.viewportWidth);
  const vh = Math.ceil(input.viewportHeight);
  if (vw <= 0 || vh <= 0) {
    return undefined;
  }

  const shapes = input.shapes
    .map((shape) => clampShape(shape, vw, vh))
    .filter((shape): shape is ConversationScrollOccludeShape => shape != null);

  const bottomSlabFromY =
    input.bottomSlabFromY == null ? null : Math.min(vh, Math.max(0, input.bottomSlabFromY));

  if (shapes.length === 0 && bottomSlabFromY == null) {
    return undefined;
  }

  const shapeMarkup = shapes.map(shapeToSvg).join("");
  const bottomSlab =
    bottomSlabFromY == null || bottomSlabFromY >= vh
      ? ""
      : `<rect x="0" y="${bottomSlabFromY.toFixed(2)}" width="${vw}" height="${(vh - bottomSlabFromY).toFixed(2)}" fill="black"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">` +
    `<rect width="100%" height="100%" fill="white"/>` +
    shapeMarkup +
    bottomSlab +
    `</svg>`;

  const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  // data-URL SVG masks sample alpha by default: black/white fills are both opaque → clipping is a no-op; luminance is required (white = visible, black = hidden)
  return {
    maskImage,
    WebkitMaskImage: maskImage,
    maskMode: "luminance",
    WebkitMaskSourceType: "luminance",
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  } as CSSProperties;
}
