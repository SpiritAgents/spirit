import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist/extension");
await mkdir(output, { recursive: true });
for (const name of ["README.md", "LICENSE", "icon.svg", "mcp.json"])
  await copyFile(path.join(root, name), path.join(output, name));
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "notion",
      version: "1.0.0",
      type: "module",
      main: "index.mjs",
      license: "MIT",
      author: { name: "Spirit", email: "hi@spirit.dev", url: "https://spirit.dev" },
      homepage: "https://spirit.dev",
    },
    null,
    2,
  ) + "\n",
);

const declaration = JSON.parse(await readFile(path.join(root, "spirit-extension.json"), "utf8"));
const localesRoot = path.join(root, "locales");
const messages = {};
for (const fileName of (await readdir(localesRoot)).sort()) {
  if (!fileName.endsWith(".json")) continue;
  const locale = fileName.slice(0, -".json".length);
  messages[locale] = JSON.parse(await readFile(path.join(localesRoot, fileName), "utf8"));
}
const dumpDir = path.join(output, ".spirit");
await mkdir(dumpDir, { recursive: true });
await writeFile(
  path.join(dumpDir, "extension.json"),
  `${JSON.stringify({ ...declaration, messages }, null, 2)}\n`,
);
await mkdir(path.join(output, "locales"), { recursive: true });
for (const locale of Object.keys(messages)) {
  await copyFile(
    path.join(localesRoot, `${locale}.json`),
    path.join(output, "locales", `${locale}.json`),
  );
}
