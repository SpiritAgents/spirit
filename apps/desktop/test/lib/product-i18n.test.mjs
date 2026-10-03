import assert from "node:assert/strict";
import { test } from "vitest";
import { product } from "@spiritagent/product";
import i18n from "../../src/lib/i18n-host.ts";

for (const lng of ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN", "zh-TW"]) {
  test(`product interpolation preserves localized copy and plural rules in ${lng}`, () => {
    assert.equal(i18n.t("tray.tooltip", { lng }), product.name);
    assert.equal(i18n.t("onboarding.welcomeTitle", { lng }), product.name);
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
