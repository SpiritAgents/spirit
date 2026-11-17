import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { product } from "@spiritagent/product";
import {
  buildMarketplaceEntryFromDump,
  parseExtensionDumpText,
} from "@spiritagent/extension-toolkit";

const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtInRoot = path.join(hostRoot, "dist/resources/built-in");
const templatePath = path.join(builtInRoot, "marketplace.template.json");
const template = JSON.parse(await readFile(templatePath, "utf8"));
if (!Array.isArray(template.extensions)) {
  throw new Error(`${templatePath} is missing extensions[]`);
}

const names = [];
const entries = [];
for (const [offset, curation] of template.extensions.entries()) {
  if (
    curation === null ||
    typeof curation !== "object" ||
    typeof curation.name !== "string" ||
    !curation.name
  ) {
    throw new Error(`${templatePath} extensions[${offset}].name is missing`);
  }
  names.push(curation.name);
  const source = path.resolve(hostRoot, `../${curation.name}/dist/extension`);
  const dump = parseExtensionDumpText(
    await readFile(path.join(source, ".spirit", "extension.json"), "utf8"),
  );
  entries.push({
    ...buildMarketplaceEntryFromDump(dump, {
      source: curation.source,
      reviewStatus: curation.reviewStatus,
    }),
    icon: curation.icon,
    ...(curation.featured === undefined ? {} : { featured: curation.featured }),
    ...(curation.defaultInstalled === undefined
      ? {}
      : { defaultInstalled: curation.defaultInstalled }),
  });
}

const extensionsRoot = path.join(builtInRoot, "extensions");
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

const indexPath = path.join(builtInRoot, product.workspaceDataFolderName, "marketplace.json");
await mkdir(path.dirname(indexPath), { recursive: true });
await writeFile(indexPath, `${JSON.stringify({ ...template, extensions: entries }, null, 2)}\n`);
