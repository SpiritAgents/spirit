import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import i18n from "../../src/lib/i18n.ts";
import { formatMcpCapabilityCounts } from "../../src/lib/mcp-capability-counts.ts";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

test("MCP capability counts use complete English copy and singular nouns", async () => {
  await i18n.changeLanguage("en");
  assert.equal(
    formatMcpCapabilityCounts({ tools: 1, resources: 2, prompts: 3 }),
    "1 tool, 2 resources, and 3 prompts available",
  );
});

test("MCP capability counts use natural Chinese measures and list separators", async () => {
  await i18n.changeLanguage("zh-CN");
  assert.equal(
    formatMcpCapabilityCounts({ tools: 1, resources: 2, prompts: 3 }),
    "可用 1 个工具、2 个资源和 3 个提示",
  );
});

test("MCP capability counts use Japanese list separators", async () => {
  await i18n.changeLanguage("ja");
  assert.equal(
    formatMcpCapabilityCounts({ tools: 1, resources: 2, prompts: 3 }),
    "使用可能: 1 個のツール、2 個のリソース、3 個のプロンプト",
  );
});

test("MCP capability counts follow Russian plural categories", async () => {
  await i18n.changeLanguage("ru");
  assert.equal(
    formatMcpCapabilityCounts({ tools: 2, resources: 5, prompts: 1 }),
    "Доступно: 2 инструмента, 5 ресурсов и 1 промпт",
  );
});
