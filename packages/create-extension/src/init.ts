/**
 * init orchestration: scaffold an extension package directory from validated
 * options. Validation rules (name pattern, dump schema) come from
 * @spiritagent/extension-toolkit — this package never reimplements them.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EXTENSION_DUMP_FILE_NAME,
  EXTENSION_DUMP_SCHEMA_VERSION,
  MARKETPLACE_SPIRIT_DIR_NAME,
  assertMarketplaceExtensionName,
  type MarketplaceExtensionDump,
  type MarketplaceExtensionManifest,
} from "@spiritagent/extension-toolkit";

import {
  buildMainModule,
  capabilityDefinition,
  mergeContributes,
  mergeRequestedCapabilities,
  needsMainModule,
  titleFromName,
  type InitCapabilityId,
} from "./capabilities.js";

export interface InitExtensionOptions {
  /** kebab-case extension name (validated with the toolkit's rule). */
  name: string;
  displayName?: string;
  description?: string;
  capabilities: readonly InitCapabilityId[];
  targetDir: string;
}

export interface InitExtensionResult {
  targetDir: string;
  filesWritten: string[];
  /** Registry entry snippet to hand to a marketplace registry. */
  registryEntry: Record<string, unknown>;
}

const DEFAULT_VERSION = "0.1.0";

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
`;

export async function initExtension(options: InitExtensionOptions): Promise<InitExtensionResult> {
  const name = assertMarketplaceExtensionName(options.name, "name");
  const title = options.displayName?.trim() || titleFromName(name);
  const description =
    options.description?.trim() ||
    `TODO: describe what the ${name} extension does and when to use it.`;
  const capabilities = [...new Set(options.capabilities)];
  const input = { name, title, description };

  const targetDir = path.resolve(options.targetDir);
  let existing: string[] = [];
  try {
    existing = await readdir(targetDir);
  } catch {
    // Does not exist yet; created below.
  }
  if (existing.length > 0) {
    throw new Error(`The target directory is not empty: ${targetDir}`);
  }

  const contributes = mergeContributes(capabilities, input);
  const requestedCapabilities = mergeRequestedCapabilities(capabilities);
  const manifest: MarketplaceExtensionManifest = {
    supportedHosts: ["cli", "desktop"],
    activationEvents: ["onStartup"],
    ...(requestedCapabilities.length ? { requestedCapabilities } : {}),
    ...(Object.keys(contributes).length ? { contributes } : {}),
  };

  const dump: MarketplaceExtensionDump = {
    schemaVersion: EXTENSION_DUMP_SCHEMA_VERSION,
    name,
    version: DEFAULT_VERSION,
    sourceId: "self-declared",
    displayName: title,
    description,
    icon: "icon.svg",
    manifest,
  };

  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(
      {
        name,
        version: DEFAULT_VERSION,
        ...(needsMainModule(capabilities) ? { main: "index.mjs" } : {}),
      },
      null,
      2,
    )}\n`,
    "icon.svg": DEFAULT_ICON_SVG,
    [`${MARKETPLACE_SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}`]: `${JSON.stringify(dump, null, 2)}\n`,
  };
  for (const id of capabilities) {
    Object.assign(files, capabilityDefinition(id).files(input));
  }
  if (needsMainModule(capabilities)) {
    files["index.mjs"] = buildMainModule(capabilities, input);
  }

  const filesWritten: string[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(targetDir, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    filesWritten.push(relativePath);
  }

  const registryEntry = {
    name,
    version: DEFAULT_VERSION,
    source: `./extensions/${name}`,
    icon: `extensions/${name}/icon.svg`,
    displayName: title,
    description,
    reviewStatus: "unverified",
    manifest,
  };

  return { targetDir, filesWritten, registryEntry };
}
