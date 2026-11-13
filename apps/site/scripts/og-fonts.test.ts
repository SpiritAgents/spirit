import assert from "node:assert/strict";
import test from "node:test";

import { loadOgFonts, parseFontCss, sanitizeOgText } from "@/lib/og/fonts";

test("font CSS parser keeps WOFF files and unicode ranges", () => {
  const css = `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 400;
      src: url(./files/inter-latin-400-normal.woff2) format('woff2'),
           url(./files/inter-latin-400-normal.woff) format('woff');
      unicode-range: U+0000-00FF, U+2000-206F;
    }
  `;
  const records = parseFontCss(css, "/fonts/400.css");
  assert.deepEqual(records, [
    {
      family: "Inter",
      filePath: "/fonts/files/inter-latin-400-normal.woff",
      ranges: [
        [0, 255],
        [8192, 8303],
      ],
    },
  ]);
});

test("text sanitization replaces emoji and uncovered codepoints locally", () => {
  const records = parseFontCss(
    `@font-face {
      font-family: 'Inter';
      src: url(./files/inter-latin-400-normal.woff) format('woff');
      unicode-range: U+0000-00FF, U+2000-206F;
    }`,
    "/fonts/400.css",
  );
  assert.equal(sanitizeOgText("Spirit ✨ 文\nA", records), "Spirit � �\nA");
});

test("latin and Cyrillic text loads only Inter WOFF buffers", async () => {
  const result = await loadOgFonts("Spirit Документация", "ru");
  assert.equal(result.fontFamily, "Inter");
  assert.equal(result.text, "Spirit Документация");
  assert.ok(result.fonts.length > 0);
  for (const font of result.fonts) {
    assert.equal(font.name, "Inter");
    assert.equal(font.weight, 400);
    assert.ok(font.data.length > 0);
  }
});

for (const [locale, text, family] of [
  ["zh-CN", "文档", "Noto Sans SC"],
  ["zh-TW", "文件", "Noto Sans TC"],
  ["ja", "ドキュメント", "Noto Sans JP"],
  ["ko", "문서", "Noto Sans KR"],
] as const) {
  test(`${locale} loads Inter and ${family} from local packages`, async () => {
    const result = await loadOgFonts(`Spirit ${text}`, locale);
    assert.ok(result.fontFamily.includes("Inter"));
    assert.ok(result.fontFamily.includes(family));
    assert.ok(result.fonts.some((font) => font.name === "Inter"));
    assert.ok(result.fonts.some((font) => font.name === family));
    assert.equal(result.text, `Spirit ${text}`);
  });
}
