import { FONT_WEIGHT_NORMAL } from "../typography.js";

/** Inline chip icon; ~5/6 of composer `text-sm` (12px), same ratio as the previous 10px-on-12px pairing. */
export const COMPOSER_CHIP_ICON_SIZE_PX = 12;

/** Persistent pill chips (Plan / Ask / Debug / Loop): keep the pre-alignment 10px icon on `text-xs`. */
export const COMPOSER_PILL_CHIP_ICON_SIZE_PX = 10;

// Must not add select-none: it would suppress native selection painting in the chip subtree
// Must be inline (not inline-flex): the label text merges into the outer line box so the selection band matches plain text in height and color
// whitespace-nowrap: the chip never wraps internally, preserving atomic-unit behavior
// --chip-pad must equal the root px, --chip-mx must equal the root mx: lets the two spacers extend to cover the
// padding and margin selection band (see chip-shell.tsx)
const INLINE_CHIP_LAYOUT = `inline whitespace-nowrap px-0.5 py-0.5 text-sm ${FONT_WEIGHT_NORMAL} leading-none mx-0.5 [--chip-pad:2px] [--chip-mx:2px]`;

export const COMPOSER_INLINE_CHIP_TEXT_CLASS = "text-blue-500 dark:text-blue-400";

export const COMPOSER_INLINE_CHIP_ICON_CLASS = "text-blue-500 dark:text-blue-400";

export const COMPOSER_INLINE_CHIP_CLASS = `${INLINE_CHIP_LAYOUT} ${COMPOSER_INLINE_CHIP_TEXT_CLASS}`;

/**
 * Read-only chip for message bubbles. Same `inline` line box as Composer so the label shares a
 * baseline with adjacent text. Override Preflight's svg{display:block} so the icon stays on the
 * same line (Composer uses a 1em slot instead).
 */
export const MESSAGE_BUBBLE_CHIP_CLASS = `inline whitespace-nowrap px-0.5 py-0.5 text-sm ${FONT_WEIGHT_NORMAL} leading-none mx-0.5 [&>svg]:mr-1 [&>svg]:inline-block [&>svg]:align-middle ${COMPOSER_INLINE_CHIP_TEXT_CLASS}`;
