import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveProfileApiBase, resolveSetupTransportKind } from "../src/setup/provider-wizard.js";

test("resolveSetupTransportKind defaults minimax to anthropic", () => {
  assert.equal(resolveSetupTransportKind("minimax"), "anthropic");
  assert.equal(resolveSetupTransportKind("minimax", "openai-compatible"), "openai-compatible");
});

test("resolveProfileApiBase uses anthropic endpoint for minimax without explicit transportKind", () => {
  assert.equal(
    resolveProfileApiBase({
      provider: "minimax",
      providerSite: "cn",
    }),
    "https://api.minimax.cn/anthropic/v1",
  );
});
