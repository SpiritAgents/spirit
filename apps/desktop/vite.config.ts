import fs from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { product, PRODUCT_BUILD_ID } from "@spiritagent/product";

export function renderProductHtml(html: string): string {
  const name = product.name
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return html
    .replaceAll("{{product.name}}", () => name)
    .replaceAll("{{productBuildId}}", () => PRODUCT_BUILD_ID);
}

/**
 * Dev-only: resolve renderer-consumed workspace packages to their TypeScript
 * sources so edits under packages/<pkg>/src hot-reload without a manual dist
 * build. The alias table is derived from each package's exports map
 * (dist/X.js -> src/X), which also covers subpaths whose file layout differs
 * from the subpath name. Production builds keep resolving to dist.
 */
function workspaceSourceAliases() {
  const aliases: { find: RegExp; replacement: string }[] = [];
  for (const pkgName of ["ui", "icons", "agent-core", "host-internal"]) {
    const pkgRoot = path.resolve(__dirname, "../../packages", pkgName);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
    for (const [subpath, target] of Object.entries(pkgJson.exports ?? {})) {
      const file = typeof target === "string" ? target : (target as { default?: string }).default;
      if (typeof file !== "string") {
        continue;
      }
      let srcFile: string | undefined;
      if (file.startsWith("./dist/")) {
        // Drop the .js extension and let Vite resolve .ts/.tsx.
        srcFile = file.slice("./dist/".length).replace(/\.js$/, "");
      } else if (file.startsWith("./src/")) {
        srcFile = file.slice("./src/".length);
      }
      if (!srcFile) {
        continue;
      }
      const find =
        subpath === "."
          ? new RegExp(`^@spiritagent/${pkgName}$`)
          : new RegExp(
              `^@spiritagent/${pkgName}/${subpath.slice(2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            );
      aliases.push({ find, replacement: path.join(pkgRoot, "src", srcFile) });
    }
  }
  return aliases;
}

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    { name: "product-html", transformIndexHtml: renderProductHtml },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      ...(command === "serve" ? workspaceSourceAliases() : []),
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    hmr: process.env.VITE_HMR !== "0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7788",
        changeOrigin: true,
      },
    },
  },
}));
