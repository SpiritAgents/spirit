/**
 * `extension-toolkit pack <dir>`: package an extension directory into the ZIP
 * distribution format (content at the archive root + .spirit/extension.json),
 * the same layout the Desktop/CLI "import extension" flow consumes. The dump
 * must already exist (scaffold it with `init`); pack never synthesizes one.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { zipSync } from "fflate";

import { checkExtensionPackage } from "./check-package.js";
import {
  EXTENSION_DUMP_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseExtensionDumpText,
} from "./schema.js";

export interface PackExtensionResult {
  zipPath: string;
  name: string;
  version: string;
  fileCount: number;
}

/** Directories that never belong in a distribution archive. */
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git"]);

async function collectPackageFiles(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  async function walk(currentDir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files[relativePath] = new Uint8Array(await readFile(absolutePath));
      }
    }
  }
  await walk(dir, "");
  return files;
}

export async function packExtension(dir: string, outDir: string): Promise<PackExtensionResult> {
  const dumpRelativePath = `${MARKETPLACE_SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}`;
  let dumpRaw: string;
  try {
    dumpRaw = await readFile(path.join(dir, dumpRelativePath), "utf8");
  } catch {
    throw new Error(
      `No ${dumpRelativePath} in ${dir}. Scaffold the self-declared manifest first: extension-toolkit init`,
    );
  }
  const dump = parseExtensionDumpText(dumpRaw);

  const findings = await checkExtensionPackage(dir);
  if (findings.length > 0) {
    throw new Error(
      `check failed for ${dir}:\n${findings.map((f) => `${f.path}: ${f.message}`).join("\n")}`,
    );
  }

  const files = await collectPackageFiles(dir);
  const zipPath = path.join(outDir, `${dump.name}-${dump.version}.zip`);
  await writeFile(zipPath, zipSync(files));
  return { zipPath, name: dump.name, version: dump.version, fileCount: Object.keys(files).length };
}
