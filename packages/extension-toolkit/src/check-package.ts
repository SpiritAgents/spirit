/**
 * `extension-toolkit check <dir>`: validate an extension package directory (or
 * an installed extension directory carrying `.spirit/extension.json`).
 *
 * A bare package ships no manifest — the declaration lives in the registry
 * entry — so package mode validates everything that is present. Dump mode has
 * the declaration and runs the full declared-vs-content check.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  parseHooksConfigFile,
  parseMcpConfigFile,
} from "@spiritagent/agent-core/extension-config-files";

import {
  EXTENSION_SKILLS_DIR_NAME,
  assertDeclaredInstructionContributionFiles,
  isValidDeclaredSkillMarkdown,
  type MarketplaceInstructionContributionDeclarations,
} from "./contribution-files.js";
import { assertMarketplaceIconSvgContent } from "./icon.js";
import {
  EXTENSION_DUMP_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  assertMarketplaceExtensionName,
  parseExtensionDumpText,
} from "./schema.js";
import { isMarketplaceVersionString } from "./semver.js";
import { SKILL_FILE_NAME } from "./skill-format.js";

export interface CheckFinding {
  /** File path (relative to the checked directory) or field path. */
  path: string;
  message: string;
}

async function readTextIfExists(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

async function listChildDirectories(absolutePath: string): Promise<string[] | undefined> {
  try {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Run `check` and turn a thrown error into a finding; returns undefined when clean. */
function capture(pathLabel: string, check: () => void): CheckFinding | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    return {
      path: pathLabel,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkJsonConfigFile(
  dir: string,
  fileName: string,
  validate: (parsed: unknown) => void,
): Promise<CheckFinding | undefined> {
  const raw = await readTextIfExists(path.join(dir, fileName));
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { path: fileName, message: `The extension ${fileName} is not valid JSON.` };
  }
  return capture(fileName, () => validate(parsed));
}

async function checkSkillDirectories(dir: string): Promise<CheckFinding[]> {
  const skillsDir = path.join(dir, EXTENSION_SKILLS_DIR_NAME);
  const skillDirs = await listChildDirectories(skillsDir);
  if (skillDirs === undefined) {
    return [];
  }
  const findings: CheckFinding[] = [];
  for (const skillDir of skillDirs) {
    const relativePath = `${EXTENSION_SKILLS_DIR_NAME}/${skillDir}/${SKILL_FILE_NAME}`;
    const raw = await readTextIfExists(path.join(skillsDir, skillDir, SKILL_FILE_NAME));
    if (raw === undefined) {
      findings.push({ path: relativePath, message: "The skill file does not exist." });
      continue;
    }
    if (!isValidDeclaredSkillMarkdown(raw, skillDir)) {
      findings.push({
        path: relativePath,
        message:
          "The skill file needs frontmatter with a name matching its directory and a description.",
      });
    }
  }
  return findings;
}

async function checkIconFile(dir: string, relativePath: string): Promise<CheckFinding | undefined> {
  const raw = await readTextIfExists(path.join(dir, ...relativePath.split("/")));
  if (raw === undefined) {
    return { path: relativePath, message: "The icon file does not exist." };
  }
  return capture(relativePath, () =>
    assertMarketplaceIconSvgContent(raw, relativePath),
  );
}

/**
 * Declared-vs-content check with fs readers rooted at `dir`. Shared by the
 * package command (dump mode) and the marketplace command (per local entry);
 * not part of the library's public API.
 */
export async function checkDeclaredContributions(
  dir: string,
  contributes: MarketplaceInstructionContributionDeclarations | undefined,
  fieldPath = "manifest.contributes",
): Promise<CheckFinding[]> {
  const finding = await assertDeclaredInstructionContributionFiles(contributes, {
    readRelativeTextFile: async (relativePath, fieldName) => {
      try {
        return await readFile(path.join(dir, ...relativePath.split("/")), "utf8");
      } catch {
        throw new Error(`The file referenced by ${fieldName} does not exist: ${relativePath}`);
      }
    },
    listRelativeChildDirectories: async (relativePath) =>
      (await listChildDirectories(path.join(dir, ...relativePath.split("/")))) ?? [],
    validators: { parseMcpConfigFile, parseHooksConfigFile },
    fieldPrefix: fieldPath,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  return finding
    ? [
        {
          path: fieldPath,
          message: finding instanceof Error ? finding.message : String(finding),
        },
      ]
    : [];
}

export async function checkExtensionPackage(dir: string): Promise<CheckFinding[]> {
  const dumpPath = path.join(dir, MARKETPLACE_SPIRIT_DIR_NAME, EXTENSION_DUMP_FILE_NAME);
  const dumpRaw = await readTextIfExists(dumpPath);
  if (dumpRaw !== undefined) {
    return checkInstalledExtension(dir, dumpRaw);
  }
  return checkBarePackage(dir);
}

/** Dump mode: an installed extension directory with `.spirit/extension.json`. */
async function checkInstalledExtension(dir: string, dumpRaw: string): Promise<CheckFinding[]> {
  const dumpRelativePath = `${MARKETPLACE_SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}`;
  let dump;
  try {
    dump = parseExtensionDumpText(dumpRaw);
  } catch (error) {
    return [
      { path: dumpRelativePath, message: error instanceof Error ? error.message : String(error) },
    ];
  }
  const findings = await checkDeclaredContributions(dir, dump.manifest.contributes);
  if (dump.icon) {
    const iconFinding = await checkIconFile(dir, dump.icon);
    if (iconFinding) {
      findings.push(iconFinding);
    }
  }
  return findings;
}

/** Package mode: a bare extension package; validate everything that exists. */
async function checkBarePackage(dir: string): Promise<CheckFinding[]> {
  const findings: CheckFinding[] = [];

  const packageJsonRaw = await readTextIfExists(path.join(dir, "package.json"));
  if (packageJsonRaw === undefined) {
    findings.push({
      path: "package.json",
      message: "The extension package has no package.json.",
    });
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(packageJsonRaw);
    } catch {
      findings.push({ path: "package.json", message: "package.json is not valid JSON." });
    }
    if (isRecord(parsed)) {
      const nameFinding = capture("package.json", () =>
        assertMarketplaceExtensionName(parsed.name, "package.json name"),
      );
      if (nameFinding) {
        findings.push(nameFinding);
      }
      if (
        typeof parsed.version !== "string" ||
        !isMarketplaceVersionString(parsed.version)
      ) {
        findings.push({
          path: "package.json",
          message: `package.json version must be a strict "major.minor.patch" semver, got: ${String(parsed.version)}`,
        });
      }
    }
  }

  findings.push(...(await checkSkillDirectories(dir)));

  const ruleRaw = await readTextIfExists(path.join(dir, "rule.md"));
  if (ruleRaw !== undefined && !ruleRaw.trim()) {
    findings.push({ path: "rule.md", message: "The extension rule.md must not be empty." });
  }

  for (const configFile of ["mcp.json", "hooks.json"] as const) {
    const finding = await checkJsonConfigFile(
      dir,
      configFile,
      configFile === "mcp.json" ? parseMcpConfigFile : parseHooksConfigFile,
    );
    if (finding) {
      findings.push(finding);
    }
  }

  // A bare package has no manifest pointing at an icon; validate the
  // conventional root icon.svg when present.
  const iconRaw = await readTextIfExists(path.join(dir, "icon.svg"));
  if (iconRaw !== undefined) {
    const finding = capture("icon.svg", () =>
      assertMarketplaceIconSvgContent(iconRaw, "icon.svg"),
    );
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}
