import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "../dist/extension");

test("the built extension backend has no workspace or host runtime dependency", async () => {
  const main = await readFile(path.join(root, "index.mjs"), "utf8");
  assert.doesNotMatch(main, /from\s*["']@spiritagent\//);
  assert.doesNotMatch(main, /from\s*["']electron["']|keyring/);
  const module = await import(pathToFileURL(path.join(root, "index.mjs")).href);
  assert.equal(typeof module.activate, "function");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.author.name, "Spirit");
  for (const file of ["README.md", "LICENSE", "icon.svg", "mcp.json"])
    assert.ok((await stat(path.join(root, file))).size > 0);
});

test("the built extension contributes only the official eager MCP with a declared secret reference", async () => {
  const config = JSON.parse(await readFile(path.join(root, "mcp.json"), "utf8"));
  assert.deepEqual(config, {
    servers: {
      cloudflare: {
        displayName: "Cloudflare",
        lazyTools: false,
        transport: {
          type: "http",
          url: "https://mcp.cloudflare.com/mcp",
          headers: {
            Authorization: "Bearer ${extension-secret:oauthCredentials:accessToken}",
          },
        },
      },
    },
  });
  const dump = JSON.parse(await readFile(path.join(root, ".spirit/extension.json"), "utf8"));
  assert.deepEqual(dump.manifest.requestedCapabilities, ["secret-storage", "mcp", "desktop-ui"]);
  assert.deepEqual(dump.manifest.secretSlots, ["oauthCredentials"]);
  assert.deepEqual(Object.keys(dump.manifest.contributes).sort(), [
    "authorizations",
    "desktop",
    "mcp",
  ]);
  assert.deepEqual(Object.keys(dump.manifest.contributes.desktop), ["views"]);
  assert.deepEqual(Object.keys(dump.messages).sort(), [
    "de",
    "en",
    "es",
    "fr",
    "ja",
    "ko",
    "pt-BR",
    "ru",
    "zh-CN",
    "zh-TW",
  ]);
});

test("the marketplace icon renders a theme-aware plain text tile without custom brand glyphs", async () => {
  const icon = await readFile(path.join(root, "icon.svg"), "utf8");
  assert.match(icon, /<rect class="background" width="100" height="100"\/>/);
  assert.match(icon, /prefers-color-scheme:dark/);
  assert.match(icon, /<text[^>]*>Cloudflare<\/text>/);
  assert.doesNotMatch(icon, /<path/i);
});

test("the authorization page ships its own browser assets", async () => {
  const html = await readFile(path.join(root, "ui/authorize.html"), "utf8");
  assert.match(html, /\.\/assets\/.+\.js/);
  assert.match(html, /\.\/assets\/.+\.css/);
  assert.doesNotMatch(html, /importmap|srcdoc|node_modules/);
  const styles = [...html.matchAll(/href="(\.\/assets\/[^"]+\.css)"/g)];
  assert.ok(styles.length > 0);
  const css = (
    await Promise.all(styles.map((match) => readFile(path.join(root, "ui", match[1]!), "utf8")))
  ).join("\n");
  assert.match(css, /user-select:\s*none/);
});
