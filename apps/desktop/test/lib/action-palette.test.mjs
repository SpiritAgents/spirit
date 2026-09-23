import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ACTION_PALETTE_GROUP_ORDER,
  buildActionPaletteItems,
  groupActionPaletteRootItems,
} from "../../src/lib/action-palette.ts";
import { STATIC_SLASH_COMMANDS } from "../../src/lib/skill-slash.ts";

const EN_LABELS = {
  "sidebar.newChat": "New Chat",
  "slash.createSkill": "Create or refine a SKILL.md with natural language",
  "slash.exportSession": "Export llm_history and API trace",
  "slash.compact": "Compact the current session context",
  "slash.loop": "Run autonomously until finish_task",
  "slash.plan": "Plan without editing code",
  "slash.ask": "Read-only help",
  "slash.fork": "Fork the session at the latest assistant message into a new chat",
  "actionPalette.theme": "Theme",
  "actionPalette.language": "Language",
  "settings.themeSystem": "System",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.langSystem": "System",
  "settings.langZhCN": "简体中文",
  "settings.langEn": "English",
  "settings.langZhTW": "繁體中文",
  "settings.langJa": "日本語",
  "settings.langKo": "한국어",
  "settings.langDe": "Deutsch",
  "settings.langFr": "Français",
  "settings.langEs": "Español",
  "settings.langPtBR": "Português do Brasil",
  "settings.langRu": "Русский",
};

const ZH_LABELS = {
  "sidebar.newChat": "新对话",
  "actionPalette.theme": "主题",
  "actionPalette.language": "语言",
  "settings.themeSystem": "跟随系统",
  "settings.themeLight": "浅色",
  "settings.themeDark": "深色",
  "settings.langSystem": "跟随系统",
  "settings.langZhCN": "简体中文",
  "settings.langEn": "English",
  "settings.langZhTW": "繁體中文",
  "settings.langJa": "日本語",
  "settings.langKo": "한국어",
  "settings.langDe": "Deutsch",
  "settings.langFr": "Français",
  "settings.langEs": "Español",
  "settings.langPtBR": "Português do Brasil",
  "settings.langRu": "Русский",
};

function tEn(key) {
  return EN_LABELS[key] ?? key;
}

function tZh(key) {
  return ZH_LABELS[key] ?? key;
}

test("buildActionPaletteItems returns grouped root items including appearance menus", () => {
  const items = buildActionPaletteItems("", tEn);
  assert.equal(items[0]?.kind, "new-chat");
  assert.equal(items[0]?.group, "chat");
  assert.equal(items.length, 1 + STATIC_SLASH_COMMANDS.length + 2);
  assert.ok(items.some((item) => item.kind === "theme-menu"));
  assert.ok(items.some((item) => item.kind === "locale-menu"));
  assert.equal(
    items.some((item) => item.kind === "skill"),
    false,
  );
  assert.equal(
    items.some((item) => "alias" in item && item.alias === "/start-implementing"),
    false,
  );

  const modeItem = items.find((item) => item.kind === "plan");
  assert.equal(modeItem?.group, "mode");
  const sessionItem = items.find((item) => item.kind === "compact");
  assert.equal(sessionItem?.group, "chat");
});

test("groupActionPaletteRootItems preserves chat mode appearance order", () => {
  const items = buildActionPaletteItems("", tEn);
  const grouped = groupActionPaletteRootItems(items);
  assert.deepEqual(
    grouped.map((entry) => entry.group),
    [...ACTION_PALETTE_GROUP_ORDER],
  );
  assert.ok(grouped.find((entry) => entry.group === "appearance")?.items.length === 2);
});

test("buildActionPaletteItems filters compact by prefix", () => {
  const items = buildActionPaletteItems("comp", tEn);
  assert.ok(items.some((item) => item.kind === "compact"));
  assert.equal(
    items.some((item) => item.kind === "loop"),
    false,
  );
});

test("buildActionPaletteItems matches localized new chat label", () => {
  const items = buildActionPaletteItems("新对话", tZh);
  assert.ok(items.some((item) => item.kind === "new-chat"));
});

test("buildActionPaletteItems matches slash description text", () => {
  const items = buildActionPaletteItems("plan without", tEn);
  assert.ok(items.some((item) => item.kind === "plan"));
});

test("buildActionPaletteItems theme view only returns theme options", () => {
  const items = buildActionPaletteItems("", tEn, "theme");
  assert.ok(items.length >= 3);
  assert.ok(items.every((item) => item.kind === "theme-option"));
  assert.equal(
    items.some((item) => item.kind === "new-chat"),
    false,
  );
});

test("buildActionPaletteItems theme view filters by option label", () => {
  const items = buildActionPaletteItems("light", tEn, "theme");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "theme-option");
  assert.equal(items[0]?.value, "light");
});

test("buildActionPaletteItems locale view only returns locale options", () => {
  const items = buildActionPaletteItems("", tEn, "locale");
  assert.ok(items.every((item) => item.kind === "locale-option"));
  assert.equal(items[0]?.value, "system");
  assert.ok(items.some((item) => item.kind === "locale-option" && item.value === "en"));
});

test("buildActionPaletteItems locale view filters by language label", () => {
  const byEnglish = buildActionPaletteItems("english", tEn, "locale");
  assert.ok(byEnglish.some((item) => item.kind === "locale-option" && item.value === "en"));
  assert.equal(
    byEnglish.some((item) => item.kind === "locale-option" && item.value === "zh-CN"),
    false,
  );

  const bySystem = buildActionPaletteItems("system", tEn, "locale");
  assert.equal(bySystem.length, 1);
  assert.equal(bySystem[0]?.value, "system");

  const byEndonym = buildActionPaletteItems("日本語", tEn, "locale");
  assert.ok(byEndonym.some((item) => item.kind === "locale-option" && item.value === "ja"));
  assert.equal(
    byEndonym.some((item) => item.kind === "locale-option" && item.value === "en"),
    false,
  );

  const byAlias = buildActionPaletteItems("japanese", tEn, "locale");
  assert.ok(byAlias.some((item) => item.kind === "locale-option" && item.value === "ja"));

  const byChinese = buildActionPaletteItems("chinese", tEn, "locale");
  assert.ok(byChinese.some((item) => item.kind === "locale-option" && item.value === "zh-CN"));
  assert.ok(byChinese.some((item) => item.kind === "locale-option" && item.value === "zh-TW"));
  assert.equal(
    byChinese.some((item) => item.kind === "locale-option" && item.value === "en"),
    false,
  );
});

test("buildActionPaletteItems root search matches appearance menu labels", () => {
  const items = buildActionPaletteItems("theme", tEn);
  assert.ok(items.some((item) => item.kind === "theme-menu"));
  assert.equal(
    items.some((item) => item.kind === "theme-option"),
    false,
  );
});

test("buildActionPaletteItems matches English labels under Chinese UI", () => {
  assert.ok(buildActionPaletteItems("theme", tZh).some((item) => item.kind === "theme-menu"));
  assert.ok(buildActionPaletteItems("new chat", tZh).some((item) => item.kind === "new-chat"));
  assert.ok(buildActionPaletteItems("language", tZh).some((item) => item.kind === "locale-menu"));
});

test("buildActionPaletteItems theme view matches English under Chinese UI", () => {
  const items = buildActionPaletteItems("light", tZh, "theme");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "theme-option");
  assert.equal(items[0]?.value, "light");
});

test("buildActionPaletteItems locale view matches endonym alias and code under Chinese UI", () => {
  const byLabel = buildActionPaletteItems("english", tZh, "locale");
  assert.ok(byLabel.some((item) => item.kind === "locale-option" && item.value === "en"));
  const byEndonym = buildActionPaletteItems("한국어", tZh, "locale");
  assert.ok(byEndonym.some((item) => item.kind === "locale-option" && item.value === "ko"));
  const byAlias = buildActionPaletteItems("korean", tZh, "locale");
  assert.ok(byAlias.some((item) => item.kind === "locale-option" && item.value === "ko"));
  const byChinese = buildActionPaletteItems("chinese", tZh, "locale");
  assert.ok(byChinese.some((item) => item.kind === "locale-option" && item.value === "zh-CN"));
  assert.ok(byChinese.some((item) => item.kind === "locale-option" && item.value === "zh-TW"));
  const byCode = buildActionPaletteItems("en", tZh, "locale");
  assert.ok(byCode.some((item) => item.kind === "locale-option" && item.value === "en"));
});
