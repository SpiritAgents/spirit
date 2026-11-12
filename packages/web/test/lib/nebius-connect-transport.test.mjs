import assert from "node:assert/strict";
import { test } from "vitest";

import {
  connectTransportOptionsForProvider,
  defaultConnectTransportKind,
  providerShowsConnectTransportPicker,
} from "@/components/settings/models/connect-transport";

test("Nebius connect wizard offers Chat by default and Responses as an alternate", () => {
  assert.equal(defaultConnectTransportKind("nebius-token-factory"), "openai-compatible");
  assert.equal(providerShowsConnectTransportPicker("nebius-token-factory"), true);
  assert.deepEqual(
    connectTransportOptionsForProvider("nebius-token-factory").map((option) => option.value),
    ["openai-compatible", "open-responses"],
  );
});
