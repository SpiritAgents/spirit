import assert from "node:assert/strict";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION, type SpiritConfigFile } from "../config.js";

import {
  resolveAgentsProviderToolsExposure,
  resolveAgentsWebFetchExposure,
} from "./agents-config.js";

function configWithAgents(agents: unknown): SpiritConfigFile {
  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [],
    activeModel: { providerId: "g", name: "m" },
    agents,
  };
}

test("resolveAgentsProviderToolsExposure defaults to enabled", () => {
  assert.deepEqual(resolveAgentsProviderToolsExposure(undefined), { providerToolsEnabled: true });
  assert.deepEqual(resolveAgentsProviderToolsExposure(configWithAgents(undefined)), {
    providerToolsEnabled: true,
  });
  assert.deepEqual(resolveAgentsProviderToolsExposure(configWithAgents({})), {
    providerToolsEnabled: true,
  });
  assert.deepEqual(resolveAgentsProviderToolsExposure(configWithAgents({ providerTools: {} })), {
    providerToolsEnabled: true,
  });
  assert.deepEqual(resolveAgentsProviderToolsExposure(configWithAgents("broken")), {
    providerToolsEnabled: true,
  });
  assert.deepEqual(
    resolveAgentsProviderToolsExposure(configWithAgents({ providerTools: { enabled: 0 } })),
    { providerToolsEnabled: true },
  );
  // The legacy agents.webSearch key no longer gates anything.
  assert.deepEqual(
    resolveAgentsProviderToolsExposure(configWithAgents({ webSearch: { enabled: false } })),
    { providerToolsEnabled: true },
  );
});

test("resolveAgentsProviderToolsExposure honors explicit false", () => {
  assert.deepEqual(
    resolveAgentsProviderToolsExposure(configWithAgents({ providerTools: { enabled: false } })),
    { providerToolsEnabled: false },
  );
  assert.deepEqual(
    resolveAgentsProviderToolsExposure(configWithAgents({ providerTools: { enabled: true } })),
    { providerToolsEnabled: true },
  );
});

test("resolveAgentsWebFetchExposure defaults to enabled", () => {
  assert.deepEqual(resolveAgentsWebFetchExposure(undefined), { webFetchEnabled: true });
  assert.deepEqual(resolveAgentsWebFetchExposure(configWithAgents(undefined)), {
    webFetchEnabled: true,
  });
  assert.deepEqual(resolveAgentsWebFetchExposure(configWithAgents({})), { webFetchEnabled: true });
  assert.deepEqual(resolveAgentsWebFetchExposure(configWithAgents({ webFetch: {} })), {
    webFetchEnabled: true,
  });
  assert.deepEqual(resolveAgentsWebFetchExposure(configWithAgents("broken")), {
    webFetchEnabled: true,
  });
});

test("resolveAgentsWebFetchExposure honors explicit false toggles", () => {
  assert.deepEqual(
    resolveAgentsWebFetchExposure(configWithAgents({ webFetch: { enabled: false } })),
    { webFetchEnabled: false },
  );
  assert.deepEqual(
    resolveAgentsWebFetchExposure(
      configWithAgents({ webFetch: { enabled: false }, providerTools: { enabled: false } }),
    ),
    { webFetchEnabled: false },
  );
  // webFetch does not read the renamed providerTools key.
  assert.deepEqual(
    resolveAgentsWebFetchExposure(configWithAgents({ providerTools: { enabled: false } })),
    { webFetchEnabled: true },
  );
});
