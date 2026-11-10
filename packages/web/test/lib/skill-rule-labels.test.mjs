import assert from "node:assert/strict";
import { test } from "vitest";

import i18n from "../../src/lib/i18n.ts";
import { skillRootKindLabel } from "../../src/components/settings/skill-rule-labels.ts";

test("skillRootKindLabel maps known root kinds", () => {
  assert.equal(skillRootKindLabel("user"), i18n.t("settings.skillUserDir"));
  assert.equal(skillRootKindLabel("workspaceSpirit"), i18n.t("settings.skillWorkspaceSpirit"));
  assert.equal(skillRootKindLabel("workspaceAgents"), i18n.t("settings.skillWorkspaceAgents"));
});
