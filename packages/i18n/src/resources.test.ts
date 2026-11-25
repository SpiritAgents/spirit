import assert from "node:assert/strict";
import { test } from "vitest";

import { resources } from "./resources.js";

test("all locales expose the same translation keys", () => {
  const expected = Object.keys(resources.en.translation).sort();
  for (const locale of Object.values(resources)) {
    assert.deepEqual(Object.keys(locale.translation).sort(), expected);
  }
});

test("trigger authorization hints localize their navigation link with the contribution name", () => {
  for (const [locale, { translation }] of Object.entries(resources)) {
    const message = translation.automations.trigger.authorizationRequired;
    assert.equal(message.match(/<authorize>/g)?.length, 1, locale);
    assert.equal(message.match(/<\/authorize>/g)?.length, 1, locale);
    assert.match(message, /<authorize>[^<]*{{name}}[^<]*<\/authorize>/, locale);
  }
});

test("Automation trigger contribution groups use the same Automation semantics as the product", () => {
  const expected = {
    en: "Automation Triggers",
    "zh-CN": "自动化触发器",
    "zh-TW": "自動化觸發器",
    ja: "オートメーショントリガー",
    ko: "자동화 트리거",
    de: "Automatisierungs-Trigger",
    fr: "Déclencheurs d’automatisation",
    es: "Disparadores de automatización",
    "pt-BR": "Gatilhos de automação",
    ru: "Триггеры автоматизации",
  } as const;
  for (const [locale, label] of Object.entries(expected)) {
    assert.equal(
      resources[locale as keyof typeof resources].translation.marketplace
        .contributionGroupAutomationTriggers,
      label,
      locale,
    );
  }
});

test("all locales define compaction shimmer labels", () => {
  for (const [locale, { translation }] of Object.entries(resources)) {
    assert.ok(translation.app.reasoningCompactingActive.trim().length > 0, locale);
    assert.ok(translation.app.reasoningCompactingIdle.trim().length > 0, locale);
  }
  assert.equal(resources["zh-CN"].translation.app.reasoningCompactingActive, "压缩");
  assert.equal(resources["zh-CN"].translation.app.reasoningCompactingIdle, "压缩");
  assert.equal(resources["zh-TW"].translation.app.reasoningCompactingActive, "壓縮");
  assert.equal(resources["zh-TW"].translation.app.reasoningCompactingIdle, "壓縮");
  assert.equal(resources["zh-TW"].translation.app.modelPickerThinking, "思考");
});
