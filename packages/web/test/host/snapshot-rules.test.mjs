import assert from "node:assert/strict";
import { test } from "vitest";

import { buildDesktopSnapshot } from "../../../../packages/workbench/dist/host/snapshot.js";

test("buildDesktopSnapshot maps rulesList from metadata entries", () => {
  const snapshot = buildDesktopSnapshot({
    sessionListRevision: 7,
    workspaceRoot: "C:/workspace/demo",
    config: {
      models: [],
      providers: [],
      activeModel: { providerId: "", name: "" },
      recentWorkspaces: [],
      dreams: {},
      webHost: { enabled: false, devices: [] },
    },
    git: { available: false },
    metadata: {
      rules: {
        discovered: 1,
        enabled: 1,
        enabledRules: [],
        entries: [
          {
            source: {
              id: "rule-spirit",
              scope: "workspace",
              rootKind: "workspaceSpirit",
              title: "Workspace Spirit rules",
              shortLabel: ".spirit/rule.md",
              path: "C:/workspace/demo/.spirit/rule.md",
            },
            exists: true,
            enabled: true,
            preview: { excerpt: "# Rules\nhello", truncated: false },
          },
          {
            source: {
              id: "rule-agents",
              scope: "workspace",
              rootKind: "workspaceAgents",
              title: "Workspace AGENTS rules",
              shortLabel: "AGENTS.md",
              path: "C:/workspace/demo/AGENTS.md",
            },
            exists: false,
            enabled: false,
          },
        ],
      },
      skills: {
        discovered: 0,
        enabled: 0,
        enabledSkillCatalog: [],
        entries: [],
      },
      planMetadata: {
        path: "",
        exists: false,
        agentMode: "agent",
        planMode: false,
      },
    },
    plan: { path: "", exists: false },
    extensionsList: [],
    extensionCss: [],
    dreamCollectorStatus: { state: "disabled" },
    runtimeReady: true,
    modelKeyPresence: {},
    activeApiKeyConfigured: false,
    mcpStatus: { servers: [] },
    mcpServers: [],
    hooksList: [],
    lsp: { userEnabled: true, active: false, providers: [] },
    conversation: {
      messages: [],
      isBusy: false,
      isBlocked: false,
    },
    composerSessionKey: "test",
    automationsList: [],
  });

  assert.equal(snapshot.rulesList.length, 2);
  assert.equal(snapshot.rulesList[0]?.rootKind, "workspaceSpirit");
  assert.equal(snapshot.rulesList[0]?.previewExcerpt, "# Rules\nhello");
  assert.equal(snapshot.rulesList[1]?.exists, false);
  assert.equal(snapshot.sessionListRevision, 7);
});
