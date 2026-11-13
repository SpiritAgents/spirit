import assert from "node:assert/strict";
import test from "node:test";

import { product } from "@spiritagent/product";

import { getOgImageUrl, getOgMetadataFields } from "@/lib/og/model";

test("OG metadata uses absolute image URLs and large Twitter cards", () => {
  const fields = getOgMetadataFields({
    kind: "section",
    locale: "en-US",
    path: "download",
    title: "Download",
  });
  assert.equal(fields.twitter.card, "summary_large_image");
  assert.match(fields.openGraph.images[0].url, /^https:\/\//);
  assert.match(fields.openGraph.images[0].url, /\/og\/en-US\/download$/);
  assert.equal(fields.openGraph.images[0].width, 1200);
  assert.equal(fields.openGraph.images[0].height, 630);
  assert.equal(fields.openGraph.images[0].alt, "Download");
  assert.equal(fields.twitter.images[0].url, fields.openGraph.images[0].url);
});

test("OG image URLs follow Vercel previews without changing production", () => {
  const previousSiteUrl = process.env.SITE_URL;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousVercelUrl = process.env.VERCEL_URL;
  const model = { kind: "home", locale: "en-US", path: "", alt: "Spirit" } as const;

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    delete process.env.SITE_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "spirit-git-dynamic-og.vercel.app";
    assert.equal(getOgImageUrl(model), "https://spirit-git-dynamic-og.vercel.app/og/en-US");

    process.env.SITE_URL = "https://preview.spirit.test/";
    assert.equal(getOgImageUrl(model), "https://preview.spirit.test/og/en-US");

    delete process.env.SITE_URL;
    process.env.VERCEL_ENV = "production";
    assert.equal(getOgImageUrl(model), `${product.websiteOrigin}/og/en-US`);
  } finally {
    restoreEnv("SITE_URL", previousSiteUrl);
    restoreEnv("VERCEL_ENV", previousVercelEnv);
    restoreEnv("VERCEL_URL", previousVercelUrl);
  }
});
