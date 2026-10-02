import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const NPM_PACKAGE_DIRS = [
  "packages/product",
  "packages/agent-core",
  // The existing toolkit/scaffolder cycle is staged as one publication group.
  "packages/extension-toolkit",
  "packages/create-extension",
  "packages/host-internal",
  "packages/server",
  "packages/acp-server",
];

export async function readNpmPackages() {
  return Promise.all(
    NPM_PACKAGE_DIRS.map(async (directory) => {
      const url = new URL(`../../${directory}/package.json`, import.meta.url);
      const { name, version, private: isPrivate } = JSON.parse(await readFile(url, "utf8"));
      if (isPrivate || typeof name !== "string" || typeof version !== "string") {
        throw new Error(`Invalid publishable package metadata: ${directory}`);
      }
      return { directory, name, version };
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packages = await readNpmPackages();
  for (const item of packages) {
    console.log(process.argv.includes("--filters") ? `--filter=${item.name}` : item.directory);
  }
}
