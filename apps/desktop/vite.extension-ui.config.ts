import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  define: {
    // iframe srcdoc has no Node `process`. Vite lib mode otherwise leaves
    // React's process.env.NODE_ENV checks intact and the kit throws on import.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
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
