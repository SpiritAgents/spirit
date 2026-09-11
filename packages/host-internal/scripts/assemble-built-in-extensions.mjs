import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(hostRoot, "built-in/.spirit/marketplace.json");
const index = JSON.parse(await readFile(indexPath, "utf8"));
if (!Array.isArray(index.extensions)) {
  throw new Error(`${indexPath} is missing extensions[]`);
}

const names = [];
for (const [offset, entry] of index.extensions.entries()) {
  if (entry === null || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name) {
    throw new Error(`${indexPath} extensions[${offset}].name is missing`);
  }
  names.push(entry.name);
}

const extensionsRoot = path.join(hostRoot, "built-in/extensions");
await rm(extensionsRoot, { recursive: true, force: true });

for (const name of names) {
  const source = path.resolve(hostRoot, `../${name}/dist/extension`);
  const dest = path.join(extensionsRoot, name);
  try {
    await access(source, fsConstants.F_OK);
  } catch {
    throw new Error(
      `Built-in extension "${name}" is missing ${source}. Build @spiritagent/${name} first.`,
    );
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(source, dest, { recursive: true });
}
