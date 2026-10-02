import { Fragment, type ReactNode } from "react";
import { product } from "@spiritagent/product";

/** Marks a DOM fragment as non-translatable for Safari / Google Translate. */
export function NoTranslate({ children }: { children: ReactNode }) {
  return (
    <span translate="no" className="notranslate">
      {children}
    </span>
  );
}

const BRAND_TOKEN_PATTERN = new RegExp(
  [product.name, "BYOK"].map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g",
);

/**
 * Wrap brand / product tokens so browser page translation leaves them intact
 * while still translating surrounding copy.
 */
export function protectBrandTokens(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  BRAND_TOKEN_PATTERN.lastIndex = 0;
  while ((match = BRAND_TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<NoTranslate key={`brand-${key++}`}>{match[0]}</NoTranslate>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) {
    return text;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}
