import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveSetupTransportKind, resolveWizardApiBase } from "../src/setup/provider-wizard.js";

test("resolveSetupTransportKind reads the preset's default transport", () => {
  assert.equal(resolveSetupTransportKind("minimax"), "anthropic");
  assert.equal(resolveSetupTransportKind("openai"), "open-responses");
  assert.equal(resolveSetupTransportKind("custom"), "openai-compatible");
});

test("resolveWizardApiBase materializes the minimax cn site anthropic endpoint", () => {
  assert.equal(
    resolveWizardApiBase({
      provider: "minimax",
      modelName: "placeholder",
      siteId: "cn",
    }),
    "https://api.minimax.cn/anthropic/v1",
  );
});
