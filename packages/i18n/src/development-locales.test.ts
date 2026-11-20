import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import i18next from "i18next";

import { watchDevelopmentLocales } from "./development-locales.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

describe("watchDevelopmentLocales", () => {
  it("replaces a host resource bundle without reinitializing i18next", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-i18n-watch-"));
    fixtures.push(directory);
    const locale = path.join(directory, "en.json");
    fs.writeFileSync(locale, JSON.stringify({ greeting: "Source" }));

    const instance = i18next.createInstance();
    await instance.init({
      lng: "en",
      resources: { en: { translation: { greeting: "Before" } } },
    });
    const close = watchDevelopmentLocales(instance, directory, { debounceMs: 0 });
    try {
      expect(instance.t("greeting")).toBe("Source");
      const updated = new Promise<void>((resolve) => {
        instance.once("languageChanged", () => resolve());
      });
      fs.writeFileSync(locale, JSON.stringify({ greeting: "After" }));
      await updated;
      expect(instance.t("greeting")).toBe("After");
    } finally {
      close();
    }
  });
});
