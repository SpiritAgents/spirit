import {
  DEFAULT_LOCALE,
  getLocaleLabel,
  getLocalePath,
  getOgLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/i18n/config";
import { messagesByLocale } from "@/i18n/messages";
import { SPIRIT_GITHUB_REPO_URL, SPIRIT_RELEASES_URL } from "@/lib/github-links";

export const DEFAULT_SITE_ORIGIN = "https://spirit.dev";

export function getSiteOrigin(): string {
  return (process.env.SITE_URL ?? DEFAULT_SITE_ORIGIN).replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localePath(locale: AppLocale, suffix = ""): string {
  return getLocalePath(locale, suffix);
}

function absoluteUrl(siteOrigin: string, path: string): string {
  return `${siteOrigin.replace(/\/$/, "")}${path}`;
}

function headingLinesToHtml(lines: string[], tag: "h1" | "h2"): string {
  return lines.map((line) => `<${tag}>${escapeHtml(line)}</${tag}>`).join("\n");
}

function headingLinesToMarkdown(lines: string[], level: 1 | 2): string {
  const prefix = "#".repeat(level);
  return `${prefix} ${lines.join(" ")}`;
}

export function renderSiteBodyHtml(locale: AppLocale): string {
  const messages = messagesByLocale[locale];
  const nav = messages.hero.nav;
  const fm = messages.footer;
  const base = localePath(locale);
  const year = new Date().getFullYear();

  const heroHeadline = messages.hero.headline.split("\n");
  const featureHeading = messages.landing.featureHeading;
  const agentHeading = messages.landing.agent.featureHeading;
  const trio = messages.landing.trio;

  return `<main>
  <header>
    <p>${escapeHtml(messages.common.brand)}</p>
    <nav aria-label="${escapeHtml(messages.hero.primaryNavAria)}">
      <ul>
        <li><a href="${base}#features">${escapeHtml(nav.features)}</a></li>
        <li><a href="${base}#agent">${escapeHtml(nav.agent)}</a></li>
        <li><a href="${localePath(locale, "/docs")}">${escapeHtml(nav.docs)}</a></li>
        <li><a href="${SPIRIT_GITHUB_REPO_URL}">${escapeHtml(nav.github)}</a></li>
      </ul>
    </nav>
  </header>
  <section id="site-hero" aria-label="${escapeHtml(messages.hero.sectionAria)}">
    ${headingLinesToHtml(heroHeadline, "h1")}
    <p>${escapeHtml(messages.hero.tagline)}</p>
    <p><a href="${SPIRIT_GITHUB_REPO_URL}/releases/latest">${escapeHtml(messages.common.download)}</a></p>
  </section>
  <section id="agent" aria-label="${escapeHtml(messages.landing.agent.sectionAria)}">
    ${headingLinesToHtml(agentHeading, "h2")}
    <p>${escapeHtml(messages.landing.agent.featureBody)}</p>
  </section>
  <section id="docs" aria-label="${escapeHtml(messages.landing.sectionAria)}">
    <section id="features">
      ${headingLinesToHtml(featureHeading, "h2")}
      <p>${escapeHtml(messages.landing.featureBody)}</p>
    </section>
  </section>
  <section id="highlights" aria-label="${escapeHtml(trio.sectionAria)}">
    <article>
      <h2>${escapeHtml(trio.completion.title)}</h2>
      <p>${escapeHtml(trio.completion.body)}</p>
    </article>
    <article>
      <h2>${escapeHtml(trio.toolCards.title)}</h2>
      <p>${escapeHtml(trio.toolCards.body)}</p>
    </article>
    <article>
      <h2>${escapeHtml(trio.placeholder.title)}</h2>
      <p>${escapeHtml(trio.placeholder.body)}</p>
    </article>
  </section>
  <section aria-label="${escapeHtml(messages.landing.ctaSectionAria)}">
    <h2>${escapeHtml(messages.landing.ctaTitle)}</h2>
    <p><a href="${SPIRIT_GITHUB_REPO_URL}/releases/latest">${escapeHtml(messages.common.download)}</a></p>
  </section>
  <footer>
    <nav aria-label="${escapeHtml(fm.navAria)}">
      <p>${escapeHtml(fm.columns.features)}</p>
      <ul>
        <li><a href="${base}#agent">${escapeHtml(nav.agent)}</a></li>
        <li><a href="${base}#features">${escapeHtml(nav.byok)}</a></li>
      </ul>
      <p>${escapeHtml(fm.columns.resources)}</p>
      <ul>
        <li><a href="${localePath(locale, "/docs")}">${escapeHtml(nav.docs)}</a></li>
        <li><a href="${SPIRIT_RELEASES_URL}">${escapeHtml(fm.changelog)}</a></li>
        <li><a href="/notice.md">${escapeHtml(fm.openSourceLicenses)}</a></li>
      </ul>
    </nav>
    <p>${escapeHtml(fm.copyrightLine(year))}</p>
    <p><a href="${SPIRIT_GITHUB_REPO_URL}">GitHub</a></p>
  </footer>
</main>`;
}

export function renderSiteMarkdown(locale: AppLocale): string {
  const messages = messagesByLocale[locale];
  const nav = messages.hero.nav;
  const fm = messages.footer;
  const base = localePath(locale);
  const year = new Date().getFullYear();
  const trio = messages.landing.trio;

  const lines = [
    headingLinesToMarkdown(messages.hero.headline.split("\n"), 1),
    "",
    messages.hero.tagline,
    "",
    `[${messages.common.download}](${SPIRIT_GITHUB_REPO_URL}/releases/latest)`,
    "",
    "---",
    "",
    headingLinesToMarkdown(messages.landing.agent.featureHeading, 2),
    "",
    messages.landing.agent.featureBody,
    "",
    headingLinesToMarkdown(messages.landing.featureHeading, 2),
    "",
    messages.landing.featureBody,
    "",
    `## ${trio.completion.title}`,
    "",
    trio.completion.body,
    "",
    `## ${trio.toolCards.title}`,
    "",
    trio.toolCards.body,
    "",
    `## ${trio.placeholder.title}`,
    "",
    trio.placeholder.body,
    "",
    `## ${messages.landing.ctaTitle}`,
    "",
    `[${messages.common.download}](${SPIRIT_GITHUB_REPO_URL}/releases/latest)`,
    "",
    "---",
    "",
    `### ${fm.columns.features}`,
    "",
    `- [${nav.agent}](${base}#agent)`,
    `- [${nav.byok}](${base}#features)`,
    "",
    `### ${fm.columns.resources}`,
    "",
    `- [${nav.docs}](${localePath(locale, "/docs")})`,
    `- [${fm.changelog}](${SPIRIT_RELEASES_URL})`,
    `- [${fm.openSourceLicenses}](/notice.md)`,
    "",
    fm.copyrightLine(year),
    "",
    `[GitHub](${SPIRIT_GITHUB_REPO_URL})`,
  ];

  return `${lines.join("\n")}\n`;
}

export function renderDownloadBodyHtml(locale: AppLocale): string {
  const messages = messagesByLocale[locale];
  const nav = messages.hero.nav;
  const fm = messages.footer;
  const download = messages.download;
  const base = localePath(locale);
  const downloadPath = localePath(locale, "download");
  const year = new Date().getFullYear();

  return `<main>
  <header>
    <p><a href="${base}">${escapeHtml(messages.common.brand)}</a></p>
    <nav aria-label="${escapeHtml(messages.hero.primaryNavAria)}">
      <ul>
        <li><a href="${base}#features">${escapeHtml(nav.features)}</a></li>
        <li><a href="${base}#agent">${escapeHtml(nav.agent)}</a></li>
        <li><a href="${downloadPath}">${escapeHtml(messages.common.download)}</a></li>
      </ul>
    </nav>
  </header>
  <section aria-label="${escapeHtml(download.sectionAria)}">
    <h1>${escapeHtml(download.title)}</h1>
  </section>
  <section id="download-channels" aria-label="${escapeHtml(download.sectionAria)}">
    <article>
      <h2>${escapeHtml(download.desktop)}</h2>
      <p><a href="${SPIRIT_GITHUB_REPO_URL}/releases/latest">${escapeHtml(messages.common.download)}</a></p>
    </article>
    <article>
      <h2>${escapeHtml(download.cli)}</h2>
      <p>${escapeHtml(download.copyInstall)}</p>
      <pre>curl -fsSL https://spirit.dev/install | bash</pre>
    </article>
    <article>
      <h2>${escapeHtml(download.acp)}</h2>
      <p>${escapeHtml(download.comingSoonJoke)}</p>
    </article>
  </section>
  <footer>
    <p>${escapeHtml(fm.copyrightLine(year))}</p>
    <p><a href="${SPIRIT_GITHUB_REPO_URL}">GitHub</a></p>
  </footer>
</main>`;
}

export function renderDownloadMarkdown(locale: AppLocale): string {
  const messages = messagesByLocale[locale];
  const download = messages.download;
  const downloadPath = localePath(locale, "download");

  return [
    `# ${download.title}`,
    "",
    download.metaDescription,
    "",
    `## ${download.desktop}`,
    "",
    `[${messages.common.download}](${SPIRIT_GITHUB_REPO_URL}/releases/latest)`,
    "",
    `## ${download.cli}`,
    "",
    download.copyInstall,
    "",
    "```bash",
    "curl -fsSL https://spirit.dev/install | bash",
    "```",
    "",
    `## ${download.acp}`,
    "",
    download.comingSoonJoke,
    "",
    `[${messages.common.brand}](${localePath(locale)}) · [${messages.common.download}](${downloadPath})`,
    "",
  ].join("\n");
}

export function renderHeadMeta(
  locale: AppLocale,
  siteOrigin: string,
  page: "home" | "download" = "home",
): string {
  const messages = messagesByLocale[locale];
  const title = page === "download" ? messages.download.metaTitle : messages.meta.title;
  const description =
    page === "download" ? messages.download.metaDescription : messages.meta.description;
  const canonicalPath = page === "download" ? localePath(locale, "download") : localePath(locale);
  const canonicalUrl = absoluteUrl(siteOrigin, canonicalPath);
  const markdownPath = `${canonicalPath}/index.md`;
  const markdownUrl = absoluteUrl(siteOrigin, markdownPath);
  const ogLocale = getOgLocale(locale);

  const alternateLinks = SUPPORTED_LOCALES.map((supportedLocale) => {
    const href = absoluteUrl(
      siteOrigin,
      page === "download" ? localePath(supportedLocale, "download") : localePath(supportedLocale),
    );
    return `<link rel="alternate" hreflang="${supportedLocale}" href="${escapeHtml(href)}" />`;
  }).join("\n    ");

  return `<title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    ${alternateLinks}
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(absoluteUrl(siteOrigin, "/"))}" />
    <link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:locale" content="${ogLocale}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />`;
}

export function renderRootRedirectHtml(siteOrigin: string): string {
  const defaultUrl = absoluteUrl(siteOrigin, localePath(DEFAULT_LOCALE));
  const links = SUPPORTED_LOCALES.map((locale) => {
    const href = absoluteUrl(siteOrigin, localePath(locale));
    return `<li><a href="${escapeHtml(href)}">${escapeHtml(getLocaleLabel(locale))}</a></li>`;
  }).join("\n      ");

  return `<!doctype html>
<html lang="en-US">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spirit</title>
    <meta http-equiv="refresh" content="0; url=${escapeHtml(defaultUrl)}" />
    <link rel="canonical" href="${escapeHtml(defaultUrl)}" />
  </head>
  <body>
    <p>Redirecting…</p>
    <ul>
      ${links}
    </ul>
  </body>
</html>
`;
}

export function renderSitemapXml(siteOrigin: string): string {
  const origin = siteOrigin.replace(/\/$/, "");
  const urls = [
    { loc: `${origin}/`, changefreq: "weekly", priority: "1.0" },
    ...SUPPORTED_LOCALES.flatMap((locale) => [
      {
        loc: `${origin}${localePath(locale)}`,
        changefreq: "weekly",
        priority: "0.9",
      },
      {
        loc: `${origin}${localePath(locale, "download")}`,
        changefreq: "weekly",
        priority: "0.8",
      },
    ]),
  ];

  const body = urls
    .map(
      (entry) => `  <url>
    <loc>${entry.loc}</loc>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function renderRobotsTxt(siteOrigin: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${siteOrigin.replace(/\/$/, "")}/sitemap.xml
`;
}
