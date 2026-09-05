import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  MARKETPLACE_INDEX_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
} from "@spiritagent/extension-toolkit";

import type { MarketplaceSourceKind } from "./types.js";

export interface ClassifiedMarketplaceLocator {
  kind: MarketplaceSourceKind;
  /**
   * Normalized locator stored in the registry:
   * - local: absolute path of the registry root directory
   * - git: clone URL as given (trailing slashes stripped)
   * - http-index: full marketplace.json URL (auto-completed when missing)
   */
  locator: string;
}

export interface ClassifyMarketplaceLocatorOptions {
  pathExists?: (candidate: string) => boolean;
  pathIsFile?: (candidate: string) => boolean;
  /** Base for resolving relative local paths; defaults to process.cwd(). */
  cwd?: string;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isGitLocator(input: string): boolean {
  return (
    input.includes("/_git/") ||
    input.endsWith(".git") ||
    input.startsWith("git@") ||
    input.startsWith("ssh://")
  );
}

function isHttpUrl(input: string): boolean {
  return input.startsWith("https://") || input.startsWith("http://");
}

function looksLikeUrl(input: string): boolean {
  return isHttpUrl(input) || input.startsWith("ssh://") || input.startsWith("git@");
}

/**
 * Deterministic source classification (spec: 源管理协议):
 * existing local path → local; `/_git/` / `.git` suffix / `git@` / `ssh://`
 * → git; any other http(s) URL → index direct-link (auto-completes
 * `/.spirit/marketplace.json`); anything else is an error.
 *
 * Git detection deliberately has no shorthand: `octocat/Hello-World` or
 * `https://github.com/octocat/Hello-World` (no `.git`) are treated as index
 * direct-links and fail at fetch time, so the rules never conflict.
 */
export function classifyMarketplaceLocator(
  input: string,
  options?: ClassifyMarketplaceLocatorOptions,
): ClassifiedMarketplaceLocator {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Marketplace source locator must not be empty.");
  }

  const pathExists = options?.pathExists ?? ((candidate: string) => existsSync(candidate));
  const pathIsFile = options?.pathIsFile ?? ((candidate: string) => statSync(candidate).isFile());
  const cwd = options?.cwd ?? process.cwd();

  if (!looksLikeUrl(trimmed)) {
    const absolute = path.resolve(cwd, trimmed);
    if (pathExists(absolute)) {
      return { kind: "local", locator: normalizeLocalRegistryRoot(absolute, pathIsFile) };
    }
  }

  if (isGitLocator(trimmed)) {
    return { kind: "git", locator: stripTrailingSlashes(trimmed) };
  }

  if (isHttpUrl(trimmed)) {
    const base = stripTrailingSlashes(trimmed);
    const indexUrl = base.endsWith(".json")
      ? base
      : `${base}/${MARKETPLACE_SPIRIT_DIR_NAME}/${MARKETPLACE_INDEX_FILE_NAME}`;
    return { kind: "http-index", locator: indexUrl };
  }

  throw new Error(
    `Unrecognized marketplace source locator: ${input}. Expected an existing local directory, a git URL (…​.git, git@…, ssh://…, or an Azure DevOps /_git/ URL), or an http(s) URL.`,
  );
}

/**
 * A local locator may point at the marketplace directory (containing
 * `.spirit/marketplace.json`) or directly at the marketplace.json file;
 * both normalize to the registry root directory.
 */
function normalizeLocalRegistryRoot(
  absolute: string,
  pathIsFile: (candidate: string) => boolean,
): string {
  if (!pathIsFile(absolute)) {
    return absolute;
  }
  if (path.basename(absolute) !== MARKETPLACE_INDEX_FILE_NAME) {
    throw new Error(
      `Local marketplace file must be named ${MARKETPLACE_INDEX_FILE_NAME}: ${absolute}`,
    );
  }
  const spiritDir = path.dirname(absolute);
  if (path.basename(spiritDir) !== MARKETPLACE_SPIRIT_DIR_NAME) {
    throw new Error(
      `Local ${MARKETPLACE_INDEX_FILE_NAME} must live inside a ${MARKETPLACE_SPIRIT_DIR_NAME}/ directory: ${absolute}`,
    );
  }
  return path.dirname(spiritDir);
}
