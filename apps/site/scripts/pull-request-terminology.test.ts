import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const integrationTerms = {
  "en-US": "pull requests",
  "zh-TW": "拉取請求",
  ja: "プルリクエスト",
  ko: "끌어오기 요청",
  de: "Pull-Requests",
  fr: "demandes de tirage",
  es: "solicitudes de incorporación",
  "pt-BR": "pull requests",
  ru: "запросам на слияние",
} as const;

const docLocales = ["en-US", "zh-CN", ...Object.keys(integrationTerms).filter((locale) => locale !== "en-US")];

const contributingHeadings = {
  "zh-CN": "## 拉取请求",
  "zh-TW": "## 拉取請求",
  ja: "## プルリクエスト",
  ko: "## 끌어오기 요청",
  fr: "## Demandes de tirage",
  es: "## Solicitudes de incorporación",
  ru: "## Запросы на слияние",
} as const;

const legacyTerms: Record<string, RegExp[]> = {
  es: [/solicitudes? de extracción/iu],
  ko: [/풀 리퀘스트/u],
};

function readDoc(locale: string, page: string) {
  return readFileSync(new URL(`../content/docs/${locale}/${page}.mdx`, import.meta.url), "utf8");
}

function readRepositoryDoc(filename: string) {
  return readFileSync(new URL(`../../../docs/${filename}`, import.meta.url), "utf8");
}

function withoutLinkTargets(content: string) {
  return content.replace(/\]\([^)]*\)/gu, "]");
}

test("integration docs use canonical Pull Request terminology", () => {
  for (const [locale, term] of Object.entries(integrationTerms)) {
    assert.ok(readDoc(locale, "customize/integrations").includes(term), locale);
  }
});

test("translated integration and extension docs omit English and legacy Pull Request terms", () => {
  for (const locale of docLocales) {
    if (locale === "en-US" || locale === "de" || locale === "pt-BR") {
      continue;
    }
    for (const page of ["customize/integrations", "develop/extensions"]) {
      const content = withoutLinkTargets(readDoc(locale, page));
      assert.doesNotMatch(content, /pull[ -]?requests?/iu, `${locale}:${page}`);
      for (const legacy of legacyTerms[locale] ?? []) {
        assert.doesNotMatch(content, legacy, `${locale}:${page}`);
      }
    }
  }
});

test("repository contribution guides use localized Pull Request headings", () => {
  for (const [locale, heading] of Object.entries(contributingHeadings)) {
    assert.ok(readRepositoryDoc(`CONTRIBUTING_${locale}.md`).includes(heading), locale);
  }
});

test("translated repository guides omit English and legacy Pull Request terms", () => {
  for (const locale of Object.keys(contributingHeadings)) {
    for (const basename of ["ACCESSIBILITY", "CONTRIBUTING"]) {
      const filename = `${basename}_${locale}.md`;
      const content = withoutLinkTargets(readRepositoryDoc(filename));
      assert.doesNotMatch(content, /pull[ -]?requests?/iu, filename);
      for (const legacy of legacyTerms[locale] ?? []) {
        assert.doesNotMatch(content, legacy, filename);
      }
    }
  }
});
