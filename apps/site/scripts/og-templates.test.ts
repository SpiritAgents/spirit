import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { SUPPORTED_LOCALES } from "@/i18n/config";
import { messagesByLocale } from "@/i18n/messages";
import { getOgSourceText } from "@/lib/og/templates";
import { renderOgImage } from "@/lib/og/templates";

async function expectPng(response: Response) {
  assert.match(response.headers.get("content-type") ?? "", /image\/png/);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  return buffer;
}

test("home renders the centered glass logo", async () => {
  await expectPng(
    await renderOgImage({ kind: "home", locale: "en-US", path: "", alt: "Spirit" }),
  );
});

for (const locale of SUPPORTED_LOCALES) {
  test(`${locale} renders a localized section image`, async () => {
    await expectPng(
      await renderOgImage({
        kind: "section",
        locale,
        path: "docs",
        title: messagesByLocale[locale].hero.nav.docs,
      }),
    );
  });
}

test("detail renders a single group and multiline title", async () => {
  await expectPng(
    await renderOgImage({
      kind: "detail",
      locale: "en-US",
      path: "docs/customize/extensions",
      title: "An in-project guide to extending Spirit\nAnd a second line.",
      groups: ["Partnership"],
    }),
  );
});

test("detail renders multiple groups and clamps long titles", async () => {
  await expectPng(
    await renderOgImage({
      kind: "detail",
      locale: "zh-CN",
      path: "docs/customize/group/extensions",
      title: "这是一个用于验证超长文档标题在有限宽度内换行、截断并且不会贴近页面边缘的测试标题。",
      groups: ["Customize", "Group 2"],
    }),
  );
});

test("detail renders without a group", async () => {
  await expectPng(
    await renderOgImage({
      kind: "detail",
      locale: "en-US",
      path: "docs/providers",
      title: "Providers",
      groups: [],
    }),
  );
});

test("ungrouped detail text does not gain a synthetic leading newline", () => {
  assert.equal(
    getOgSourceText({
      kind: "detail",
      locale: "en-US",
      path: "docs/providers",
      title: "Providers",
      groups: [],
    }),
    "Providers",
  );
  assert.equal(
    getOgSourceText({
      kind: "detail",
      locale: "en-US",
      path: "docs/providers",
      title: "First line\nSecond line",
      groups: [],
    }),
    "First line\nSecond line",
  );
});
