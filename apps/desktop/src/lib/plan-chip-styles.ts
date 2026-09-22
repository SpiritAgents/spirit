import { COMPOSER_PILL_CHIP_ICON_SIZE_PX } from "@/lib/composer-inline-chip-styles";
import { FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";

// Translucent background: blends with the Composer frosted surface, avoiding opaque blocks mismatching the background tone
// Must be inline (not inline-flex): only then can the label text merge into the outer line box, giving the selection band the same height and color as plain text
// --chip-pad must equal the root px and --chip-mx the root mx: lets the two spacers extend over the selection
// band covering padding and margin (see chip-shell.tsx)
export const PLAN_CHIP_CLASS = `inline whitespace-nowrap rounded-md bg-orange-300/20 px-1.5 py-0.5 text-xs ${FONT_WEIGHT_NORMAL} leading-none text-yellow-600 mx-0.5 [--chip-pad:6px] [--chip-mx:2px] dark:bg-orange-300/15 dark:text-orange-300`;

export function makePlanChipNode(doc: Document, label = "Plan"): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-plan-chip", "true");
  span.dataset.planChip = "true";
  span.className = PLAN_CHIP_CLASS;
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
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/><path d="M8 12h8"/><path d="M8 16h8"/><path d="M8 8h8"/>';

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(label));
  return span;
}
