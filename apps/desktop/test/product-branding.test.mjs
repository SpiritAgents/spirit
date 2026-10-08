import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import glyphBlackUrl from "@spiritagent/brand/assets/glyph-black.svg?url";
import glyphWhiteUrl from "@spiritagent/brand/assets/glyph-white.svg?url";
import logoDarkUrl from "@spiritagent/brand/assets/logo-dark.svg?url";
import sharp from "sharp";
import { test } from "vitest";
import { parseHTML } from "linkedom";
import { product, PRODUCT_BUILD_ID } from "@spiritagent/product";

import { spiritAgentBrandIconSrc, spiritAgentTitleBarIconSrc } from "../src/lib/brand-icon.ts";
import { renderProductHtml } from "../vite.config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");

const FORBIDDEN_PATTERNS = [/Spirit Agent Desktop MVP/, /Spirit Agent Desktop/, /Spirit Agent/];
const SCAN_SKIP_DIRS = new Set(["node_modules", "dist", "out", "dist-electron", ".dev-electron", "release"]);
const SCAN_SKIP_FILES = new Set(["README.md", "test/product-branding.test.mjs"]);

/** Commit/PR trailers still credit the agent as "Spirit Agent", not the product name. */
function stripAllowedAgentAttribution(content) {
  return content
    .replace(/"commitAttributionDescription":\s*"[^"]*"/g, '""')
    .replace(/"prAttributionDescription":\s*"[^"]*"/g, '""');
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

test("index.html resolves its title from the baked product", async () => {
  const html = await readFile(join(desktopRoot, "index.html"), "utf8");
  const { document } = parseHTML(renderProductHtml(html));
  assert.equal(document.title, product.name);
  assert.equal(
    document.querySelector('meta[name="spirit-product-build"]').getAttribute("content"),
    PRODUCT_BUILD_ID,
  );
  assert.doesNotMatch(document.title, /\{\{product\./);
});

test("about dialog message is Spirit without Desktop/MVP", async () => {
  const source = await readFile(join(desktopRoot, "electron/application-menu.ts"), "utf8");
  assert.match(source, /message:\s*PRODUCT_DISPLAY_NAME/);
  assert.doesNotMatch(source, /message:\s*'Spirit Agent Desktop/);
  assert.doesNotMatch(source, /Desktop MVP/);
});

test("glass title-bar branding stays dark while monochrome glyphs follow the UI theme", () => {
  assert.equal(spiritAgentTitleBarIconSrc(false, true), spiritAgentTitleBarIconSrc(true, true));
  assert.equal(spiritAgentTitleBarIconSrc(false, true), logoDarkUrl);
  assert.equal(spiritAgentBrandIconSrc(false), glyphBlackUrl);
  assert.equal(spiritAgentBrandIconSrc(true), glyphWhiteUrl);
});

test("glass brand masters retain opaque canvases and visible details at small sizes", async () => {
  const brandAssets = join(desktopRoot, "../../packages/brand/assets");
  const logoFiles = (await readdir(brandAssets)).filter((filename) =>
    ["logo-light.svg", "logo-dark.svg"].includes(filename),
  );
  for (const filename of logoFiles) {
    const source = join(brandAssets, filename);
    const background = filename === "logo-light.svg" ? 255 : 0;
    for (const size of [16, 24, 32, 64, 512]) {
      const { data, info } = await sharp(source)
        .resize(size, size)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(info.width, size);
      assert.equal(info.height, size);
      assert.deepEqual([...data.subarray(0, 4)], [background, background, background, 255]);
      let maxContrast = 0;
      for (let offset = 0; offset < data.length; offset += info.channels) {
        assert.equal(data[offset + 3], 255);
        maxContrast = Math.max(maxContrast, Math.abs(data[offset] - background));
      }
      assert.ok(maxContrast >= 40, `${filename} at ${size}px lost its glass outline`);
    }
  }
});

test("apps/desktop has no forbidden product-name strings outside README", async () => {
  const files = await collectFiles(desktopRoot);
  const violations = [];

  for (const filePath of files) {
    const rel = relative(desktopRoot, filePath);
    if (SCAN_SKIP_FILES.has(rel)) continue;

    const content = stripAllowedAgentAttribution(await readFile(filePath, "utf8"));
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${rel} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
