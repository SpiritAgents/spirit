import { getSiteOrigin } from "@/content/site-document";
import type { AppLocale } from "@/i18n/config";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type OgModel =
  | { kind: "home"; locale: AppLocale; path: ""; alt: string }
  | { kind: "section"; locale: AppLocale; path: string; title: string }
  | { kind: "detail"; locale: AppLocale; path: string; title: string; groups: string[] };

export function getOgImageUrl(model: OgModel): string {
  const suffix = model.path ? `/${model.path}` : "";
  return `${getSiteOrigin()}/og/${model.locale}${suffix}`;
}

export function getOgImageAlt(model: OgModel): string {
  return model.kind === "home" ? model.alt : model.title;
}

export function getOgMetadataFields(model: OgModel) {
  const url = getOgImageUrl(model);
  const alt = getOgImageAlt(model);
  return {
    openGraph: {
      images: [{ url, width: OG_WIDTH, height: OG_HEIGHT, alt }],
    },
    twitter: {
      card: "summary_large_image" as const,
      images: [{ url, alt }],
    },
  };
}
