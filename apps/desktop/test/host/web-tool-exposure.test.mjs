import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION } from "@spiritagent/host-internal";

import {
  defaultAgentsConfig,
  loadConfig,
  normalizeAgentsConfig,
  setSpiritDataDirOverride,
} from "../../dist-electron/src/host/storage.js";
import { DesktopToolExecutor } from "../../dist-electron/src/host/tool-executor.js";

function functionToolNames(definitions) {
  return Array.isArray(definitions)
    ? definitions.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const tool = entry.function;
        return tool && typeof tool === "object" && typeof tool.name === "string" ? [tool.name] : [];
      })
    : [];
}

test("defaultAgentsConfig exposes web tools by default", () => {
  const agents = defaultAgentsConfig();
  assert.equal(agents.webSearch.enabled, true);
  assert.equal(agents.webFetch.enabled, true);
});

test("normalizeAgentsConfig treats missing or dirty web tool fields as enabled", () => {
  for (const raw of [
    {},
    { webSearch: {} },
    { webFetch: { enabled: "no" } },
    { webSearch: null, webFetch: 42 },
  ]) {
    const agents = normalizeAgentsConfig(raw);
    assert.equal(agents.webSearch.enabled, true, JSON.stringify(raw));
    assert.equal(agents.webFetch.enabled, true, JSON.stringify(raw));
  }
});

test("normalizeAgentsConfig honors explicit web tool opt-out", () => {
  const agents = normalizeAgentsConfig({
    webSearch: { enabled: false },
    webFetch: { enabled: false },
  });
  assert.equal(agents.webSearch.enabled, false);
  assert.equal(agents.webFetch.enabled, false);
});

test("loadConfig round-trips web tool toggles from config.json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-web-tool-exposure-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          agents: { webFetch: { enabled: false } },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const config = await loadConfig();
    assert.equal(config.agents.webSearch.enabled, true);
    assert.equal(config.agents.webFetch.enabled, false);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("DesktopToolExecutor hides web_fetch when webFetchEnabled is false", () => {
  const exposed = new DesktopToolExecutor(process.cwd(), {});
  assert.ok(functionToolNames(exposed.toolDefinitionsJson()).includes("web_fetch"));

  const hidden = new DesktopToolExecutor(process.cwd(), { webFetchEnabled: false });
  assert.ok(!functionToolNames(hidden.toolDefinitionsJson()).includes("web_fetch"));
});
