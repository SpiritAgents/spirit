import assert from "node:assert/strict";
import { test } from "vitest";

import { settingsPageTitleKey } from "../../src/components/settings/constants.ts";

const EXPECTED_TABS = [
  "general",
  "appearance",
  "networks",
  "models",
  "agents",
  "tab",
  "mcps",
  "hooks",
  "skills",
  "rules",
  "dreams",
  "integrations",
  "developer",
];

test("settingsPageTitleKey covers every SettingsSidebarTab", () => {
  for (const tab of EXPECTED_TABS) {
    assert.ok(
      typeof settingsPageTitleKey[tab] === "string" && settingsPageTitleKey[tab].length > 0,
      `missing title key for tab: ${tab}`,
    );
  }
  assert.equal(Object.keys(settingsPageTitleKey).length, EXPECTED_TABS.length);
});
