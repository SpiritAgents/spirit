import { isBuiltin } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const root = import.meta.dirname;
export default defineConfig({
  root: path.join(root, "src/ui"),
  base: "./",
  plugins: [
    {
      name: "linear-browser-boundary",
      enforce: "pre",
      resolveId(source, importer) {
        if (isBuiltin(source) || source === "electron")
          this.error(`Backend module ${source} reached the Linear UI through ${importer}`);
      },
    },
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: path.join(root, "dist/extension/ui"),
    emptyOutDir: true,
    target: "es2022",
    rolldownOptions: {
      input: { authorize: path.join(root, "src/ui/authorize.html") },
    },
  },
});
