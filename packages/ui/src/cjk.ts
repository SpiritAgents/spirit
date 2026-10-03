/**
 * Full-width CJK punctuation (。！？… — U+3001–U+303F CJK Symbols and Punctuation, and
 * U+FF01–U+FF60 fullwidth forms) already carries trailing whitespace inside its glyph box.
 */
export function endsWithFullWidthCjkPunctuation(text: string): boolean {
  return /[\u3001-\u303F\uFF01-\uFF60]$/u.test(text.trimEnd());
}

/**
 * Whether an ASCII word space is needed between `text` and inline content appended after it
 * (a link, chip, button label, …). Latin typography wants the space; a sentence-final
 * full-width CJK punctuation mark already provides the visual gap, so an added space reads
 * as a double gap.
 */
export function needsSpaceBeforeInlineContent(text: string): boolean {
  return !endsWithFullWidthCjkPunctuation(text);
}
