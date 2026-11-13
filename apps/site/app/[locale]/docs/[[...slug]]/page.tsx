import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";

import { getMDXComponents } from "@/components/mdx";
import { DocsTOC, DocsTOCPopover, DocsTOCProvider } from "@/components/docs-toc";
import { isSupportedLocale } from "@/i18n/config";
import { FONT_WEIGHT_MEDIUM, FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { getOgMetadataFields } from "@/lib/og/model";
import { resolveOgModel } from "@/lib/og/resolver";
import { source, toRelativeLinkPage } from "@/lib/source";

type PageProps = {
  params: Promise<{ locale: string; slug?: string[] }>;
};

export default async function DocsPageRoute({ params }: PageProps) {
  const { locale, slug } = await params;
  const page = source.getPage(slug, locale);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      className="max-w-none"
      tableOfContentPopover={{ enabled: false }}
      slots={{
        toc: {
          provider: DocsTOCProvider,
          main: DocsTOC,
          popover: DocsTOCPopover,
        },
      }}
    >
      <DocsTitle className={`${FONT_WEIGHT_MEDIUM} tracking-tight`}>{page.data.title}</DocsTitle>
      <DocsDescription className={FONT_WEIGHT_NORMAL}>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, toRelativeLinkPage(page)),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams("slug", "locale");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = source.getPage(slug, locale);
  if (!page) notFound();

  const ogModel = resolveOgModel(locale, ["docs", ...(slug ?? [])]);
  const ogFields = ogModel ? getOgMetadataFields(ogModel) : { openGraph: {}, twitter: {} };

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: isSupportedLocale(locale)
      ? {
          canonical: page.url,
          types: {
            "text/markdown": `${page.url}.md`,
          },
        }
      : undefined,
    openGraph: {
      type: "article",
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      ...ogFields.openGraph,
    },
    twitter: {
      card: "summary",
      title: page.data.title,
      description: page.data.description,
      ...ogFields.twitter,
    },
  };
}
