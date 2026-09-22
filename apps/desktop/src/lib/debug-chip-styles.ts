import { COMPOSER_PILL_CHIP_ICON_SIZE_PX } from "@/lib/composer-inline-chip-styles";
import { FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";

// Semi-transparent background pilot: blends with the Composer frosted surface, avoiding opaque blocks that clash with the base tone
// Must be inline (not inline-flex): the label text merges into the outer line box so the selection band matches plain text in height and color
// --chip-pad must equal the root px, --chip-mx must equal the root mx: lets the two spacers extend to cover the
// padding and margin selection band (see chip-shell.tsx)
export const DEBUG_CHIP_CLASS = `inline whitespace-nowrap rounded-md bg-red-500/10 px-1.5 py-0.5 text-xs ${FONT_WEIGHT_NORMAL} leading-none text-red-700 mx-0.5 [--chip-pad:6px] [--chip-mx:2px] dark:bg-red-500/15 dark:text-red-400`;

export function makeDebugChipNode(doc: Document, label = "Debug"): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-debug-chip", "true");
  span.dataset.debugChip = "true";
  span.className = DEBUG_CHIP_CLASS;
  span.setAttribute("aria-label", label);

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", String(COMPOSER_PILL_CHIP_ICON_SIZE_PX));
  icon.setAttribute("height", String(COMPOSER_PILL_CHIP_ICON_SIZE_PX));
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.75");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<path d="M12 12h.01"/><path d="M8 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16"/><path d="M3 7h18"/><path d="M3 11h18"/><path d="M3 15h18"/>';

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(label));
  return span;
}
