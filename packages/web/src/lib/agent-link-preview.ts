import type { LinkPreviewDocument } from "@spiritagent/api/types";

export type AgentLinkIconKind = "svg" | "raster" | "apple-touch";
export type AgentLinkIconColorScheme = "light" | "dark" | "any";

export type AgentLinkIcon = {
  url: string;
  kind: AgentLinkIconKind;
  colorScheme: AgentLinkIconColorScheme;
  order: number;
};

export type AgentLinkPreview = {
  finalUrl: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  icons: AgentLinkIcon[];
};

function nonEmpty(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function resolveAgentLinkAssetUrl(
  value: string | undefined,
  finalUrl: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, finalUrl);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function iconColorScheme(media: string): AgentLinkIconColorScheme | null {
  const normalized = media.trim().toLowerCase();
  if (normalized === "not all") return null;
  const dark = /prefers-color-scheme\s*:\s*dark/.test(normalized);
  const light = /prefers-color-scheme\s*:\s*light/.test(normalized);
  if (dark === light) return "any";
  return dark ? "dark" : "light";
}

export function parseAgentLinkPreviewDocument(document: LinkPreviewDocument): AgentLinkPreview {
  const parsed = new DOMParser().parseFromString(document.headHtml, "text/html");
  const metas = [...parsed.querySelectorAll("meta")];
  const meta = (...names: string[]): string | undefined => {
    for (const name of names) {
      for (const element of metas) {
        const key = nonEmpty(element.getAttribute("property") ?? element.getAttribute("name"));
        if (key?.toLowerCase() === name) {
          const content = nonEmpty(element.getAttribute("content"));
          if (content) return content;
        }
      }
    }
    return undefined;
  };

  const icons: AgentLinkIcon[] = [];
  for (const link of parsed.querySelectorAll("link[rel][href]")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const appleTouch =
      rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!appleTouch && !rel.includes("icon")) continue;
    const colorScheme = iconColorScheme(link.getAttribute("media") ?? "");
    const url = resolveAgentLinkAssetUrl(nonEmpty(link.getAttribute("href")), document.finalUrl);
    if (!colorScheme || !url) continue;
    const type = (link.getAttribute("type") ?? "").toLowerCase();
    const svg = type === "image/svg+xml" || new URL(url).pathname.toLowerCase().endsWith(".svg");
    icons.push({
      url,
      kind: appleTouch ? "apple-touch" : svg ? "svg" : "raster",
      colorScheme,
      order: icons.length,
    });
  }

  const title =
    meta("og:title", "twitter:title") ?? nonEmpty(parsed.querySelector("title")?.textContent);
  const description = meta("og:description", "twitter:description") ?? meta("description");
  const imageUrl = resolveAgentLinkAssetUrl(
    meta("og:image:secure_url", "og:image:url", "og:image"),
    document.finalUrl,
  );
  return {
    finalUrl: document.finalUrl,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    icons,
  };
}

function iconGroup(icons: AgentLinkIcon[], colorScheme: AgentLinkIconColorScheme): AgentLinkIcon[] {
  const rank: Record<AgentLinkIconKind, number> = { svg: 0, raster: 1, "apple-touch": 2 };
  return icons
    .filter((icon) => icon.colorScheme === colorScheme)
    .toSorted((left, right) => rank[left.kind] - rank[right.kind] || left.order - right.order);
}

export function agentLinkIconCandidates(
  preview: AgentLinkPreview,
  resolvedDark: boolean,
): string[] {
  const matching = resolvedDark ? "dark" : "light";
  const other = resolvedDark ? "light" : "dark";
  const candidates = [
    ...iconGroup(preview.icons, matching),
    ...iconGroup(preview.icons, "any"),
    ...iconGroup(preview.icons, other),
  ].map((icon) => icon.url);
  const favicon = resolveAgentLinkAssetUrl("/favicon.ico", preview.finalUrl);
  if (favicon) candidates.push(favicon);
  return [...new Set(candidates)];
}
