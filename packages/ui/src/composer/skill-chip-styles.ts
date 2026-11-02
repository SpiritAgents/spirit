import { FONT_WEIGHT_NORMAL } from "../typography.js";

// Icon-less chip: the left padding has no selection background source (native does not paint selection
// over element padding), so it is removed to let the text selection start at the chip's left edge;
// the right padding is covered by the text selection extending rightward (see chip-shell.tsx)
// Must be inline (not inline-flex): only then can the label text merge into the outer line box, giving the selection band the same height and color as plain text
// --chip-pad must equal the root px and --chip-mx the root mx: lets the leading/trailing spacers extend over
// the selection band covering padding and margin (see chip-shell.tsx)
export const SKILL_CHIP_CLASS = `inline whitespace-nowrap px-0.5 py-0.5 text-sm ${FONT_WEIGHT_NORMAL} leading-none text-yellow-600 mx-0.5 [--chip-pad:2px] [--chip-mx:2px] dark:text-amber-400`;

export function makeSkillChipNode(alias: string, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-skill-chip", "true");
  span.dataset.skillChip = "true";
  span.dataset.skillAlias = alias;
  span.setAttribute("data-skill-alias", alias);
  span.className = SKILL_CHIP_CLASS;
  span.setAttribute("aria-label", alias);

  span.appendChild(doc.createTextNode(alias));
  return span;
}
