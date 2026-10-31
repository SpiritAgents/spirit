import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { providerInternalKeyAccount, setKeyringStoreForTests } from "@spiritagent/host-internal";

import { createServerRuntime } from "../src/runtime-factory.js";

const fixtures = [
  {
    providerId: "moonshot-ai",
    sdk: "@ai-sdk/moonshotai",
    apiBase: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
  },
  {
    providerId: "kimi-code",
    sdk: "@ai-sdk/openai-compatible",
    apiBase: "https://api.kimi.com/coding/v1",
    model: "k3",
  },
] as const;

for (const fixture of fixtures) {
  test(`server export uses the config provider id for ${fixture.providerId}`, async () => {
    const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-server-host-prompt-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-server-host-prompt-ws-"));
    writeFileSync(
      join(spiritDataDir, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        providers: [
          {
            id: fixture.providerId,
            apiBase: fixture.apiBase,
            sdk: fixture.sdk,
            models: [{ name: fixture.model }],
          },
        ],
        activeModel: { providerId: fixture.providerId, name: fixture.model },
      }),
    );
    setKeyringStoreForTests({
      getPassword: (_service, account) =>
        account === providerInternalKeyAccount(fixture.providerId) ? "test-key" : undefined,
      setPassword: () => {},
      deletePassword: () => {},
    });

    try {
      const result = await createServerRuntime({
        workspaceRoot,
        spiritDataDir,
        sessionKey: "sess_host_prompt_provider_id",
        hostKind: "desktop",
        approvalLevel: "default",
        onEvent: () => {},
      });
      const exported = (await result.exportState()) as {
        systemPrompts: Record<string, unknown>;
      };
      const prompt = exported.systemPrompts.tool_agent;
      assert.ok(typeof prompt === "string");
      assert.match(
        prompt,
        new RegExp(`The user's model is ${fixture.model} from ${fixture.providerId}\\.`),
      );
      assert.doesNotMatch(prompt, /@ai-sdk\//);
    } finally {
      setKeyringStoreForTests(undefined);
    }
  });
}
