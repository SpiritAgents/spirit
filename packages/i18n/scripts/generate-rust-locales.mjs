import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const args = process.argv.slice(2);
const outDirIndex = args.indexOf("--out-dir");
if (outDirIndex < 0 || !args[outDirIndex + 1]) {
  throw new Error("Usage: generate-rust-locales.mjs --out-dir <directory>");
}

const sourceDir = fileURLToPath(new URL("../src/cli-locales/", import.meta.url));
const outDir = path.resolve(args[outDirIndex + 1]);
const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".json")).sort();
const resources = [];
for (const file of files) {
  const value = JSON.parse(await readFile(path.join(sourceDir, file), "utf8"));
  resources.push({ file, value });
}

const expectedKeys = Object.keys(
  resources.find((entry) => entry.file === "en.json")?.value ?? {},
).sort();
const placeholders = (value) =>
  typeof value === "string"
    ? [...value.matchAll(/%\{([A-Za-z0-9_]+)\}/gu)].map((match) => match[1]).sort()
    : [];

for (const { file, value } of resources) {
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`CLI locale key mismatch: ${file}`);
  }
  for (const key of expectedKeys) {
    const expected = placeholders(resources.find((entry) => entry.file === "en.json").value[key]);
    if (JSON.stringify(placeholders(value[key])) !== JSON.stringify(expected)) {
      throw new Error(`CLI locale interpolation mismatch: ${file} ${key}`);
    }
  }
}

await mkdir(outDir, { recursive: true });
for (const { file, value } of resources) {
  await writeFile(
    path.join(outDir, file.replace(/\.json$/u, ".yml")),
    YAML.stringify(value),
    "utf8",
  );
}
