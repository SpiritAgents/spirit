import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests spawn real git processes; 5s is too tight under full-turbo parallelism.
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
