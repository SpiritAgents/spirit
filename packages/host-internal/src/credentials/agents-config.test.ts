import assert from "node:assert/strict";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION } from "../config-v2.js";
import type { SpiritConfigFile } from "./types.js";
import { resolveAgentsWebToolExposure } from "./agents-config.js";

function configWithAgents(agents: unknown): SpiritConfigFile {
  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providerGroups: [],
    activeModel: { groupId: "g", name: "m" },
    agents,
  };
}

test("resolveAgentsWebToolExposure defaults to enabled without a config", () => {
  assert.deepEqual(resolveAgentsWebToolExposure(undefined), {
    webSearchEnabled: true,
    webFetchEnabled: true,
  });
});

test("resolveAgentsWebToolExposure defaults to enabled without agents keys", () => {
  assert.deepEqual(resolveAgentsWebToolExposure(configWithAgents(undefined)), {
    webSearchEnabled: true,
    webFetchEnabled: true,
  });
  assert.deepEqual(resolveAgentsWebToolExposure(configWithAgents({})), {
    webSearchEnabled: true,
    webFetchEnabled: true,
  });
  assert.deepEqual(resolveAgentsWebToolExposure(configWithAgents({ webSearch: {} })), {
    webSearchEnabled: true,
    webFetchEnabled: true,
  });
});

test("resolveAgentsWebToolExposure honors explicit false toggles", () => {
  assert.deepEqual(
    resolveAgentsWebToolExposure(
      configWithAgents({ webSearch: { enabled: false }, webFetch: { enabled: false } }),
    ),
    { webSearchEnabled: false, webFetchEnabled: false },
  );
  assert.deepEqual(
    resolveAgentsWebToolExposure(
      configWithAgents({ webSearch: { enabled: false }, webFetch: { enabled: true } }),
    ),
    { webSearchEnabled: false, webFetchEnabled: true },
  );
});

test("resolveAgentsWebToolExposure treats malformed sections as enabled", () => {
  assert.deepEqual(resolveAgentsWebToolExposure(configWithAgents("broken")), {
    webSearchEnabled: true,
    webFetchEnabled: true,
  });
  assert.deepEqual(
    resolveAgentsWebToolExposure(
      configWithAgents({ webSearch: "broken", webFetch: { enabled: 0 } }),
    ),
    { webSearchEnabled: true, webFetchEnabled: true },
  );
});
