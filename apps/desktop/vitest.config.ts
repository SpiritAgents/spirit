import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the renderer alias in vite.config.ts / tsconfig.json paths.
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Component tests (.tsx) opt into jsdom individually via docblock pragma.
    include: ["test/**/*.test.mjs", "test/**/*.test.tsx"],
    // Never collect compiled Electron output or dependencies.
    exclude: ["dist-electron/**", "dist/**", "node_modules/**"],
    // Host tests spawn real git processes; node:test had no per-test timeout,
    // and 5s is too tight under full-turbo parallelism.
    testTimeout: 30000,
    // Temp git repos must not inherit the developer's global commit signing:
    // without an ssh-agent in env, signing prompts on stdin and hangs forever.
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "false",
    },
  },
});
