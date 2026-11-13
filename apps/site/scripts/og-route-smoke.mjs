import assert from "node:assert/strict";

import sharp from "sharp";

const origin = process.argv[2] ?? "http://127.0.0.1:3000";
const metadataOrigin = process.env.OG_METADATA_ORIGIN ?? origin;

async function expectPng(path) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200, `${path} should render`);
  assert.match(response.headers.get("content-type") ?? "", /image\/png/);
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  console.log(`PNG ${path}`);
}

async function expectNotFound(path) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 404, `${path} should not render`);
  console.log(`404 ${path}`);
}

async function expectMetadata(path, imagePath) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const imageUrl = `${metadataOrigin}/og/${imagePath}`;
  assert.ok(html.includes(`property="og:image" content="${imageUrl}"`), `${path} misses og:image`);
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  console.log(`META ${path}`);
}

await expectPng("/og/en-US");
await expectPng("/og/en-US/download");
await expectPng("/og/en-US/docs");
await expectPng("/og/en-US/docs/providers");
await expectPng("/og/en-US/docs/customize/extensions");
await expectPng("/og/zh-CN/docs");
await expectPng("/og/zh-TW/docs");
await expectPng("/og/ja/docs");
await expectPng("/og/ko/docs");
await expectPng("/og/ru/docs");

await expectNotFound("/og/en-US/blog");
await expectNotFound("/og/en-US/blog/a-nonexistent-blog-entry");
await expectNotFound("/og/en-US/download/extra");
await expectNotFound("/og/en-US/docs/not-found");

await expectMetadata("/en-US", "en-US");
await expectMetadata("/en-US/download", "en-US/download");
await expectMetadata("/en-US/docs", "en-US/docs");
await expectMetadata("/en-US/docs/customize/extensions", "en-US/docs/customize/extensions");

console.log("OG route smoke passed");
