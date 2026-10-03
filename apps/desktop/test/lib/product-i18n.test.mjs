import assert from "node:assert/strict";
import { test } from "vitest";
import { product } from "@spiritagent/product";
import i18n from "../../src/lib/i18n-host.ts";
import { needsSpaceBeforeInlineContent } from "../../src/lib/cjk.ts";

/** Scripts whose sentence-final full-width punctuation already carries trailing whitespace. */
const NO_SPACE_BEFORE_LINK_LANGUAGES = new Set(["zh-CN", "zh-TW", "ja"]);

for (const lng of ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN", "zh-TW"]) {
  test(`product interpolation preserves localized copy and plural rules in ${lng}`, () => {
    assert.equal(i18n.t("tray.tooltip", { lng }), product.name);
    assert.equal(i18n.t("onboarding.welcomeTitle", { lng }), product.name);
    assert.ok(
      i18n.t("settings.webSearchDescription", { lng }).includes(product.name),
      `settings.webSearchDescription must interpolate product.name in ${lng}`,
    );
    assert.equal(
      needsSpaceBeforeInlineContent(i18n.t("settings.webSearchDescription", { lng })),
      !NO_SPACE_BEFORE_LINK_LANGUAGES.has(lng),
      `learn-more link separator must match script typography in ${lng}`,
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
