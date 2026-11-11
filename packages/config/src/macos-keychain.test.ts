import assert from "node:assert/strict";
import { test } from "vitest";

import { selectSpiritKeychainAccessGroup } from "./macos-keychain.js";

test("selects only the Spirit sharing group from signed entitlements", () => {
  assert.equal(
    selectSpiritKeychainAccessGroup([
      "TEAM.example.unrelated",
      "TEAM.dev.spirit.shared",
      "TEAM.dev.spirit.shared.other",
    ]),
    "TEAM.dev.spirit.shared",
  );
  assert.equal(selectSpiritKeychainAccessGroup(["TEAM.dev.spirit.shared.other"]), undefined);
  assert.equal(selectSpiritKeychainAccessGroup([]), undefined);
});
