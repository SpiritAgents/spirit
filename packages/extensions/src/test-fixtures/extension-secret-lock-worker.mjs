import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { withExtensionSecretLock } from "../../dist/storage.js";

const [spiritDataDir, counterPath] = process.argv.slice(2);
await withExtensionSecretLock(
  { spiritDataDir, hostKind: "desktop" },
  "personal/demo",
  "credentials",
  async () => {
    const value = Number(await readFile(counterPath, "utf8"));
    await delay(50);
    await writeFile(counterPath, String(value + 1), "utf8");
  },
);
