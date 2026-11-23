import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "vitest";

import { buildMcpAppContextBlockContent } from "../tool-agent.js";
import { TOOL_CALL_TOOL_NAME } from "../tool-gateway/definitions.js";
import { isMcpAppUiResource, parseMcpToolUiMeta } from "./apps.js";
import { McpAppToolApprovalRequiredError } from "./errors.js";
import { McpService } from "./service.js";

const FIXTURE_SERVER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-fixtures",
  "apps-test-server.mjs",
);

function createFixtureService(enableMcpApps: boolean): {
  service: McpService;
  workspaceRoot: string;
} {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "spirit-mcp-apps-test-"));
  const service = new McpService(workspaceRoot, false, {
    enableMcpApps,
    extraConfigs: () => ({
      servers: {
        "demo-apps": {
          transport: {
            type: "stdio",
            command: process.execPath,
            args: [FIXTURE_SERVER],
          },
        },
      },
    }),
  });
  return { service, workspaceRoot };
}

describe("MCP Apps protocol, model-context filtering, and proxy enforcement", () => {
  const cleanupList: Array<{ service: McpService; workspaceRoot: string }> = [];

  afterEach(async () => {
    const items = cleanupList.splice(0);
    await Promise.all(items.map(({ service }) => service.dispose()));
    for (const { workspaceRoot } of items) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("parses both nested _meta.ui and legacy _meta['ui/resourceUri'] metadata", () => {
    const nested = parseMcpToolUiMeta({
      _meta: {
        ui: { resourceUri: "ui://demo/view", visibility: ["app"] },
      },
    });
    assert.deepEqual(nested, {
      resourceUri: "ui://demo/view",
      visibility: ["app"],
      appOnly: true,
      modelOnly: false,
    });

    const legacy = parseMcpToolUiMeta({
      _meta: {
        "ui/resourceUri": "ui://demo/legacy",
      },
    });
    assert.deepEqual(legacy, {
      resourceUri: "ui://demo/legacy",
      appOnly: false,
      modelOnly: false,
    });

    assert.equal(isMcpAppUiResource({ uri: "ui://demo/view", mimeType: "text/html" }), true);
    assert.equal(isMcpAppUiResource({ uri: "ui://demo/data", mimeType: "application/json" }), true);
    assert.equal(isMcpAppUiResource({ uri: "docs://guide", mimeType: "text/plain" }), false);

    const invalidScheme = parseMcpToolUiMeta({
      _meta: {
        ui: { resourceUri: "https://evil.example/app" },
      },
    });
    assert.equal(invalidScheme, undefined);
  });

  it("hides app-only tools and ui:// HTML resources from model catalog and model tool/resource calls", async () => {
    const entry = createFixtureService(true);
    cleanupList.push(entry);
    const { service } = entry;

    await service.ensureToolingCache();
    const catalog = service.catalogSnapshot();
    const toolNames = catalog.servers.flatMap((s) => s.tools.map((t) => t.name));
    const resourceUris = catalog.servers.flatMap((s) => s.resources.map((r) => r.uri));

    assert.ok(toolNames.includes("show_dashboard"));
    assert.ok(toolNames.includes("plain_tool"));
    assert.ok(toolNames.includes("model_only_helper"));
    assert.ok(!toolNames.includes("app_only_refresh"));
    assert.ok(!toolNames.includes("slow_app_op"));
    assert.ok(resourceUris.includes("data://demo/readme"));
    assert.ok(!resourceUris.includes("ui://demo/dashboard"));

    await assert.rejects(() => service.describeTool("demo-apps", "app_only_refresh"), /app-only/i);

    await assert.rejects(
      () =>
        service.executeFetchMcpResourceToolRequest({
          kind: "fetchMcpResource",
          server: "demo-apps",
          uri: "ui://demo/dashboard",
        }),
      /MCP App UI/i,
    );

    // Model can still read regular non-UI resources.
    const plainResource = await service.executeFetchMcpResourceToolRequest({
      kind: "fetchMcpResource",
      server: "demo-apps",
      uri: "data://demo/readme",
    });
    assert.ok(plainResource.includes("Hello from plain MCP resource"));
  });

  it("emits hostUi.mcpApp when MCP Apps are enabled and omits it when disabled", async () => {
    const enabled = createFixtureService(true);
    const disabled = createFixtureService(false);
    cleanupList.push(enabled, disabled);

    const enabledResult = await enabled.service.executeLazyToolGatewayToolRequestWithUi({
      kind: "lazyToolGateway",
      name: TOOL_CALL_TOOL_NAME,
      argumentsJson: JSON.stringify({
        provider: "mcp",
        server: "demo-apps",
        tool: "show_dashboard",
        arguments: { project: "spirit" },
      }),
    });
    assert.ok(enabledResult.summaryText.includes("Dashboard ready for spirit"));
    assert.equal(enabledResult.hostUi?.mcpApp?.server, "demo-apps");
    assert.equal(enabledResult.hostUi?.mcpApp?.toolName, "show_dashboard");
    assert.equal(enabledResult.hostUi?.mcpApp?.resourceUri, "ui://demo/dashboard");
    assert.deepEqual(JSON.parse(enabledResult.hostUi?.mcpApp?.argumentsJson ?? "{}"), {
      project: "spirit",
    });
    assert.equal(
      (enabledResult.hostUi?.mcpApp?.toolResult as { structuredContent?: { project?: string } })
        ?.structuredContent?.project,
      "spirit",
    );

    const disabledResult = await disabled.service.executeLazyToolGatewayToolRequestWithUi({
      kind: "lazyToolGateway",
      name: TOOL_CALL_TOOL_NAME,
      argumentsJson: JSON.stringify({
        provider: "mcp",
        server: "demo-apps",
        tool: "show_dashboard",
        arguments: { project: "spirit" },
      }),
    });
    assert.ok(disabledResult.summaryText.includes("Dashboard ready for spirit"));
    assert.equal(disabledResult.hostUi?.mcpApp, undefined);

    // Model cannot invoke app-only tools even via direct gateway call.
    await assert.rejects(
      () =>
        enabled.service.executeLazyToolGatewayToolRequestWithUi({
          kind: "lazyToolGateway",
          name: TOOL_CALL_TOOL_NAME,
          argumentsJson: JSON.stringify({
            provider: "mcp",
            server: "demo-apps",
            tool: "app_only_refresh",
            arguments: {},
          }),
        }),
      /app-only/i,
    );
  });

  it("proxies callAppTool and readAppResource with visibility checks and 4-concurrency limit", async () => {
    const entry = createFixtureService(true);
    cleanupList.push(entry);
    const { service } = entry;

    // App can invoke read-only app-only tools without approval.
    const appRefresh = (await service.callAppTool("demo-apps", "app_only_refresh", {
      filter: "open",
    })) as { structuredContent?: { filter?: string } };
    assert.equal(appRefresh.structuredContent?.filter, "open");

    // Non-read-only tools require explicit approval unless approvalLevel is bypass-approval.
    await assert.rejects(
      () => service.callAppTool("demo-apps", "app_only_mutate", { action: "archive" }),
      (error: unknown) =>
        error instanceof McpAppToolApprovalRequiredError &&
        error.server === "demo-apps" &&
        error.toolName === "app_only_mutate",
    );
    const approvedMutate = (await service.callAppTool(
      "demo-apps",
      "app_only_mutate",
      { action: "archive" },
      { approved: true },
    )) as { structuredContent?: { action?: string; mutated?: boolean } };
    assert.equal(approvedMutate.structuredContent?.action, "archive");
    assert.equal(approvedMutate.structuredContent?.mutated, true);

    const bypassedMutate = (await service.callAppTool(
      "demo-apps",
      "app_only_mutate",
      { action: "delete" },
      { approvalLevel: "bypass-approval" },
    )) as { structuredContent?: { action?: string; mutated?: boolean } };
    assert.equal(bypassedMutate.structuredContent?.action, "delete");
    assert.equal(bypassedMutate.structuredContent?.mutated, true);

    // App cannot invoke model-only tools.
    await assert.rejects(
      () => service.callAppTool("demo-apps", "model_only_helper", {}),
      /model-only/i,
    );

    // App can read ui:// HTML resource with parsed CSP & permissions metadata.
    const uiResource = await service.readAppResource("demo-apps", "ui://demo/dashboard");
    assert.equal(uiResource.uri, "ui://demo/dashboard");
    assert.equal(uiResource.mimeType, "text/html;profile=mcp-app");
    assert.ok(uiResource.html.includes("Demo Dashboard"));
    assert.deepEqual(uiResource.uiMeta?.csp?.connectDomains, ["https://api.example.com"]);
    assert.deepEqual(uiResource.uiMeta?.csp?.resourceDomains, ["https://cdn.example.com"]);
    assert.ok(uiResource.uiMeta?.permissions?.clipboardWrite);
    assert.equal(uiResource.uiMeta?.domain, "demo-dashboard.invalid");
    assert.equal(uiResource.uiMeta?.prefersBorder, true);

    // App resource reader rejects non-ui:// schemes.
    await assert.rejects(
      () => service.readAppResource("demo-apps", "data://demo/readme"),
      /ui:\/\//i,
    );

    // Concurrency cap: 6 simultaneous slow calls should never exceed 4 in-flight.
    const results = (await Promise.all(
      Array.from({ length: 6 }, () =>
        service.callAppTool("demo-apps", "slow_app_op", { delayMs: 60 }),
      ),
    )) as Array<{ structuredContent?: { maxConcurrent?: number } }>;
    const maxSeen = Math.max(...results.map((res) => res.structuredContent?.maxConcurrent ?? 0));
    assert.ok(maxSeen >= 1 && maxSeen <= 4, `expected max concurrent <= 4, got ${maxSeen}`);
  });

  it("caps XML-escaped MCP App context entries strictly within per-entry and total byte budgets", () => {
    const first = buildMcpAppContextBlockContent([
      {
        appId: "app-1",
        server: "demo",
        text: "&".repeat(16 * 1024),
      },
    ]);
    assert.ok(first);
    const match = first.match(/<app [^>]+>\n([\s\S]*?)\n<\/app>/);
    assert.ok(match);
    const escapedBody = match[1]!;
    assert.ok(
      Buffer.byteLength(escapedBody, "utf8") <= 16 * 1024,
      `expected escaped entry <= 16KB, got ${Buffer.byteLength(escapedBody, "utf8")}`,
    );
    assert.ok(escapedBody.endsWith("\n[truncated]"));
    assert.ok(!escapedBody.includes("&am\n"));

    const multi = buildMcpAppContextBlockContent([
      { appId: "app-1", server: "demo", text: "<".repeat(20 * 1024) },
      { appId: "app-2", server: "demo", text: ">".repeat(20 * 1024) },
      { appId: "app-3", server: "demo", text: "overflow-entry" },
    ]);
    assert.ok(multi);
    assert.ok(multi.includes('id="app-1"'));
    assert.ok(multi.includes('id="app-2"'));
    assert.ok(!multi.includes('id="app-3"'));
  });
});
