import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { docsI18n } from "@/lib/docs-i18n";

const docs = defineDocs({
  dir: ".generated/product/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const source = loader({
  baseUrl: "/docs",
  i18n: docsI18n,
  source: docs.toFumadocsSource(),
});

type RelativeLinkPage = {
  path: string;
  locale?: string;
};

/**
 * Fumadocs i18n `parser: "dir"` strips the language directory from the storage key,
 * but `page.path` is still `en-US/index.mdx`. `resolveHref` looks up
 * `en-US.en-US/quickstart.mdx` via `dirname(page.path)`, so every relative link
 * misses and the href lands as-is on `/en-US/quickstart.mdx`. Here the path is
 * reduced to the storage key before handing it to createRelativeLink.
 */
export function toRelativeLinkPage<T extends RelativeLinkPage>(page: T): T {
  const locale = page.locale;
  if (!locale) return page;
  const prefix = `${locale}/`;
  if (!page.path.startsWith(prefix)) return page;
  return { ...page, path: page.path.slice(prefix.length) };
}
