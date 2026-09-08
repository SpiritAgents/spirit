#!/usr/bin/env node
/**
 * The Desktop renderer may only import from host-internal's renderer-safe subpaths.
 * The main entry @spiritagent/host-internal pulls in the extensions / node:fs dependency chain (including import type).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const desktopSrc = join(repoRoot, "apps", "desktop", "src");

/** host-internal subpaths allowed for value import (no node dependencies). */
const RENDERER_SAFE_HOST_INTERNAL_SUBPATHS = new Set([
  "config-v2",
  "workspace-file-reference-query",
  "model-provider-presets",
  "id-display-title",
  "well-known-casing",
  "openai-api-base",
  "azure-resource",
  "bedrock-region",
  "bedrock-mantle",
  "cloudflare-ai-gateway-resource",
  "google-vertex-endpoints",
  "skill-paths",
  "tool-output-archive-path",
  "github-pull-request-url",
  "github-pull-request-checks-pages",
  "github-pull-request-conversation-pages",
  "github/types",
  "approval-level",
  "work-location",
  "local-file-composer-route",
  "image-file-support",
]);

const RENDERER_EXCLUDED_PREFIXES = [join(desktopSrc, "host")];

function isRendererExcluded(filePath) {
  return RENDERER_EXCLUDED_PREFIXES.some(
    (prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`),
  );
}

function collectSourceFiles(entryPath) {
  const stat = statSync(entryPath);
  if (stat.isFile() && /\.(tsx?|mts|d\.ts)$/u.test(entryPath)) {
    return [entryPath];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(entryPath)) {
    const childPath = join(entryPath, name);
    if (
      RENDERER_EXCLUDED_PREFIXES.some(
        (prefix) => childPath === prefix || childPath.startsWith(`${prefix}/`),
      )
    ) {
      continue;
    }
    files.push(...collectSourceFiles(childPath));
  }
  return files;
}

function scanHostStorageImports(filePath, content) {
  const violations = [];
  if (isRendererExcluded(filePath)) {
    return violations;
  }
  const hostImports = content.matchAll(
    /from\s+['"](?:@\/host\/|\.\.\/host\/|\.\/host\/)[^'"]*['"]/gu,
  );
  for (const match of hostImports) {
    const line = content.slice(0, match.index).split(/\r?\n/u).length;
    violations.push({
      file: relative(repoRoot, filePath),
      line,
      reason:
        "renderer must not import apps/desktop/src/host (pulls in the host-internal main entry)",
    });
  }
  return violations;
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const violations = [];

  const importBlocks = content.matchAll(
    /import\s+(?:type\s+)?(?:(?!;|\n\s*import)[\s\S])*?from\s+['"]@spiritagent\/host-internal(?:\/([^'"]+))?['"]/gu,
  );

  for (const match of importBlocks) {
    const line = content.slice(0, match.index).split(/\r?\n/u).length;
    const subpath = match[1];
    if (!subpath) {
      violations.push({
        file: relative(repoRoot, filePath),
        line,
        reason:
          "importing from the @spiritagent/host-internal main entry is not allowed (including import type)",
      });
      continue;
    }
    const importStatement = match[0];
    if (/^\s*import\s+type\s+/u.test(importStatement.trimStart())) {
      continue;
    }
    if (!RENDERER_SAFE_HOST_INTERNAL_SUBPATHS.has(subpath)) {
      violations.push({
        file: relative(repoRoot, filePath),
        line,
        reason: `subpath "${subpath}" is not in the renderer-safe allowlist`,
      });
    }
  }

  const inlineTypeImports = content.matchAll(
    /import\(['"]@spiritagent\/host-internal(?:\/([^'"]+))?['"]\)/gu,
  );
  for (const match of inlineTypeImports) {
    const line = content.slice(0, match.index).split(/\r?\n/u).length;
    const subpath = match[1];
    if (!subpath) {
      violations.push({
        file: relative(repoRoot, filePath),
        line,
        reason: 'inline import("@spiritagent/host-internal") of the main entry is not allowed',
      });
      continue;
    }
    if (!RENDERER_SAFE_HOST_INTERNAL_SUBPATHS.has(subpath)) {
      violations.push({
        file: relative(repoRoot, filePath),
        line,
        reason: `inline import subpath "${subpath}" is not in the renderer-safe allowlist`,
      });
    }
  }

  violations.push(...scanHostStorageImports(filePath, content));

  return violations;
}

const files = collectSourceFiles(desktopSrc);

const violations = files.flatMap(scanFile);

if (violations.length > 0) {
  console.error("renderer host-internal import check failed:\n");
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line} — ${item.reason}`);
  }
  process.exit(1);
}

console.log("renderer host-internal import check passed");
