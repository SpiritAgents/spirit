/**
 * init orchestration: scaffold an extension package directory from validated
 * options. Validation rules (name pattern, dump schema) come from
 * @spiritagent/extension-toolkit — this package never reimplements them.
 */

import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
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

// Construction-grid placeholder icon (1024 canvas, 8×8 grid of 128px cells,
// two diagonals, concentric circles at 820/512/204). Stroke 8 is ~0.3 CSS px
// at the 40px list icon. Do not use vector-effect=non-scaling-stroke here:
// <img> rasterization raises that stroke to at least 1 CSS px, which reads
// as a bold grate at this density.
const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none" stroke="#8E8E93" stroke-width="8">
  <path d="M0 0H1024M0 128H1024M0 256H1024M0 384H1024M0 512H1024M0 640H1024M0 768H1024M0 896H1024M0 1024H1024" />
  <path d="M0 0V1024M128 0V1024M256 0V1024M384 0V1024M512 0V1024M640 0V1024M768 0V1024M896 0V1024M1024 0V1024" />
  <path d="M0 0L1024 1024M1024 0L0 1024" />
  <circle cx="512" cy="512" r="410" />
  <circle cx="512" cy="512" r="256" />
  <circle cx="512" cy="512" r="102" />
</svg>
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
    // Example values so the protocol fields are discoverable without the docs.
    author: { name: "Your Name", email: "you@example.com" },
    keywords: ["spirit-extension"],
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
    // Hook scripts are spawned as executables on POSIX hosts; Windows has no
    // executable bit, and the hook runner skips the check there.
    if (relativePath.endsWith(".sh") && process.platform !== "win32") {
      await chmod(target, 0o755);
    }
    filesWritten.push(relativePath);
  }

  const registryEntry = {
    name,
    version: DEFAULT_VERSION,
    source: `./extensions/${name}`,
    icon: `extensions/${name}/icon.svg`,
    displayName: title,
    description,
    author: { name: "Your Name", email: "you@example.com" },
    keywords: ["spirit-extension"],
    reviewStatus: "unverified",
    manifest,
  };

  return { targetDir, filesWritten, registryEntry };
}
