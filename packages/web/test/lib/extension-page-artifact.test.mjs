import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "vitest";

test("native React/Radix/Spirit UI pages build as independent local assets", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "spirit-page-artifact-"));
  try {
    await build({
      configFile: false,
      root: path.resolve(import.meta.dirname, "../fixtures/extension-page"),
      base: "./",
      plugins: [react(), tailwindcss()],
      logLevel: "error",
      build: { outDir, emptyOutDir: true, minify: false },
    });
    const html = await readFile(path.join(outDir, "index.html"), "utf8");
    assert.match(html, /\.\/assets\/.+\.js/);
    assert.match(html, /\.\/assets\/.+\.css/);
    assert.doesNotMatch(html, /importmap|srcdoc|node_modules|@spirit\/desktop-ui/);
    const assets = await readdir(path.join(outDir, "assets"));
    const css = (
      await Promise.all(
        assets
          .filter((file) => file.endsWith(".css"))
          .map((file) => readFile(path.join(outDir, "assets", file), "utf8")),
      )
    ).join("\n");
    assert.match(css, /html:not\(\.spirit-clickable-pointer\)/);
    assert.match(css, /user-select:\s*none/);
    assert.match(css, /data-spirit-selectable/);
    const js = await readFile(
      path.join(
        outDir,
        "assets",
        assets.find((file) => file.endsWith(".js")),
      ),
      "utf8",
    );
    assert.match(js, /data-native-page/);
    assert.match(js, /data-counter/);
    assert.doesNotMatch(js, /from\s*["'](?:react|react-dom|radix-ui|@spiritagent\/)/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, 60_000);
