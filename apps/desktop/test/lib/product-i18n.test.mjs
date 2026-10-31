import assert from "node:assert/strict";
import { test } from "vitest";
import { product } from "@spiritagent/product";
import i18n from "../../src/lib/i18n-host.ts";
import { joinWithCjkSpacing, needsSpaceBeforeInlineContent } from "../../src/lib/cjk.ts";

/** Scripts whose sentence-final full-width punctuation already carries trailing whitespace. */
const NO_SPACE_BEFORE_LINK_LANGUAGES = new Set(["zh-CN", "zh-TW", "ja"]);
const CONNECT_OPENAI_TITLES = {
  en: "Connect OpenAI",
  de: "OpenAI verbinden",
  es: "Conectar OpenAI",
  fr: "Connecter OpenAI",
  ja: "OpenAI に接続",
  ko: "OpenAI 연결",
  "pt-BR": "Conectar OpenAI",
  ru: "Подключить OpenAI",
  "zh-CN": "连接 OpenAI",
  "zh-TW": "連接 OpenAI",
};

for (const lng of ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN", "zh-TW"]) {
  test(`product interpolation preserves localized copy and plural rules in ${lng}`, () => {
    assert.equal(i18n.t("tray.tooltip", { lng }), product.name);
    assert.equal(i18n.t("onboarding.welcomeTitle", { lng }), product.name);
    assert.ok(
      i18n.t("settings.providerToolsDescription", { lng }).includes(product.name),
      `settings.providerToolsDescription must interpolate product.name in ${lng}`,
    );
    assert.equal(
      needsSpaceBeforeInlineContent(i18n.t("settings.providerToolsDescription", { lng })),
      !NO_SPACE_BEFORE_LINK_LANGUAGES.has(lng),
      `learn-more link separator must match script typography in ${lng}`,
    );
    const [connectionTitlePrefix = "", connectionTitleSuffix = ""] = i18n
      .t("settings.connectNamedProviderTitle", { lng })
      .split("{{provider}}");
    assert.equal(
      joinWithCjkSpacing(connectionTitlePrefix, "OpenAI", connectionTitleSuffix),
      CONNECT_OPENAI_TITLES[lng],
    );
    assert.ok(
      i18n.t("settings.hooksWorkspaceDirHint", { lng }).includes(product.workspaceDataFolderName),
    );
    const details = i18n.t("sidebar.removeWorkspaceConfirmDescription", {
      lng,
      count: 2,
      returnDetails: true,
    });
    const plural = details.res;
    assert.ok(plural.includes(product.name));
    const template = i18n.getResource(details.usedLng, "translation", details.exactUsedKey);
    if (template.includes("{{count}}")) assert.ok(plural.includes("2"));
    assert.doesNotMatch(plural, /\{\{/u);
  });
}

test("CJK-aware joins preserve existing whitespace and same-script text", () => {
  assert.equal(joinWithCjkSpacing("Connect ", "OpenAI"), "Connect OpenAI");
  assert.equal(joinWithCjkSpacing("OpenAI", " 연결"), "OpenAI 연결");
  assert.equal(joinWithCjkSpacing("连接", "阿里云"), "连接阿里云");
  assert.equal(joinWithCjkSpacing("连接", "Énergie"), "连接 Énergie");
});
