import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("desktop settings preview uses the shared settings card surfaces", () => {
  const models = readFileSync(
    new URL("../src/components/desktop-models-preview.tsx", import.meta.url),
    "utf8",
  );
  assert.match(models, /DESKTOP_SETTINGS_CARD_SURFACE/);
  assert.match(models, /DESKTOP_SETTINGS_INSET_DIVIDERS/);
  assert.doesNotMatch(models, /divide-dialog-panel-border/);

  const window = readFileSync(
    new URL("../src/components/spirit-desktop-window.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    window,
    /data-spirit-content-translucency=\{useTranslucency \? "true" : "false"\}/,
  );
});
