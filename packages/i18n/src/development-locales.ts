import fs from "node:fs";
import path from "node:path";

import type { i18n } from "i18next";

import { isValidLanguage } from "./ui-locale.js";

/** Development-only live resource updates for Node hosts; production never starts this watcher. */
export function watchDevelopmentLocales(
  instance: i18n,
  directory: string,
  { debounceMs = 40 }: { debounceMs?: number } = {},
): () => void {
  const timers = new Map<string, NodeJS.Timeout>();

  function reload(filename: string): void {
    const language = path.basename(filename, ".json");
    if (!isValidLanguage(language)) return;
    try {
      const translation = JSON.parse(fs.readFileSync(path.join(directory, filename), "utf8"));
      instance.removeResourceBundle(language, "translation");
      instance.addResourceBundle(language, "translation", translation);
      // Host projections cache localized extension metadata; reuse the same
      // invalidation signal as a language switch without changing the locale.
      instance.emit("languageChanged", instance.language);
    } catch (error) {
      // Editors can expose a partially-written JSON file. Keep the last valid
      // resource bundle and wait for the next filesystem event.
      console.warn(`[i18n] skipped invalid development locale ${filename}`, error);
    }
  }

  const watcher = fs.watch(directory, { persistent: false }, (_event, filename) => {
    if (!filename || !filename.toString().endsWith(".json")) return;
    const name = filename.toString();
    clearTimeout(timers.get(name));
    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        reload(name);
      }, debounceMs),
    );
  });

  // Locale HMR intentionally bypasses dist builds. A later runtime reload must
  // still start from the latest source resources rather than stale compiled JSON.
  for (const filename of fs.readdirSync(directory)) {
    if (filename.endsWith(".json")) reload(filename);
  }

  return () => {
    watcher.close();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
