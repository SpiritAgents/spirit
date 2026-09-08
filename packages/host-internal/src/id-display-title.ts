import { WELL_KNOWN_CASING_OVERRIDES } from "./well-known-casing.js";

const ID_DISPLAY_TITLE_SEPARATOR_PATTERN = /[-:/_@]/g;
const PURE_DIGIT_TOKEN_PATTERN = /^\d+$/;

/** Treat adjacent pure-numeric segments as major/minor version numbers and merge them into `major.minor` (e.g. `4-8` → `4.8`). */
function mergeConsecutiveNumericVersionSegments(tokens: string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (
      current &&
      next &&
      PURE_DIGIT_TOKEN_PATTERN.test(current) &&
      PURE_DIGIT_TOKEN_PATTERN.test(next)
    ) {
      merged.push(`${current}.${next}`);
      index += 1;
      continue;
    }
    if (!current) {
      continue;
    }
    merged.push(current);
  }
  return merged;
}

/**
 * Longest-match override scan: a token sequence whose lowercase join is a key
 * is replaced by the override value verbatim; any other token is capitalized.
 */
function applyCasingOverrides(
  tokens: string[],
  casingOverrides: Readonly<Record<string, string>> | undefined,
): string[] {
  const keyLengths = casingOverrides
    ? [...new Set(Object.keys(casingOverrides).map((key) => key.split(" ").length))].sort(
        (a, b) => b - a,
      )
    : [];
  const result: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    let override: string | undefined;
    let overrideLength = 0;
    if (casingOverrides) {
      for (const length of keyLengths) {
        if (index + length > tokens.length) {
          continue;
        }
        const candidate =
          casingOverrides[
            tokens
              .slice(index, index + length)
              .join(" ")
              .toLowerCase()
          ];
        if (candidate) {
          override = candidate;
          overrideLength = length;
          break;
        }
      }
    }
    if (override) {
      result.push(override);
      index += overrideLength - 1;
      continue;
    }
    const word = tokens[index];
    if (!word) {
      continue;
    }
    result.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return result;
}

export interface FormatTitleFromIdOptions {
  /**
   * Casing overrides keyed by lowercase tokens joined with a single space:
   * single-word keys override one token, multi-word keys override that whole
   * token sequence. Longest match wins; matched sequences are emitted verbatim,
   * other tokens are capitalized. Matching is whole-token and case-insensitive
   * (`gpt` matches, `gpt4o` does not).
   */
  casingOverrides?: Readonly<Record<string, string>>;
}

/** Format an id into a display title: `-`/`:`/`/`/`_`/`@` → space, adjacent numeric segments merged into a dotted version, each word capitalized. */
export function formatTitleFromId(id: string, options?: FormatTitleFromIdOptions): string {
  const normalized = id
    .trim()
    .replace(ID_DISPLAY_TITLE_SEPARATOR_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return id;
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const casedTokens = applyCasingOverrides(tokens, options?.casingOverrides);
  const versionAwareTokens = mergeConsecutiveNumericVersionSegments(casedTokens);
  return versionAwareTokens.join(" ");
}

export function resolveModelDisplayTitle(input: {
  modelId: string;
  catalogDisplayName?: string | null;
  /** Keep the raw model id instead of formatting when there is no catalog displayName */
  preserveRawIdWithoutCatalogDisplayName?: boolean;
}): string {
  const catalogDisplayName = input.catalogDisplayName?.trim();
  if (catalogDisplayName) {
    return catalogDisplayName;
  }
  if (input.preserveRawIdWithoutCatalogDisplayName) {
    return input.modelId;
  }
  return formatTitleFromId(input.modelId, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES });
}

/** Format model ids in batch; only write into the map when the result differs from the id. */
export function buildFormattedDisplayTitlesFromIds(ids: readonly string[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const id of ids) {
    const formatted = formatTitleFromId(id, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES });
    if (formatted !== id) {
      titles[id] = formatted;
    }
  }
  return titles;
}
