import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { register } from "fumadocs-mdx/node";
import { product } from "@spiritagent/product";
import { SUPPORTED_LOCALES } from "../src/i18n/config";
import { messagesByLocale } from "../src/i18n/messages";
import {
  getSiteOrigin,
  renderDownloadBodyHtml,
  renderDownloadMarkdown,
  renderRootRedirectHtml,
  renderSiteBodyHtml,
  renderSiteMarkdown,
} from "../src/content/site-document";
import { resolveDesktopTranslation } from "../src/lib/desktop-i18n-map";
import { spiritDownloadUrl } from "../src/lib/spirit-download-urls";
import { buildPageMetadata } from "../src/lib/page-metadata";
import { interpolateProductCopy } from "../src/i18n/product-copy";

register();

test("all locale surfaces resolve explicit product variables", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = messagesByLocale[locale];
    assert.equal(messages.common.brand, product.name);
    assert.equal(resolveDesktopTranslation("tray.tooltip", locale, messages), product.name);
    assert.ok(
      resolveDesktopTranslation("sidebar.removeWorkspaceConfirmDescription", locale, messages, {
        count: 2,
      }).includes(product.name),
    );
    for (const rendered of [
      renderSiteBodyHtml(locale),
      renderSiteMarkdown(locale),
      renderDownloadBodyHtml(locale),
      renderDownloadMarkdown(locale),
      resolveDesktopTranslation("titleBar.about", locale, messages),
    ]) {
      assert.doesNotMatch(rendered, /\{\{product\./);
    }
  }
  assert.throws(() => interpolateProductCopy("{{product.missing}}"), /Unknown product copy field/);
});

test("preview site origin does not override official download endpoints", () => {
  const previous = process.env.SITE_URL;
  try {
    process.env.SITE_URL = "http://127.0.0.1:9413";
    assert.equal(getSiteOrigin(), process.env.SITE_URL);
    assert.equal(
      buildPageMetadata("en-US", "home").alternates?.canonical,
      `${process.env.SITE_URL}/en-US`,
    );
    assert.equal(
      new URL(spiritDownloadUrl("desktop", "darwin", "arm64")).origin,
      product.downloadOrigin,
    );
    assert.ok(renderDownloadMarkdown("en-US").includes(`${product.websiteOrigin}/install`));
    assert.ok(renderRootRedirectHtml(getSiteOrigin()).includes(product.name));
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});

test("all locales compile product-aware storage guidance as MDX", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const compiled = await import(
      new URL(`../.generated/product/docs/${locale}/config.mdx`, import.meta.url).href
    );
    const html = renderToStaticMarkup(createElement(compiled.default));
    assert.ok(html.includes("Stable"));
    assert.ok(html.includes("Dev"));
    assert.ok(
      html.includes(`/${product.workspaceDataFolderName}`) ||
        html.includes(`${product.workspaceDataFolderName}/`),
    );
    assert.doesNotMatch(html, /\{\{product\./);
    assert.ok(html.includes("%USERPROFILE%"));
  }
});
