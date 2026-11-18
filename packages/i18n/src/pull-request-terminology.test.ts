import assert from "node:assert/strict";
import { test } from "vitest";

import { cliResources } from "./cli-resources.js";
import { resources } from "./resources.js";

const attributionTerms = {
  en: "pull requests",
  "zh-CN": "拉取请求",
  "zh-TW": "拉取請求",
  ja: "プルリクエスト",
  ko: "끌어오기 요청",
  de: "Agent-Pull-Requests",
  fr: "demandes de tirage",
  es: "solicitudes de incorporación",
  "pt-BR": "pull requests",
  ru: "запросах на слияние",
} as const;

const eventMessages = {
  en: "Pull request created",
  "zh-CN": "拉取请求创建",
  "zh-TW": "拉取請求已建立",
  ja: "プルリクエスト作成時",
  ko: "끌어오기 요청 생성됨",
  de: "Pull Request erstellt",
  fr: "Demande de tirage créée",
  es: "Solicitud de incorporación creada",
  "pt-BR": "Pull request criado",
  ru: "Запрос на слияние создан",
} as const;

const legacyTerms: Record<string, RegExp[]> = {
  es: [/solicitudes? de extracción/iu],
  ko: [/풀 리퀘스트/u],
};

function strings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

test("Pull Request terminology is canonical in Workbench and CLI messages", () => {
  for (const [locale, term] of Object.entries(attributionTerms)) {
    const message =
      resources[locale as keyof typeof resources].translation.settings.prAttributionDescription;
    assert.ok(message.includes(term), `${locale}: ${message}`);
  }

  for (const [locale, expected] of Object.entries(eventMessages)) {
    const catalog = cliResources[locale as keyof typeof cliResources];
    assert.equal(
      catalog["tui.tool.approval.schedule.event_pull_request_created"],
      expected,
      locale,
    );
  }
});

test("translated Workbench and CLI catalogs omit English and legacy Pull Request terms", () => {
  for (const [locale, catalog] of [
    ...Object.entries(resources).map(
      ([locale, resource]) => [locale, resource.translation] as const,
    ),
    ...Object.entries(cliResources),
  ]) {
    if (locale === "en" || locale === "de" || locale === "pt-BR") {
      continue;
    }
    for (const message of strings(catalog)) {
      assert.doesNotMatch(message, /pull[ -]?requests?/iu, `${locale}: ${message}`);
      for (const legacy of legacyTerms[locale] ?? []) {
        assert.doesNotMatch(message, legacy, `${locale}: ${message}`);
      }
    }
  }
});
