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

test("Simplified Chinese uses the same open status in the empty state and badge", () => {
  const { workspace } = resources["zh-CN"].translation;
  assert.equal(workspace.prOpen, "进行中");
  assert.ok(workspace.prNoOpenPullRequest.includes("进行中的拉取请求"));
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
