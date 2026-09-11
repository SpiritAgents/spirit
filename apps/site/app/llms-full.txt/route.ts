import { flattenTree } from "fumadocs-core/page-tree";

import { DEFAULT_LOCALE } from "@/i18n/config";
import { getLLMText, type DocsPage } from "@/lib/get-llm-text";
import { source } from "@/lib/source";

export const revalidate = false;

function pagesInSidebarOrder(): DocsPage[] {
  const byUrl = new Map(source.getPages(DEFAULT_LOCALE).map((page) => [page.url, page]));
  const pages: DocsPage[] = [];
  const seen = new Set<string>();

  for (const item of flattenTree(source.getPageTree(DEFAULT_LOCALE).children)) {
    if (seen.has(item.url)) continue;
    const page = byUrl.get(item.url);
    if (!page) continue;
    seen.add(item.url);
    pages.push(page);
  }

  return pages;
}

export async function GET() {
  const sections = await Promise.all(pagesInSidebarOrder().map((page) => getLLMText(page)));
  return new Response(sections.join("\n\n---\n\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
