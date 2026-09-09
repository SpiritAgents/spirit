import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
  build: {
    emptyOutDir: false,
    codeSplitting: false,
    outDir: path.resolve(root, "dist/extension-ui"),
    lib: {
      entry: path.resolve(root, "src/extension-ui-kit/runtime.ts"),
      formats: ["es"],
      fileName: () => "runtime.js",
    },
  },
});
