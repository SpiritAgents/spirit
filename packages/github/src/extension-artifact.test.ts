import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "vitest";
import { pathToFileURL } from "node:url";
import path from "node:path";

test("the built extension backend has no workspace or host runtime dependency", async () => {
  const root = path.resolve(import.meta.dirname, "../dist/extension");
  const main = await readFile(path.join(root, "index.mjs"), "utf8");
  assert.doesNotMatch(main, /from\s*["']@spiritagent\//);
  assert.doesNotMatch(main, /from\s*["']electron["']|keyring|oauth-bridge/);
  const module = await import(pathToFileURL(path.join(root, "index.mjs")).href);
  assert.equal(typeof module.activate, "function");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.author.name, "Spirit");
  for (const file of ["README.md", "LICENSE", "icon.svg", "icons/github.svg"])
    assert.ok((await stat(path.join(root, file))).size > 0);
});

test("the contribution glyph is transparent and separate from the padded marketplace logo", async () => {
  const root = path.resolve(import.meta.dirname, "../dist/extension");
  const glyph = await readFile(path.join(root, "icons/github.svg"), "utf8");
  assert.match(glyph, /viewBox="-1 -1 26 26"/);
  assert.match(glyph, /fill="currentColor"/);
  assert.doesNotMatch(glyph, /<rect|<style|transform=/);
  const logo = await readFile(path.join(root, "icon.svg"), "utf8");
  assert.match(logo, /<rect class="background"/);
  assert.match(logo, /translate\(15 15\)/);
  const glyphPath = glyph.match(/ d="([^"]+)"/)?.[1];
  assert.ok(glyphPath);
  assert.equal(glyphPath, logo.match(/ d="([^"]+)"/)?.[1]);
});

test("both Native pages ship their own browser assets", async () => {
  const root = path.resolve(import.meta.dirname, "../dist/extension/ui");
  for (const name of ["authorize.html", "pull-requests.html"]) {
    const html = await readFile(path.join(root, name), "utf8");
    assert.match(html, /\.\/assets\/.+\.js/);
    assert.match(html, /\.\/assets\/.+\.css/);
    assert.doesNotMatch(html, /importmap|srcdoc|node_modules/);
    const styles = [...html.matchAll(/href="(\.\/assets\/[^"]+\.css)"/g)];
    assert.ok(styles.length > 0);
    const css = (
      await Promise.all(styles.map((match) => readFile(path.join(root, match[1]!), "utf8")))
    ).join("\n");
    assert.match(css, /html:not\(\.spirit-clickable-pointer\)/);
    assert.match(css, /user-select:\s*none/);
    assert.match(css, /data-spirit-selectable/);
  }
});
