const ENDS_WITH_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const STARTS_WITH_CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ENDS_WITH_LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Number}]$/u;
const STARTS_WITH_LATIN_OR_DIGIT = /^[\p{Script=Latin}\p{Number}]/u;

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

/** Join UI text runs, adding one ASCII space only at unspaced CJK/Latin-or-digit boundaries. */
export function joinWithCjkSpacing(...parts: string[]): string {
  return parts.reduce((joined, part) => {
    const needsSpace =
      (ENDS_WITH_CJK.test(joined) && STARTS_WITH_LATIN_OR_DIGIT.test(part)) ||
      (ENDS_WITH_LATIN_OR_DIGIT.test(joined) && STARTS_WITH_CJK.test(part));
    return `${joined}${needsSpace ? " " : ""}${part}`;
  }, "");
}
