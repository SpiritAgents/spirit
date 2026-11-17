import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildExtensionDumpFromEntry,
  buildHostExtensionManifestFromDump,
  type MarketplaceCatalogItem,
  type MarketplaceExtensionEntry,
} from "@spiritagent/extensions";

import { buildDesktopMarketplaceCatalogEntries } from "./extensions.js";

function remoteEntry(): MarketplaceExtensionEntry {
  const messages = {
    metadata: {
      displayName: "Remote Demo",
      description: "Remote extension description.",
      keyword: "remote",
    },
    contributions: {
      server: { displayName: "Docs Server" },
      hook: { displayName: "Session Start" },
      skill: { displayName: "Demo Skill", summary: "Use the demo skill." },
      rule: { displayName: "Demo Rules", summary: "Follow the demo rules." },
      tool: { displayName: "Demo Tool", summary: "Run the demo tool." },
    },
  };
  const localized = structuredClone(messages);
  localized.metadata = {
    displayName: "远程示例",
    description: "远程扩展概述。",
    keyword: "远程",
  };
  localized.contributions = {
    server: { displayName: "文档服务器" },
    hook: { displayName: "会话开始" },
    skill: { displayName: "示例技能", summary: "使用示例技能。" },
    rule: { displayName: "示例规则", summary: "遵循示例规则。" },
    tool: { displayName: "示例工具", summary: "运行示例工具。" },
  };
  return {
    name: "remote-demo",
    version: "1.0.0",
    source: { source: "npm", package: "remote-demo@1.0.0" },
    defaultLocale: "en",
    messages: { en: messages, "zh-CN": localized },
    displayName: { message: "metadata.displayName" },
    description: { message: "metadata.description" },
    keywords: [{ message: "metadata.keyword" }],
    reviewStatus: "verified",
    manifest: {
      supportedHosts: ["desktop"],
      requestedCapabilities: ["mcp", "hooks", "skills", "rules", "tool-definitions"],
      contributes: {
        mcp: [
          {
            name: "docs",
            displayName: { message: "contributions.server.displayName" },
            transport: "http",
          },
        ],
        hooks: [
          {
            event: "sessionStart",
            displayName: { message: "contributions.hook.displayName" },
          },
        ],
        skills: [
          {
            name: "demo",
            displayName: { message: "contributions.skill.displayName" },
            summary: { message: "contributions.skill.summary" },
          },
        ],
        rules: {
          displayName: { message: "contributions.rule.displayName" },
          summary: { message: "contributions.rule.summary" },
        },
        tools: [
          {
            name: "demo",
            description: "English model-facing description.",
            presentation: {
              displayName: { message: "contributions.tool.displayName" },
              summary: { message: "contributions.tool.summary" },
            },
            inputSchema: { type: "object" },
          },
        ],
      },
    },
  };
}

function remoteItem(): MarketplaceCatalogItem {
  return {
    source: {
      id: "remote",
      name: "remote",
      displayName: "Remote",
      kind: "http-index",
      locator: "https://example.test/.spirit/marketplace.json",
      addedAtUnixMs: 0,
    },
    entry: remoteEntry(),
    installed: false,
    updateAvailable: false,
  };
}

test("uninstalled http-index entries project localized concrete contributions without package files", async () => {
  const [item] = await buildDesktopMarketplaceCatalogEntries([remoteItem()], [], {
    locale: "zh-CN",
  });
  assert.ok(item);
  assert.equal(item.displayName, "远程示例");
  assert.equal(item.description, "远程扩展概述。");
  assert.deepEqual(item.keywords, ["远程"]);
  assert.deepEqual(item.instructionContributions?.mcp, [
    { name: "docs", displayName: "文档服务器", transport: "http" },
  ]);
  assert.deepEqual(item.instructionContributions?.hooks, [
    { event: "sessionStart", displayName: "会话开始" },
  ]);
  assert.deepEqual(item.instructionContributions?.skills, [
    { name: "demo", displayName: "示例技能", summary: "使用示例技能。" },
  ]);
  assert.deepEqual(item.instructionContributions?.rules, {
    displayName: "示例规则",
    summary: "遵循示例规则。",
  });
  assert.deepEqual(item.contributedTools?.[0], {
    name: "demo",
    displayName: "示例工具",
    summary: "运行示例工具。",
  });
});

test("localized presentation never changes the model-facing tool description", async () => {
  const manifest = await buildHostExtensionManifestFromDump(
    buildExtensionDumpFromEntry(remoteEntry(), "remote"),
    undefined,
    { locale: "zh-CN" },
  );
  const tool = manifest.contributes?.tools?.[0];
  assert.equal(tool?.description, "English model-facing description.");
  assert.equal(tool?.presentation?.displayName, "示例工具");
  assert.equal(tool?.presentation?.summary, "运行示例工具。");
});
