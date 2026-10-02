import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { product, PRODUCT_BUILD_ID } from "@spiritagent/product";
import { verifyRendererProduct } from "../scripts/electron-builder-before-build.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
const { getConfig } = builderRequire("app-builder-lib/out/util/config/config.js");

test("electron-builder loads baked product metadata without losing platform settings", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const config = await getConfig(root, "electron-builder.config.mjs");
  assert.equal(config.productName, product.name);
  assert.equal(config.extraMetadata.productBuildId, PRODUCT_BUILD_ID);
  assert.equal(config.extraMetadata.main, "dist-electron/electron/main.js");
  assert.equal(config.extraMetadata.homepage, product.websiteOrigin);
  assert.deepEqual(config.protocols, [{ name: product.name, schemes: [product.urlProtocol] }]);
  assert.equal(config.artifactName, `${product.name}-Desktop-\${version}-\${os}-\${arch}.\${ext}`);
  assert.equal(
    config.mac.artifactName,
    `${product.name}-Desktop-\${version}-darwin-\${arch}.\${ext}`,
  );
  assert.equal(config.mac.category, "public.app-category.productivity");
  assert.equal(config.appId, "dev.spirit.desktop");
  assert.equal(config.win.executableName, "Spirit");
  assert.equal(config.linux.executableName, "spirit-desktop");
});

test("packaging refuses missing or mixed renderer product identities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "renderer-product-"));
  try {
    await mkdir(path.join(root, "dist"));
    const file = path.join(root, "dist/index.html");
    await writeFile(file, `<meta name="spirit-product-build" content="${PRODUCT_BUILD_ID}">`);
    await verifyRendererProduct(root);
    for (const html of [
      "<html></html>",
      '<meta name="spirit-product-build" content="different">',
    ]) {
      await writeFile(file, html);
      await assert.rejects(verifyRendererProduct(root), /product build is missing or different/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
