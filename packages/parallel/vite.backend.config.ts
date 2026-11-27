import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "node24",
    outDir: "dist/extension",
    emptyOutDir: true,
    minify: false,
    lib: { entry: "src/extension.ts", formats: ["es"], fileName: () => "index.mjs" },
    rolldownOptions: { external: [/^node:/] },
  },
});
