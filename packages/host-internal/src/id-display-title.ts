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

/** Format an id into a display title: `-`/`:`/`/`/`_`/`@` → space, adjacent numeric segments merged into a dotted version, each word capitalized. */
export function formatTitleFromId(id: string): string {
  const normalized = id
    .trim()
    .replace(ID_DISPLAY_TITLE_SEPARATOR_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return id;
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const versionAwareTokens = mergeConsecutiveNumericVersionSegments(tokens);

  return versionAwareTokens
    .map((word) => {
      if (!word) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
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
  return formatTitleFromId(input.modelId);
}

/** Format ids in batch; only write into the map when the result differs from the id. */
export function buildFormattedDisplayTitlesFromIds(ids: readonly string[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const id of ids) {
    const formatted = formatTitleFromId(id);
    if (formatted !== id) {
      titles[id] = formatted;
    }
  }
  return titles;
}
