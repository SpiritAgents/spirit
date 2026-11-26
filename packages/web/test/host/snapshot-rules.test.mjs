import assert from "node:assert/strict";
import { test } from "vitest";

import { buildDesktopSnapshot } from "../../../../packages/workbench/dist/host/snapshot.js";

test("buildDesktopSnapshot maps existing rules with only their display fields", () => {
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
        discovered: 2,
        enabled: 2,
        enabledRules: [],
        entries: [
          {
            source: {
              id: "rule-spirit",
              scope: "workspace",
              rootKind: "workspaceSpirit",
              title: "Workspace Spirit rules",
              shortLabel: ".spirit/AGENTS.md",
              path: "C:/workspace/demo/.spirit/AGENTS.md",
            },
            exists: true,
            enabled: true,
            preview: { excerpt: "# Rules\nhello" },
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
          {
            source: {
              id: "rule-user",
              scope: "user",
              rootKind: "user",
              title: "User rules",
              shortLabel: "AGENTS.md",
              path: "C:/users/demo/.spirit/AGENTS.md",
            },
            exists: true,
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
  assert.deepEqual(snapshot.rulesList[0], {
    id: "rule-spirit",
    shortLabel: ".spirit/AGENTS.md",
    rootKind: "workspaceSpirit",
    enabled: true,
    previewExcerpt: "# Rules\nhello",
  });
  assert.deepEqual(snapshot.rulesList[1], {
    id: "rule-user",
    shortLabel: "AGENTS.md",
    rootKind: "user",
    enabled: false,
  });
  assert.equal(snapshot.sessionListRevision, 7);
});
