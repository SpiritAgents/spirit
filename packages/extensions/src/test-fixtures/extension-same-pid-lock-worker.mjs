import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withExtensionSecretLock } from "../../dist/storage.js";

const [spiritDataDir] = process.argv.slice(2);
const context = { spiritDataDir, hostKind: "desktop" };
const directory = join(spiritDataDir, "extensions", "desktop", "extension-state");
const lockPath = join(directory, "ext-cGVyc29uYWwvZGVtbw-Y3JlZGVudGlhbHM.lock");
await mkdir(directory, { recursive: true });
await writeFile(
  lockPath,
  JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: "closed-owner" }),
);
await withExtensionSecretLock(context, "personal/demo", "credentials", async () => {});
try {
  await readFile(lockPath, "utf8");
  throw new Error("The released Secret lock still exists.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
