import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertExtensionMcpSecretSlotsDeclared,
  findExtensionMcpSecretReferences,
  resolveExtensionMcpSecretTemplate,
} from "./mcp-secrets.js";

test("extension MCP secret templates resolve whole values and JSON fields", async () => {
  const secrets = new Map([
    ["credentials", JSON.stringify({ accessToken: "private-token", login: "fixture" })],
    ["region", "local"],
  ]);
  const loadSecret = async (slot: string) => secrets.get(slot);
  assert.equal(
    await resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret:credentials:accessToken}; region=${extension-secret:region}",
      loadSecret,
    ),
    "Bearer private-token; region=local",
  );
  assert.equal(
    await resolveExtensionMcpSecretTemplate("Bearer ${extension-secret:region}", loadSecret),
    "Bearer local",
  );
  assert.deepEqual(
    findExtensionMcpSecretReferences(
      "${extension-secret:credentials:accessToken}/${extension-secret:region}",
    ),
    [{ slot: "credentials", field: "accessToken" }, { slot: "region" }],
  );
});

test("extension MCP secret validation checks declared slots and malformed references", () => {
  assert.doesNotThrow(() =>
    assertExtensionMcpSecretSlotsDeclared("Bearer ${extension-secret:credentials:accessToken}", [
      "credentials",
    ]),
  );
  assert.throws(
    () =>
      assertExtensionMcpSecretSlotsDeclared("Bearer ${extension-secret:other}", ["credentials"]),
    /undeclared extension secret slot: other/,
  );
  for (const template of [
    "${extension-secret:credentials",
    "${extension-secret:}",
    "${extension-secret:credentials:}",
    "${extension-secret:credentials:first:second}",
  ]) {
    assert.throws(() => findExtensionMcpSecretReferences(template), /Invalid extension secret/);
  }
});

test("optional extension MCP secret templates omit when absent and resolve when configured", async () => {
  assert.deepEqual(
    findExtensionMcpSecretReferences(
      "Bearer ${extension-secret?:credentials:accessToken}; region=${extension-secret?:region}",
    ),
    [
      { slot: "credentials", field: "accessToken", optional: true },
      { slot: "region", optional: true },
    ],
  );
  assert.doesNotThrow(() =>
    assertExtensionMcpSecretSlotsDeclared("Bearer ${extension-secret?:credentials:accessToken}", [
      "credentials",
    ]),
  );
  assert.throws(
    () =>
      assertExtensionMcpSecretSlotsDeclared("Bearer ${extension-secret?:other}", ["credentials"]),
    /undeclared extension secret slot: other/,
  );
  assert.equal(
    await resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret?:credentials:accessToken}",
      async () => undefined,
    ),
    undefined,
  );
  assert.equal(
    await resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret?:credentials:accessToken}",
      async () => "",
    ),
    undefined,
  );
  assert.equal(
    await resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret?:credentials:accessToken}",
      async () => JSON.stringify({ refreshToken: "refresh-only" }),
    ),
    undefined,
  );
  assert.equal(
    await resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret?:credentials:accessToken}",
      async () => JSON.stringify({ accessToken: "private-token" }),
    ),
    "Bearer private-token",
  );
  await assert.rejects(
    resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret:credentials:accessToken}",
      async () => JSON.stringify({ refreshToken: "refresh-only" }),
    ),
    /must be a non-empty string/,
  );
  await assert.rejects(
    resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret?:credentials:accessToken}",
      async () => JSON.stringify({ accessToken: "" }),
    ),
    /must be a non-empty string/,
  );
  await assert.rejects(
    resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret?:credentials:accessToken}",
      async () => "not-json",
    ),
    /must contain a JSON object/,
  );
});

test("extension MCP secret failures never include the stored value", async () => {
  const privateValue = "private-value-that-must-not-leak";
  for (const [secrets, pattern] of [
    [new Map(), /not configured: credentials/],
    [new Map([["credentials", "not-json"]]), /must contain a JSON object/],
    [new Map([["credentials", JSON.stringify({ accessToken: 42 })]]), /must be a non-empty string/],
  ] as const) {
    await assert.rejects(
      resolveExtensionMcpSecretTemplate(
        "Bearer ${extension-secret:credentials:accessToken}",
        async (slot) => secrets.get(slot),
      ),
      (error: unknown) => {
        assert.match(String(error), pattern);
        assert.doesNotMatch(String(error), new RegExp(privateValue));
        return true;
      },
    );
  }
  await assert.rejects(
    resolveExtensionMcpSecretTemplate(
      "Bearer ${extension-secret:credentials:accessToken}",
      async () => privateValue,
    ),
    (error: unknown) => {
      assert.doesNotMatch(String(error), new RegExp(privateValue));
      return true;
    },
  );
});
