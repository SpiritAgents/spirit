import { useRef, type PointerEvent, type MouseEvent, type ReactNode } from "react";

import { pointerMovedBeyondChipNavigateThreshold } from "@/lib/composer-chip-navigation";

import { COMPOSER_CHIP_ICON_SIZE_PX } from "@/lib/composer-inline-chip-styles";
import { cn } from "@/lib/utils";

type ChipShellProps = {
  className?: string;
  title?: string;
  "aria-label"?: string;
  "data-chip-kind"?: string;
  "data-element-chip"?: string;
  "data-element-id"?: string;
  "data-element-tag"?: string;
  "data-element-html"?: string;
  "data-element-url"?: string;
  children: ReactNode;
};

// The chip subtree must not carry user-select: none — it suppresses native selection painting for
// the entire subtree (neither text nor icons get a selection tint)
export function ChipShell({
  className,
  title,
  "aria-label": ariaLabel,
  "data-chip-kind": chipKind,
  "data-element-chip": elementChip,
  "data-element-id": elementId,
  "data-element-tag": elementTag,
  "data-element-html": elementHtml,
  "data-element-url": elementUrl,
  children,
}: ChipShellProps) {
  return (
    <span
      contentEditable={false}
      data-spirit-chip="true"
      data-chip-kind={chipKind}
      data-element-chip={elementChip}
      data-element-id={elementId}
      data-element-tag={elementTag}
      data-element-html={elementHtml}
      data-element-url={elementUrl}
      className={className}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
      <ChipTrailingSpacer />
    </span>
  );
}

/** Label text only: must stay `inline` (never inline-flex / user-select:none) so chip selection tint stays native. */
export function ChipLabel({
  navigable = false,
  onNavigate,
  children,
}: {
  navigable?: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (!navigable || event.button !== 0) {
      return;
    }
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (!navigable) {
      return;
    }
    event.stopPropagation();
    const origin = pointerOriginRef.current;
    pointerOriginRef.current = null;
    if (!origin || !onNavigate) {
      return;
    }
    if (pointerMovedBeyondChipNavigateThreshold(origin, { x: event.clientX, y: event.clientY })) {
      return;
    }
    onNavigate();
  };

  return (
    <span
      data-chip-label=""
      {...(navigable ? { "data-chip-navigable": "" } : {})}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {children}
    </span>
  );
}

/** Dedicated to icon-less chips (e.g. skill): a selection band covering the left margin + left padding. Icon chips are handled by the ChipIcon spacer and must not stack with it (that would push the icon baseline down). */
export function ChipLeadingSpacer() {
  return (
    <span
      aria-hidden="true"
      data-chip-leading-spacer="true"
      className="text-transparent"
      style={{
        lineHeight: 0,
        letterSpacing: "calc(var(--chip-pad, 0px) + var(--chip-mx, 0px) - 1em)",
        marginLeft: "calc(-1 * (var(--chip-pad, 0px) + var(--chip-mx, 0px)))",
      }}
    >
      {CHIP_ICON_SPACER_GLYPH}
    </span>
  );
}

// U+3000 ideographic space: a blank glyph whose advance is always 1em, used as the "invisible
// text" backing the chip selection tint
const CHIP_ICON_SPACER_GLYPH = String.fromCodePoint(0x3000);

/**
 * Trailing invisible text run: the label's selection tint does not extend rightward over the
 * chip's right padding and margin (measured in Chromium: the line band is only painted to the end
 * of the text advance, and neighboring runs do not extend over the margin either; see the gap scan
 * in verify-chip-selection.mjs), so a pill-shaped chip (px-1.5) would expose an unselected gap of
 * padding+margin width on its right end. A transparent U+3000 pushes the selection tint to exactly
 * fill right padding + right margin: advance = --chip-pad + --chip-mx (composed of 1em + negative
 * letter-spacing), and a negative margin-right reclaims its own width, so the chip's total width
 * is unchanged.
 * Note the advance must stop exactly at chipRight + --chip-mx (= the neighboring text's advance
 * start, where both band edges coincide seamlessly); overshooting would overlap the neighboring
 * band's semi-transparency into a darker seam (measured overlap area (149,199,255) vs normal
 * (180,215,254))
 */
function ChipTrailingSpacer() {
  return (
    <span
      aria-hidden="true"
      data-chip-trailing-spacer="true"
      className="text-transparent"
      style={{
        lineHeight: 0,
        letterSpacing: "calc(var(--chip-pad, 0px) - 1em + var(--chip-mx, 0px))",
        marginRight: "calc(-1 * (var(--chip-pad, 0px) + var(--chip-mx, 0px)))",
      }}
    >
      {CHIP_ICON_SPACER_GLYPH}
    </span>
  );
}

/**
 * Unified wrapper for chip inline icons.
 *
 * Chromium does not paint a selection background for inline SVG (svgwg#894, spec undecided); a
 * transparent <img>'s replaced tint is measured to be a semi-transparent overlay painted on top of
 * the icon (the icon grays out when selected), and its height can only align to its own box rather
 * than the text line band. Hence the "invisible text" approach: a transparent ideographic-space
 * text run is placed before the icon — the selection tint is painted by the browser as a normal
 * text line band, with color/height/vertical position naturally consistent with adjacent plain
 * text (same paint path), while the icon svg is painted above the tint and stays sharp.
 *
 * - spacer width = left margin (--chip-mx) + left padding (--chip-pad) + icon slot (1em) + the 4px
 *   gap between icon and label: U+3000 advance is always 1em, the excess is made up with
 *   letter-spacing; do not widen it with font-size — the selection tint is measured as line band ∪
 *   the text run's own font box, so a larger font-size would push the tint's top edge out of the
 *   line band; line-height: 0 zeroes out the spacer's inline-box height, eliminating that effect
 *   entirely
 * - The left margin/padding of icon-less chips is covered separately by ChipLeadingSpacer (must
 *   not stack with ChipIcon)
 * - The slot folds back over the spacer's icon area with a negative margin; margin-right provides
 *   the 4px gap to the label; a negative verticalAlign moves the element down in Chromium inline
 *   layout (measured: -2.5px makes the icon sag by 1.75css); the calibrated value is -0.75px so the
 *   slot and the label share the same vertical center
 * - The selection tint for the chip's right padding is handled by ChipTrailingSpacer at the end of
 *   ChipShell
 */

export function ChipIcon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-chip-icon-spacer="true"
        className="text-transparent"
        style={{
          lineHeight: 0,
          letterSpacing: "calc(var(--chip-pad, 0px) + var(--chip-mx, 0px) + 4px)",
          marginLeft: "calc(-1 * (var(--chip-pad, 0px) + var(--chip-mx, 0px)))",
        }}
      >
        {CHIP_ICON_SPACER_GLYPH}
      </span>
      <span
        data-chip-icon-slot="true"
        className={cn(
          "relative inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center",
          className,
        )}
        style={{ marginLeft: "calc(-1em - 4px)", marginRight: "4px", verticalAlign: "-0.75px" }}
      >
        {children}
      </span>
    </>
  );
}

export function ChipIconSvg({
  className,
  children,
  size = COMPOSER_CHIP_ICON_SIZE_PX,
}: {
  className?: string;
  children: ReactNode;
  size?: number;
}) {
  return (
    <ChipIcon className={className}>
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </ChipIcon>
  );
}
