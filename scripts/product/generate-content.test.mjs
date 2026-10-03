import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { resolveProduct } from "../../packages/product/schema.ts";
import {
  generateProductContent,
  renderProductTemplate,
  renderProductText,
} from "./generate-content.mjs";

const manifest = JSON.parse(await readFile(new URL("../../product.json", import.meta.url), "utf8"));
const fixture = {
  ...manifest,
  name: 'Example "Name" & {Docs}',
  websiteOrigin: "http://127.0.0.1:9411",
  downloadOrigin: "http://127.0.0.1:9412",
};
const products = {
  current: resolveProduct(fixture, "dev"),
  stable: resolveProduct(fixture, "stable"),
  dev: resolveProduct(fixture, "dev"),
};

test("templates use independently selected qualities and origins", () => {
  assert.equal(
    renderProductText(
      "{{product.stable.userDataFolderName}} {{product.dev.userDataFolderName}} {{product.quality}}",
      products,
    ),
    `${products.stable.userDataFolderName} ${products.dev.userDataFolderName} dev`,
  );
  assert.equal(renderProductText("{{product.downloadOrigin}}", products), fixture.downloadOrigin);
  assert.equal(renderProductText("{{product.websiteOrigin|host}}", products), "127.0.0.1:9411");
});

test("JSON and YAML frontmatter preserve display-name characters structurally", () => {
  const json = renderProductTemplate(
    '{"owner":"{{product.name}}"}',
    products,
    "marketplace.json",
  );
  assert.equal(JSON.parse(json).owner, fixture.name);
  const mdx = renderProductTemplate(
    '---\ntitle: "{{product.name}} guide"\n---\n# {{product.name|mdx}}\n\n```text\n{{product.downloadOrigin}}\n```\n',
    products,
    "document.mdx",
  );
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(mdx);
  assert.equal(parse(frontmatter[1]).title, `${fixture.name} guide`);
  assert.ok(mdx.includes("&amp; &#123;Docs&#125;"));
  assert.ok(mdx.includes(`\`\`\`text\n${fixture.downloadOrigin}\n\`\`\``));
});

test("invalid template fields, filters, and scopes fail explicitly", async () => {
  assert.throws(
    () => renderProductText("{{product.missing}}", products),
    /Unknown product template field/,
  );
  assert.throws(
    () => renderProductText("{{product.name|missing}}", products),
    /Unknown product template filter/,
  );
  await assert.rejects(
    generateProductContent({ scope: "unknown" }),
    /Unknown product content scope/,
  );
  await assert.rejects(
    generateProductContent({ scope: "docs" }),
    /Unknown product content scope/,
  );
});

test("single-source resources render outside source directories without banners or formatting churn", async () => {
  const temporaryRoot = new URL("../../tmp/", import.meta.url);
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(new URL("product-content-", temporaryRoot));
  const document = '---\ntitle: "{{product.name}}"\n---\n# {{product.name|mdx}}\n';
  const metadata = '{"title": "Docs", "pages": ["index"]}\n';
  const sources = {
    "product.json": JSON.stringify(fixture),
    "README.md": "# Project\n\nDirectly maintained documentation.\n",
    "CONTRIBUTING.md": "# Contributing\n",
    "docs/README_en.md": "# Project\n",
    "packages/host-internal/README.md": "# Host\n",
    "apps/site/content/docs/en-US/index.mdx": document,
    "apps/site/content/docs/en-US/meta.json": metadata,
    "packages/host-internal/built-in/skills/example/SKILL.md": "# {{product.name}}\n",
    "packages/host-internal/built-in/marketplace.json": '{"owner":"{{product.name}}"}\n',
  };
  try {
    for (const [filename, text] of Object.entries(sources)) {
      await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
      await writeFile(path.join(root, filename), text);
    }
    for (const quality of ["stable", "dev"]) {
      const outputs = await generateProductContent({ root, quality });
      assert.ok(outputs.includes("apps/site/.generated/product/docs/en-US/index.mdx"));
      assert.ok(
        outputs.includes("packages/host-internal/dist/resources/built-in/skills/example/SKILL.md"),
      );
      assert.ok(
        outputs.every(
          (output) =>
            output.startsWith("apps/site/.generated/product/docs/") ||
            output.startsWith("packages/host-internal/dist/resources/built-in/"),
        ),
      );
      const rendered = await readFile(
        path.join(root, "apps/site/.generated/product/docs/en-US/index.mdx"),
        "utf8",
      );
      assert.match(rendered, /&amp; &#123;Docs&#125;/);
      assert.doesNotMatch(rendered, /Generated from|\{\{product\./);
      assert.equal(
        await readFile(path.join(root, "apps/site/.generated/product/docs/en-US/meta.json"), "utf8"),
        metadata,
      );
      for (const [filename, text] of Object.entries(sources)) {
        assert.equal(await readFile(path.join(root, filename), "utf8"), text);
      }
      await generateProductContent({ root, quality, check: true });
    }
    await unlink(path.join(root, "apps/site/content/docs/en-US/index.mdx"));
    await generateProductContent({ root, scope: "site" });
    await assert.rejects(
      readFile(path.join(root, "apps/site/.generated/product/docs/en-US/index.mdx")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
