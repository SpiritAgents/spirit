/**
 * marketplace.json schema (schemaVersion 1) — the single source of truth for
 * the registry format. Consumed by the host at install/runtime and by
 * registry CI (template repositories) so the two never drift.
 *
 * Spirit metadata lives only here (the registry endorses capability
 * declarations); extension packages on npm stay pure npm.
 */

import { assertMarketplaceIconPath } from "./icon.js";
import { product } from "@spiritagent/product";
import { assertRegistryRelativePath } from "./paths.js";
import { isMarketplaceVersionString, parseMarketplaceVersion } from "./semver.js";
import {
  assertExtensionMessageReferences,
  parseExtensionLocalization,
  parseLocalizableText,
  type ExtensionLocalization,
  type ExtensionMessageCatalog,
  type LocalizableText,
} from "./localization.js";

export const MARKETPLACE_SCHEMA_VERSION = 1;
export const MARKETPLACE_INDEX_FILE_NAME = "marketplace.json";
export const MARKETPLACE_SPIRIT_DIR_NAME = product.workspaceDataFolderName;
/** Installed extension dump file name; lives at `<installDir>/.spirit/extension.json`. */
export const EXTENSION_DUMP_FILE_NAME = "extension.json";

export const MARKETPLACE_EXTENSION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const MARKETPLACE_REVIEW_STATUSES = ["unverified", "verified", "revoked"] as const;
export type MarketplaceReviewStatus = (typeof MARKETPLACE_REVIEW_STATUSES)[number];

export const MARKETPLACE_HOST_KINDS = ["cli", "desktop"] as const;
export type MarketplaceHostKind = (typeof MARKETPLACE_HOST_KINDS)[number];

export const MARKETPLACE_CATEGORIES = ["development"] as const;
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

/** Instruction contributions whose declared files must exist in the package. */
export const MARKETPLACE_INSTRUCTION_CONTRIBUTION_KEYS = [
  "mcp",
  "hooks",
  "skills",
  "rules",
] as const;
export type MarketplaceInstructionContributionKey =
  (typeof MARKETPLACE_INSTRUCTION_CONTRIBUTION_KEYS)[number];

export interface MarketplaceOwner {
  name: string;
  email?: string;
  url?: string;
}

export type MarketplaceExtensionAuthor = MarketplaceOwner;

export interface MarketplaceNpmSource {
  source: "npm";
  /** Pinned `name@x.y.z` specifier; integrity comes from the packument. */
  package: string;
}

/** Dual form: registry-root-relative path string (local) or pinned npm object. */
export type MarketplaceExtensionSource = string | MarketplaceNpmSource;

/**
 * Registry-entry manifest (the runtime declaration). Deep per-field parsing
 * of tools / desktop (css, settingsPage, views) / cli / settingsSchema / secretSlots runs at install
 * time in the host; the toolkit validates structure and declaration
 * consistency so registry CI can gate obviously broken entries.
 */
export interface MarketplaceExtensionManifest {
  supportedHosts: MarketplaceHostKind[];
  activationEvents?: string[];
  requestedCapabilities?: string[];
  contributes?: MarketplaceManifestContributes;
  settingsSchema?: unknown[];
  secretSlots?: string[];
}

export interface MarketplaceManifestContributes {
  mcp?: MarketplaceMcpContributionPresentation[];
  hooks?: MarketplaceHookContributionPresentation[];
  skills?: MarketplaceSkillContributionPresentation[];
  rules?: MarketplaceRuleContributionPresentation;
  /** Deeper contribution shapes (tools / desktop / cli) validated at install. */
  [key: string]: unknown;
}

export interface MarketplaceMcpContributionPresentation {
  name: string;
  displayName: LocalizableText;
  transport: "stdio" | "http";
}

export interface MarketplaceHookContributionPresentation {
  event: string;
  displayName: LocalizableText;
}

export interface MarketplaceSkillContributionPresentation {
  name: string;
  displayName: LocalizableText;
  summary: LocalizableText;
}

export interface MarketplaceRuleContributionPresentation {
  displayName: LocalizableText;
  summary: LocalizableText;
}

export interface MarketplaceExtensionEntry extends ExtensionLocalization {
  /** Spirit-owned extension id inside this registry (kebab-case). */
  name: string;
  /** Spirit-owned version (strict semver, no pre-release). */
  version: string;
  source: MarketplaceExtensionSource;
  /** Registry-root-relative SVG path. */
  icon?: string;
  displayName: LocalizableText;
  description: LocalizableText;
  author?: MarketplaceExtensionAuthor;
  category?: MarketplaceCategory;
  keywords?: LocalizableText[];
  /** Project URL (npm package.json homepage convention), shown as the Website row. */
  homepage?: string;
  featured?: boolean;
  /** Per-version review semantics; defaults to "unverified" when omitted. */
  reviewStatus: MarketplaceReviewStatus;
  /** Built-in registry curation: seed this entry on first launch. */
  defaultInstalled?: boolean;
  manifest: MarketplaceExtensionManifest;
}

export interface MarketplaceIndex {
  schemaVersion: number;
  /** Registry id (kebab-case), unique within a user's configured sources. */
  name: string;
  displayName: string;
  description?: string;
  owner?: MarketplaceOwner;
  extensions: MarketplaceExtensionEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, fieldName);
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }
  return value;
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${fieldName} must be an array of non-empty strings.`);
  }
  return value.map((item) => (item as string).trim());
}

/** Parse the npm-style person string: "Name <email> (https://url)". */
function parseNpmPersonString(value: string, fieldName: string): MarketplaceOwner {
  const trimmed = value.trim();
  const email = /<([^<>]*)>/.exec(trimmed)?.[1]?.trim();
  const url = /\(([^()]*)\)/.exec(trimmed)?.[1]?.trim();
  const name = trimmed
    .replace(/<[^<>]*>/, "")
    .replace(/\([^()]*\)/, "")
    .trim();
  if (!name) {
    throw new Error(`${fieldName} must name the person: ${value}`);
  }
  return {
    name,
    ...(email ? { email } : {}),
    ...(url ? { url } : {}),
  };
}

/**
 * Shared person parsing for the registry-level owner and the entry/dump
 * author: an object with a name plus optional email/url, or the npm string
 * form "Name <email> (https://url)".
 */
function parseOwner(value: unknown, fieldName: string): MarketplaceOwner {
  if (typeof value === "string") {
    return parseNpmPersonString(value, fieldName);
  }
  if (!isRecord(value)) {
    throw new Error(
      `${fieldName} must be an object with a name or an npm-style "Name <email> (url)" string.`,
    );
  }
  const name = requiredString(value.name, `${fieldName}.name`);
  const email = optionalString(value.email, `${fieldName}.email`);
  const url = optionalString(value.url, `${fieldName}.url`);
  return {
    name,
    ...(email === undefined ? {} : { email }),
    ...(url === undefined ? {} : { url }),
  };
}

export function assertMarketplaceExtensionName(name: unknown, fieldName: string): string {
  const value = requiredString(name, fieldName);
  if (!MARKETPLACE_EXTENSION_NAME_PATTERN.test(value)) {
    throw new Error(
      `${fieldName} must be kebab-case (lowercase letters, digits, hyphens): ${value}`,
    );
  }
  return value;
}

const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

export interface ParsedNpmPackageSpecifier {
  packageName: string;
  version: string;
}

/** Parse a pinned `name@x.y.z` npm specifier; ranges and tags are rejected. */
export function parseNpmPackageSpecifier(
  value: string,
  fieldName: string,
): ParsedNpmPackageSpecifier {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    throw new Error(`${fieldName} must be a pinned "name@x.y.z" specifier: ${value}`);
  }
  const packageName = trimmed.slice(0, atIndex);
  const version = trimmed.slice(atIndex + 1);
  if (!NPM_PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new Error(`${fieldName} has an invalid npm package name: ${packageName}`);
  }
  parseMarketplaceVersion(version, `${fieldName} version`);
  return { packageName, version };
}

export type MarketplaceResolvedSource =
  | { kind: "local"; path: string }
  | { kind: "npm"; packageName: string; version: string };

/** Validate and normalize the dual-form `source` field of an entry. */
export function resolveMarketplaceExtensionSource(
  source: unknown,
  fieldName: string,
): MarketplaceResolvedSource {
  if (typeof source === "string") {
    return { kind: "local", path: assertRegistryRelativePath(source, fieldName) };
  }
  if (isRecord(source)) {
    if (source.source === "npm") {
      const specifier = requiredString(source.package, `${fieldName}.package`);
      const parsed = parseNpmPackageSpecifier(specifier, `${fieldName}.package`);
      return { kind: "npm", packageName: parsed.packageName, version: parsed.version };
    }
    throw new Error(
      `${fieldName}.source must be "npm" (git and other backends are reserved for future use).`,
    );
  }
  throw new Error(`${fieldName} must be a registry-relative path string or an npm source object.`);
}

function parseManifest(value: unknown, fieldName: string): MarketplaceExtensionManifest {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  if (!Array.isArray(value.supportedHosts) || value.supportedHosts.length === 0) {
    throw new Error(`${fieldName}.supportedHosts must be a non-empty array.`);
  }
  const supportedHosts = value.supportedHosts.map((host, index) => {
    if (typeof host !== "string" || !(MARKETPLACE_HOST_KINDS as readonly string[]).includes(host)) {
      throw new Error(
        `${fieldName}.supportedHosts[${index}] must be one of: ${MARKETPLACE_HOST_KINDS.join(", ")}.`,
      );
    }
    return host as MarketplaceHostKind;
  });

  const activationEvents = optionalStringArray(
    value.activationEvents,
    `${fieldName}.activationEvents`,
  );
  const requestedCapabilities = optionalStringArray(
    value.requestedCapabilities,
    `${fieldName}.requestedCapabilities`,
  );

  let contributes: MarketplaceManifestContributes | undefined;
  if (value.contributes !== undefined) {
    if (!isRecord(value.contributes)) {
      throw new Error(`${fieldName}.contributes must be an object.`);
    }
    contributes = {
      ...value.contributes,
      ...(value.contributes.mcp === undefined
        ? {}
        : { mcp: parseMcpPresentations(value.contributes.mcp, `${fieldName}.contributes.mcp`) }),
      ...(value.contributes.hooks === undefined
        ? {}
        : {
            hooks: parseHookPresentations(
              value.contributes.hooks,
              `${fieldName}.contributes.hooks`,
            ),
          }),
      ...(value.contributes.skills === undefined
        ? {}
        : {
            skills: parseSkillPresentations(
              value.contributes.skills,
              `${fieldName}.contributes.skills`,
            ),
          }),
      ...(value.contributes.rules === undefined
        ? {}
        : {
            rules: parseRulePresentation(value.contributes.rules, `${fieldName}.contributes.rules`),
          }),
    };
  }

  if (value.settingsSchema !== undefined && !Array.isArray(value.settingsSchema)) {
    throw new Error(`${fieldName}.settingsSchema must be an array.`);
  }
  if (
    value.secretSlots !== undefined &&
    (!Array.isArray(value.secretSlots) ||
      value.secretSlots.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`${fieldName}.secretSlots must be an array of strings.`);
  }

  assertDeclarationConsistency(requestedCapabilities, contributes, fieldName);

  return {
    supportedHosts,
    ...(activationEvents ? { activationEvents } : {}),
    ...(requestedCapabilities ? { requestedCapabilities } : {}),
    ...(contributes ? { contributes } : {}),
    ...(value.settingsSchema ? { settingsSchema: value.settingsSchema as unknown[] } : {}),
    ...(value.secretSlots ? { secretSlots: value.secretSlots as string[] } : {}),
  };
}

/** Declared contributions and requested capabilities must agree (both directions). */
function assertDeclarationConsistency(
  requestedCapabilities: readonly string[] | undefined,
  contributes: MarketplaceManifestContributes | undefined,
  fieldName: string,
): void {
  const capabilities = new Set(requestedCapabilities ?? []);
  for (const key of MARKETPLACE_INSTRUCTION_CONTRIBUTION_KEYS) {
    const hasContribution = contributes?.[key] !== undefined;
    const hasCapability = capabilities.has(key);
    if (hasContribution === hasCapability) {
      continue;
    }
    throw new Error(
      hasContribution
        ? `The entry declares ${fieldName}.contributes.${key} but is missing ${key} in ${fieldName}.requestedCapabilities.`
        : `The entry declares the ${key} capability but is missing ${fieldName}.contributes.${key}.`,
    );
  }
  const hasDesktopContribution = contributes?.["desktop"] !== undefined;
  const hasCliContribution = contributes?.["cli"] !== undefined;
  if (hasDesktopContribution !== capabilities.has("desktop-ui")) {
    throw new Error(
      hasDesktopContribution
        ? `The entry declares ${fieldName}.contributes.desktop but is missing desktop-ui in ${fieldName}.requestedCapabilities.`
        : `The entry declares the desktop-ui capability but is missing ${fieldName}.contributes.desktop.`,
    );
  }
  if (hasCliContribution !== capabilities.has("cli-ui")) {
    throw new Error(
      hasCliContribution
        ? `The entry declares ${fieldName}.contributes.cli but is missing cli-ui in ${fieldName}.requestedCapabilities.`
        : `The entry declares the cli-ui capability but is missing ${fieldName}.contributes.cli.`,
    );
  }
}

function parseMcpPresentations(
  value: unknown,
  fieldName: string,
): MarketplaceMcpContributionPresentation[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((entry, index) => {
    const field = `${fieldName}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${field} must be an object.`);
    }
    const transport = requiredString(entry.transport, `${field}.transport`);
    if (transport !== "stdio" && transport !== "http") {
      throw new Error(`${field}.transport must be "stdio" or "http".`);
    }
    return {
      name: requiredString(entry.name, `${field}.name`),
      displayName: parseLocalizableText(entry.displayName, `${field}.displayName`),
      transport,
    };
  });
}

function parseHookPresentations(
  value: unknown,
  fieldName: string,
): MarketplaceHookContributionPresentation[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((entry, index) => {
    const field = `${fieldName}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${field} must be an object.`);
    }
    return {
      event: requiredString(entry.event, `${field}.event`),
      displayName: parseLocalizableText(entry.displayName, `${field}.displayName`),
    };
  });
}

function parseSkillPresentations(
  value: unknown,
  fieldName: string,
): MarketplaceSkillContributionPresentation[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((entry, index) => {
    const field = `${fieldName}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${field} must be an object.`);
    }
    return {
      name: requiredString(entry.name, `${field}.name`),
      displayName: parseLocalizableText(entry.displayName, `${field}.displayName`),
      summary: parseLocalizableText(entry.summary, `${field}.summary`),
    };
  });
}

function parseRulePresentation(
  value: unknown,
  fieldName: string,
): MarketplaceRuleContributionPresentation {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return {
    displayName: parseLocalizableText(value.displayName, `${fieldName}.displayName`),
    summary: parseLocalizableText(value.summary, `${fieldName}.summary`),
  };
}

/** Shared identity + display + declaration fields (marketplace entry and install dump). */
interface MarketplaceExtensionCoreFields extends ExtensionLocalization {
  name: string;
  version: string;
  icon?: string;
  displayName: LocalizableText;
  description: LocalizableText;
  author?: MarketplaceExtensionAuthor;
  category?: MarketplaceCategory;
  keywords?: LocalizableText[];
  homepage?: string;
  manifest: MarketplaceExtensionManifest;
}

function parseCoreFields(
  value: Record<string, unknown>,
  fieldName: string,
): MarketplaceExtensionCoreFields {
  const name = assertMarketplaceExtensionName(value.name, `${fieldName}.name`);
  const version = requiredString(value.version, `${fieldName}.version`);
  if (!isMarketplaceVersionString(version)) {
    parseMarketplaceVersion(version, `${fieldName}.version`);
  }
  const icon =
    value.icon === undefined
      ? undefined
      : assertMarketplaceIconPath(value.icon, `${fieldName}.icon`);
  const localization = parseExtensionLocalization(value, fieldName);
  const displayName = parseLocalizableText(value.displayName, `${fieldName}.displayName`);
  const description = parseLocalizableText(value.description, `${fieldName}.description`);
  const author =
    value.author === undefined ? undefined : parseOwner(value.author, `${fieldName}.author`);
  const category = optionalString(value.category, `${fieldName}.category`);
  if (category && !(MARKETPLACE_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`${fieldName}.category must be one of: ${MARKETPLACE_CATEGORIES.join(", ")}.`);
  }
  const keywords = Array.isArray(value.keywords)
    ? value.keywords.map((entry, index) =>
        parseLocalizableText(entry, `${fieldName}.keywords[${index}]`),
      )
    : undefined;
  if (value.keywords !== undefined && !Array.isArray(value.keywords)) {
    throw new Error(`${fieldName}.keywords must be an array of message references.`);
  }
  const homepage = optionalString(value.homepage, `${fieldName}.homepage`);
  const manifest = parseManifest(value.manifest, `${fieldName}.manifest`);
  assertManifestPresentationFields(value.manifest, `${fieldName}.manifest`);
  assertExtensionMessageReferences(
    localization,
    { displayName, description, keywords, manifest },
    fieldName,
  );

  return {
    ...localization,
    name,
    version,
    ...(icon ? { icon } : {}),
    displayName,
    description,
    ...(author ? { author } : {}),
    ...(category ? { category: category as MarketplaceCategory } : {}),
    ...(keywords ? { keywords } : {}),
    ...(homepage ? { homepage } : {}),
    manifest,
  };
}

function assertManifestPresentationFields(value: unknown, fieldName: string): void {
  if (!isRecord(value)) {
    return;
  }
  if (isRecord(value.contributes)) {
    const contributes = value.contributes;
    forEachRecord(
      contributes.automationTriggers,
      `${fieldName}.contributes.automationTriggers`,
      (entry, field) => {
        parseLocalizableText(entry.name, `${field}.name`);
        parseLocalizableText(entry.description, `${field}.description`);
      },
    );
    forEachRecord(
      contributes.authorizations,
      `${fieldName}.contributes.authorizations`,
      (entry, field) => {
        parseLocalizableText(entry.displayName, `${field}.displayName`);
      },
    );
    forEachRecord(contributes.tools, `${fieldName}.contributes.tools`, (entry, field) => {
      requiredString(entry.description, `${field}.description`);
      if (!isRecord(entry.presentation)) {
        throw new Error(`${field}.presentation must be an object.`);
      }
      parseLocalizableText(entry.presentation.displayName, `${field}.presentation.displayName`);
      parseLocalizableText(entry.presentation.summary, `${field}.presentation.summary`);
    });
    if (isRecord(contributes.desktop)) {
      const desktop = contributes.desktop;
      forEachRecord(desktop.views, `${fieldName}.contributes.desktop.views`, (entry, field) => {
        if (entry.title !== undefined) {
          parseLocalizableText(entry.title, `${field}.title`);
        }
      });
      forEachRecord(desktop.tabs, `${fieldName}.contributes.desktop.tabs`, (entry, field) => {
        parseLocalizableText(entry.name, `${field}.name`);
        if ("nameKey" in entry) {
          throw new Error(
            `${field}.nameKey is no longer supported; use a message reference in name.`,
          );
        }
      });
      if (isRecord(desktop.settingsPage) && desktop.settingsPage.title !== undefined) {
        parseLocalizableText(
          desktop.settingsPage.title,
          `${fieldName}.contributes.desktop.settingsPage.title`,
        );
      }
    }
  }
  if (Array.isArray(value.settingsSchema)) {
    for (const [index, entry] of value.settingsSchema.entries()) {
      const field = `${fieldName}.settingsSchema[${index}]`;
      if (!isRecord(entry)) {
        continue;
      }
      parseLocalizableText(entry.title, `${field}.title`);
      if (entry.description !== undefined) {
        parseLocalizableText(entry.description, `${field}.description`);
      }
      if (entry.placeholder !== undefined) {
        parseLocalizableText(entry.placeholder, `${field}.placeholder`);
      }
      if (Array.isArray(entry.options)) {
        for (const [optionIndex, option] of entry.options.entries()) {
          if (!isRecord(option)) {
            continue;
          }
          const optionField = `${field}.options[${optionIndex}]`;
          parseLocalizableText(option.label, `${optionField}.label`);
          if (option.description !== undefined) {
            parseLocalizableText(option.description, `${optionField}.description`);
          }
        }
      }
    }
  }
}

function forEachRecord(
  value: unknown,
  fieldName: string,
  visit: (entry: Record<string, unknown>, fieldName: string) => void,
): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (isRecord(entry)) {
      visit(entry, `${fieldName}[${index}]`);
    }
  }
}

function parseEntry(value: unknown, index: number): MarketplaceExtensionEntry {
  const fieldName = `extensions[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const core = parseCoreFields(value, fieldName);
  const resolvedSource = resolveMarketplaceExtensionSource(value.source, `${fieldName}.source`);
  const source: MarketplaceExtensionSource =
    resolvedSource.kind === "local"
      ? resolvedSource.path
      : { source: "npm", package: `${resolvedSource.packageName}@${resolvedSource.version}` };

  const featured = optionalBoolean(value.featured, `${fieldName}.featured`);
  const defaultInstalled = optionalBoolean(value.defaultInstalled, `${fieldName}.defaultInstalled`);

  let reviewStatus: MarketplaceReviewStatus = "unverified";
  if (value.reviewStatus !== undefined) {
    if (
      typeof value.reviewStatus !== "string" ||
      !(MARKETPLACE_REVIEW_STATUSES as readonly string[]).includes(value.reviewStatus)
    ) {
      throw new Error(
        `${fieldName}.reviewStatus must be one of: ${MARKETPLACE_REVIEW_STATUSES.join(", ")}.`,
      );
    }
    reviewStatus = value.reviewStatus as MarketplaceReviewStatus;
  }

  return {
    ...core,
    source,
    ...(featured !== undefined ? { featured } : {}),
    reviewStatus,
    ...(defaultInstalled !== undefined ? { defaultInstalled } : {}),
  };
}

/** Parse and validate a marketplace.json document. Throws with a precise field path. */
export function parseMarketplaceIndex(value: unknown): MarketplaceIndex {
  if (!isRecord(value)) {
    throw new Error("marketplace.json must be an object.");
  }
  if (value.schemaVersion !== MARKETPLACE_SCHEMA_VERSION) {
    throw new Error(
      `marketplace.json schemaVersion must be ${MARKETPLACE_SCHEMA_VERSION}, got: ${String(value.schemaVersion)}`,
    );
  }
  const name = assertMarketplaceExtensionName(value.name, "name");
  const displayName = requiredString(value.displayName, "displayName");
  const description = optionalString(value.description, "description");
  const owner = value.owner === undefined ? undefined : parseOwner(value.owner, "owner");

  if (!Array.isArray(value.extensions)) {
    throw new Error("extensions must be an array.");
  }
  const seenNames = new Set<string>();
  const extensions = value.extensions.map((entry, index) => {
    const parsed = parseEntry(entry, index);
    if (seenNames.has(parsed.name)) {
      throw new Error(`extensions[${index}].name duplicates an earlier entry: ${parsed.name}`);
    }
    seenNames.add(parsed.name);
    return parsed;
  });

  return {
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    name,
    displayName,
    ...(description ? { description } : {}),
    ...(owner ? { owner } : {}),
    extensions,
  };
}

/** Parse marketplace.json from raw text (JSON.parse + validation). */
export function parseMarketplaceIndexText(raw: string): MarketplaceIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("marketplace.json is not valid JSON.");
  }
  return parseMarketplaceIndex(parsed);
}

/**
 * Installed extension dump (`.spirit/extension.json`): the same identity +
 * display + declaration schema as a marketplace entry, plus the owning source
 * id. One manifest schema, three containers (marketplace entry / install dump
 * / ZIP import payload); the dump carries no source backend or curation
 * fields, and its icon path is install-dir-relative.
 */
export interface MarketplaceExtensionDump {
  schemaVersion: number;
  name: string;
  version: string;
  /** Owning marketplace source id. */
  sourceId: string;
  defaultLocale: string;
  messages: Record<string, ExtensionMessageCatalog>;
  displayName: LocalizableText;
  description: LocalizableText;
  icon?: string;
  author?: MarketplaceExtensionAuthor;
  category?: MarketplaceCategory;
  keywords?: LocalizableText[];
  homepage?: string;
  manifest: MarketplaceExtensionManifest;
}

export const EXTENSION_DUMP_SCHEMA_VERSION = 1;

export function parseExtensionDump(value: unknown): MarketplaceExtensionDump {
  if (!isRecord(value)) {
    throw new Error("The extension dump must be an object.");
  }
  if (value.schemaVersion !== EXTENSION_DUMP_SCHEMA_VERSION) {
    throw new Error(
      `The extension dump schemaVersion must be ${EXTENSION_DUMP_SCHEMA_VERSION}, got: ${String(value.schemaVersion)}`,
    );
  }
  const core = parseCoreFields(value, "extension.json");
  const sourceId = requiredString(value.sourceId, "extension.json.sourceId");
  return {
    schemaVersion: EXTENSION_DUMP_SCHEMA_VERSION,
    ...core,
    sourceId,
  };
}

export function parseExtensionDumpText(raw: string): MarketplaceExtensionDump {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The extension .spirit/extension.json is not valid JSON.");
  }
  return parseExtensionDump(parsed);
}
