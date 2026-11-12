import { looksLikeAbsolutePath } from "@/lib/file-picker-path";

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u;

/**
 * True for workspace-relative or filesystem paths that rehype-harden's parseUrl
 * otherwise rejects (bare relatives like `docs/README.md` have no `./` prefix).
 */
export function isMarkdownLocalPathUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return false;
  }
  if (looksLikeAbsolutePath(trimmed)) {
    return true;
  }
  return SCHEME_PATTERN.exec(trimmed) === null;
}

/** Harden only treats `/`, `./`, and `../` as relative; prefix everything else that is still local. */
export function prefixBareRelativeMarkdownUrl(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    looksLikeAbsolutePath(trimmed)
  ) {
    return trimmed;
  }
  return `./${trimmed}`;
}
