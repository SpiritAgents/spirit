import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

test("pairing intro uses a wide shared content boundary and a single settings header", async () => {
  const dialogs = await readFile(
    new URL(
      "../../src/components/settings/panels/remote-control-pairing-dialogs.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(dialogs, /sm:max-w-2xl/);
  assert.doesNotMatch(dialogs, /max-w-xs/);
  assert.match(dialogs, /mx-auto w-full max-w-xl space-y-6/);
  assert.match(dialogs, /showCloseButton={false}/);
  assert.match(dialogs, /pt-4/);
  assert.match(dialogs, /border-t-0 bg-transparent/);
  assert.match(dialogs, /@spiritagent\/icons\/copy/);
  assert.match(dialogs, /@spiritagent\/icons\/check/);
  assert.match(dialogs, /mx-auto flex w-full max-w-56 justify-center pt-16 pb-2/);
  assert.match(dialogs, /sm:max-w-sm pb-23/);
  assert.match(dialogs, /relative -mt-2 mx-auto w-full min-w-0 max-w-56/);
  assert.match(dialogs, /w-full truncate pr-7 text-sm text-muted-foreground/);
  assert.match(dialogs, /absolute inset-y-0 right-0 flex items-center bg-popover/);
  assert.doesNotMatch(dialogs, /group-hover|group-focus-within|opacity-0|pointer-events-none/);

  const settingsView = await readFile(
    new URL("../../src/components/settings/settings-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settingsView, /tab !== "networks"/);

  const zhCN = JSON.parse(
    await readFile(
      new URL("../../../../packages/i18n/src/locales/zh-CN.json", import.meta.url),
      "utf8",
    ),
  );
  const zhTW = JSON.parse(
    await readFile(
      new URL("../../../../packages/i18n/src/locales/zh-TW.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(zhCN.settings.pairIntroducingTitle, "配对 Spirit 远程控制");
  assert.equal(zhTW.settings.pairIntroducingTitle, "配對 Spirit 遠端控制");
});
