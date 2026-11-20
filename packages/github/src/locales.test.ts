import assert from "node:assert/strict";
import { test } from "vitest";

import { flattenMessageCatalog } from "@spiritagent/extension-toolkit";
import { VALID_LANGUAGES } from "@spiritagent/i18n";

import { resources } from "./locales.js";

test("GitHub owns complete catalogs for every Spirit locale", () => {
  assert.deepEqual(Object.keys(resources).sort(), [...VALID_LANGUAGES].sort());
  const expectedKeys = Object.keys(flattenMessageCatalog(resources.en.translation)).sort();
  for (const [locale, { translation }] of Object.entries(resources)) {
    assert.deepEqual(Object.keys(flattenMessageCatalog(translation)).sort(), expectedKeys, locale);
  }
});

test("GitHub locale messages preserve interpolation and rich-text placeholders", () => {
  const expected = placeholders(resources.en.translation);
  for (const [locale, { translation }] of Object.entries(resources)) {
    assert.deepEqual(placeholders(translation), expected, locale);
  }
});

test("PR authorization hints localize the complete sentence and preserve its navigation link", () => {
  for (const [locale, { translation }] of Object.entries(resources)) {
    const message = translation.workspace.prGitHubAuthorizationRequired;
    assert.equal(message.match(/<authorize>/g)?.length, 1, locale);
    assert.equal(message.match(/<\/authorize>/g)?.length, 1, locale);
    assert.match(message, /<authorize>[^<]*GitHub[^<]*<\/authorize>/, locale);
  }
});

test("Pull Request keywords use canonical localized terminology", () => {
  const expected = {
    en: "pull requests",
    "zh-CN": "拉取请求",
    "zh-TW": "拉取請求",
    ja: "プルリクエスト",
    ko: "끌어오기 요청",
    de: "Pull Requests",
    fr: "demandes de tirage",
    es: "solicitudes de incorporación",
    "pt-BR": "pull requests",
    ru: "запросы на слияние",
  } as const;
  for (const [locale, label] of Object.entries(expected)) {
    assert.equal(
      resources[locale as keyof typeof resources].translation.metadata.keywords.pullRequests,
      label,
      locale,
    );
  }
});

test("translated GitHub catalogs omit English and legacy Pull Request terms", () => {
  const legacyTerms: Record<string, RegExp[]> = {
    es: [/solicitudes? de extracción/iu],
    ko: [/풀 리퀘스트/u],
  };
  for (const [locale, { translation }] of Object.entries(resources)) {
    if (locale === "en" || locale === "de" || locale === "pt-BR") {
      continue;
    }
    for (const [key, message] of Object.entries(flattenMessageCatalog(translation))) {
      assert.doesNotMatch(message, /pull[ -]?requests?/iu, `${locale}:${key}: ${message}`);
      for (const legacy of legacyTerms[locale] ?? []) {
        assert.doesNotMatch(message, legacy, `${locale}:${key}: ${message}`);
      }
    }
  }
});

test("Pull Request open statuses use canonical localized terminology", () => {
  const expected = {
    en: "Open",
    "zh-CN": "开放",
    "zh-TW": "開放",
    ja: "オープン",
    ko: "열림",
    de: "Offen",
    fr: "Ouverte",
    es: "Abierta",
    "pt-BR": "Aberta",
    ru: "Открыт",
  } as const;
  for (const [locale, label] of Object.entries(expected)) {
    assert.equal(
      resources[locale as keyof typeof resources].translation.workspace.prOpen,
      label,
      locale,
    );
  }
  assert.ok(
    resources["zh-CN"].translation.workspace.prNoOpenPullRequest.includes("开放的拉取请求"),
  );
  assert.ok(
    resources["zh-TW"].translation.workspace.prNoOpenPullRequest.includes("開放的拉取請求"),
  );
});

test("Pull Request list tabs are localized in every catalog", () => {
  const expected = {
    en: ["{{count}} Open", "{{count}} Closed"],
    "zh-CN": ["{{count}} 开放", "{{count}} 已关闭"],
    "zh-TW": ["{{count}} 開放", "{{count}} 已關閉"],
    ja: ["{{count}} 件オープン", "{{count}} 件クローズ"],
    ko: ["열림 {{count}}", "닫힘 {{count}}"],
    de: ["{{count}} Offen", "{{count}} Geschlossen"],
    fr: ["{{count}} Ouvertes", "{{count}} Fermées"],
    es: ["{{count}} Abiertos", "{{count}} Cerrados"],
    "pt-BR": ["{{count}} Abertos", "{{count}} Fechados"],
    ru: ["{{count}} Открытые", "{{count}} Закрытые"],
  } as const;
  for (const [locale, labels] of Object.entries(expected)) {
    const { workspace } = resources[locale as keyof typeof resources].translation;
    assert.deepEqual([workspace.prListTabOpen, workspace.prListTabClosed], labels, locale);
  }
});

function placeholders(catalog: Parameters<typeof flattenMessageCatalog>[0]) {
  return Object.fromEntries(
    Object.entries(flattenMessageCatalog(catalog)).map(([key, message]) => [
      key,
      [
        ...(message.match(/\{\{\s*[^{}]+\s*\}\}/gu) ?? []),
        ...(message.match(/<\/?[A-Za-z][^>]*>/gu) ?? []),
      ].sort(),
    ]),
  );
}
