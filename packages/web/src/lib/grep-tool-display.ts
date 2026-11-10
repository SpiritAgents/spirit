export type GrepRequestFields = {
  pattern?: string;
  glob?: string;
};

export function parseGrepRequestFromArgsExcerpt(
  argsExcerpt: string | undefined,
): GrepRequestFields | undefined {
  const excerpt = argsExcerpt?.trim();
  if (!excerpt) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(excerpt) as Record<string, unknown>;
    return {
      pattern: typeof parsed.pattern === "string" ? parsed.pattern : undefined,
      glob: typeof parsed.glob === "string" ? parsed.glob : undefined,
    };
  } catch {
    return undefined;
  }
}

export function grepToolHeadlineDetail(
  request: GrepRequestFields,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | undefined {
  const pattern = request.pattern?.trim() ?? "";
  const glob = request.glob?.trim() ?? "";
  if (pattern && glob) {
    return t("tool.searchQueryInGlob", { query: pattern, glob });
  }
  return pattern || glob || undefined;
}
