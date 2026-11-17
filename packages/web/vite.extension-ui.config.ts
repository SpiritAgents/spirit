import path from "node:path";

import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  build: {
    emptyOutDir: false,
    codeSplitting: false,
    outDir: path.resolve(root, "dist/extension-ui"),
    lib: {
      entry: path.resolve(root, "../extensions/src/extension-ui-kit/page-runtime.ts"),
      formats: ["es"],
      fileName: () => "page-runtime.js",
    },
  },
});
