import assert from "node:assert/strict";
import { test } from "vitest";

import {
  detectSystemLanguage,
  FALLBACK_LANGUAGE,
  isLanguagePreference,
  matchLocaleTag,
  resolveUiLocalePreference,
  SYSTEM_LANGUAGE,
} from "../../src/lib/ui-locale.ts";

test("matchLocaleTag maps common OS tags onto installed packs", () => {
  assert.equal(matchLocaleTag("en-US"), "en");
  assert.equal(matchLocaleTag("en_GB"), "en");
  assert.equal(matchLocaleTag("zh-CN"), "zh-CN");
  assert.equal(matchLocaleTag("zh-Hans-CN"), "zh-CN");
  assert.equal(matchLocaleTag("zh-TW"), "zh-TW");
  assert.equal(matchLocaleTag("zh-Hant-TW"), "zh-TW");
  assert.equal(matchLocaleTag("zh-HK"), "zh-TW");
  assert.equal(matchLocaleTag("ja-JP"), "ja");
  assert.equal(matchLocaleTag("pt-BR"), "pt-BR");
  assert.equal(matchLocaleTag("pt-PT"), undefined);
  assert.equal(matchLocaleTag("it-IT"), undefined);
});

test("detectSystemLanguage uses the first matching tag and falls back to English", () => {
  assert.equal(detectSystemLanguage(["en-US", "en"]), "en");
  assert.equal(detectSystemLanguage(["zh-CN"]), "zh-CN");
  assert.equal(detectSystemLanguage(["ja-JP"]), "ja");
  assert.equal(detectSystemLanguage(["it-IT", "it"]), FALLBACK_LANGUAGE);
  assert.equal(detectSystemLanguage([]), FALLBACK_LANGUAGE);
});

test("resolveUiLocalePreference follows system unless an installed language is stored", () => {
  assert.equal(resolveUiLocalePreference("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveUiLocalePreference("en", ["zh-CN"]), "en");
  assert.equal(resolveUiLocalePreference(SYSTEM_LANGUAGE, ["ja-JP"]), "ja");
  assert.equal(resolveUiLocalePreference(undefined, ["de-DE"]), "de");
  assert.equal(resolveUiLocalePreference("", ["ko-KR"]), "ko");
});

test("system is a language preference but not an installed pack", () => {
  assert.equal(isLanguagePreference(SYSTEM_LANGUAGE), true);
  assert.equal(isLanguagePreference("en"), true);
  assert.equal(isLanguagePreference("it"), false);
});
