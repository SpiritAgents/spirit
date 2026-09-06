/**
 * Declaration-vs-content validation: a manifest that declares mcp / hooks /
 * skills / rules contributions must ship the corresponding files in the
 * package. This is the registry-CI home of the check that the host also runs
 * at install time.
 *
 * The MCP / hooks config schemas are owned by the agent runtime; callers
 * inject those parsers so this package stays free of that dependency and the
 * semantics never drift between registry CI and the host.
 */

import {
  SKILL_FILE_NAME,
  SKILLS_DIR_NAME,
  parseSkillFrontmatterFields,
  splitSkillFrontmatter,
  validateSkillName,
} from "./skill-format.js";

/** Extension package layout contract: declared files live at these paths. */
export const EXTENSION_MCP_CONFIG_FILE_NAME = "mcp.json";
export const EXTENSION_HOOKS_CONFIG_FILE_NAME = "hooks.json";
export const EXTENSION_RULE_FILE_NAME = "rule.md";
export const EXTENSION_SKILLS_DIR_NAME = SKILLS_DIR_NAME;

export interface MarketplaceInstructionContributionDeclarations {
  mcp?: true;
  hooks?: true;
  skills?: true;
  rules?: true;
}

export interface MarketplaceContributionFileReaders {
  readRelativeTextFile?(relativePath: string, fieldName: string): Promise<string>;
  listRelativeChildDirectories?(relativePath: string): Promise<string[]>;
}

export interface MarketplaceContributionContentValidators {
  /** Throws when the parsed mcp.json content is invalid. */
  parseMcpConfigFile(parsed: unknown): void;
  /** Throws when the parsed hooks.json content is invalid. */
  parseHooksConfigFile(parsed: unknown): void;
}

export interface AssertDeclaredInstructionContributionFilesOptions extends MarketplaceContributionFileReaders {
  validators: MarketplaceContributionContentValidators;
  /** Error message prefix, e.g. "manifest.contributes" (default). */
  fieldPrefix?: string;
}

export async function assertDeclaredInstructionContributionFiles(
  contributes: MarketplaceInstructionContributionDeclarations | undefined,
  options: AssertDeclaredInstructionContributionFilesOptions,
): Promise<void> {
  if (!contributes?.mcp && !contributes?.hooks && !contributes?.skills && !contributes?.rules) {
    return;
  }

  const readRelativeTextFile = options.readRelativeTextFile;
  if (!readRelativeTextFile) {
    throw new Error(
      "The current context cannot read extension contribution files from the package root.",
    );
  }
  const fieldPrefix = options.fieldPrefix ?? "manifest.contributes";

  if (contributes.mcp === true) {
    await assertDeclaredJsonContributionFile(
      readRelativeTextFile,
      EXTENSION_MCP_CONFIG_FILE_NAME,
      `${fieldPrefix}.mcp`,
      options.validators.parseMcpConfigFile,
    );
  }
  if (contributes.hooks === true) {
    await assertDeclaredJsonContributionFile(
      readRelativeTextFile,
      EXTENSION_HOOKS_CONFIG_FILE_NAME,
      `${fieldPrefix}.hooks`,
      options.validators.parseHooksConfigFile,
    );
  }
  if (contributes.rules === true) {
    await assertDeclaredRulesContributionFile(readRelativeTextFile, `${fieldPrefix}.rules`);
  }
  if (contributes.skills === true) {
    await assertDeclaredSkillsContributionFiles(options, fieldPrefix);
  }
}

async function assertDeclaredJsonContributionFile(
  readRelativeTextFile: NonNullable<MarketplaceContributionFileReaders["readRelativeTextFile"]>,
  fileName: string,
  fieldName: string,
  validate: (parsed: unknown) => void,
): Promise<void> {
  const raw = await readRelativeTextFile(fileName, fieldName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The extension ${fileName} is not valid JSON.`);
  }
  try {
    validate(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The extension ${fileName} is invalid: ${detail}`);
  }
}

async function assertDeclaredRulesContributionFile(
  readRelativeTextFile: NonNullable<MarketplaceContributionFileReaders["readRelativeTextFile"]>,
  fieldName: string,
): Promise<void> {
  const raw = await readRelativeTextFile(EXTENSION_RULE_FILE_NAME, fieldName);
  if (!raw.trim()) {
    throw new Error(`The extension ${EXTENSION_RULE_FILE_NAME} must not be empty.`);
  }
}

async function assertDeclaredSkillsContributionFiles(
  options: AssertDeclaredInstructionContributionFilesOptions,
  fieldPrefix: string,
): Promise<void> {
  const readRelativeTextFile = options.readRelativeTextFile;
  const listRelativeChildDirectories = options.listRelativeChildDirectories;
  if (!readRelativeTextFile || !listRelativeChildDirectories) {
    throw new Error(
      "The current context cannot list extension skill directories from the package root.",
    );
  }

  const skillDirectories = await listRelativeChildDirectories(EXTENSION_SKILLS_DIR_NAME);
  const validSkills: string[] = [];
  for (const directoryName of skillDirectories) {
    const relativePath = `${EXTENSION_SKILLS_DIR_NAME}/${directoryName}/${SKILL_FILE_NAME}`;
    let raw: string;
    try {
      raw = await readRelativeTextFile(relativePath, `${fieldPrefix}.skills`);
    } catch {
      continue;
    }
    if (isValidDeclaredSkillMarkdown(raw, directoryName)) {
      validSkills.push(directoryName);
    }
  }

  if (validSkills.length === 0) {
    throw new Error(
      `The extension declares ${fieldPrefix}.skills but has no valid ${EXTENSION_SKILLS_DIR_NAME}/*/${SKILL_FILE_NAME}.`,
    );
  }
}

export function isValidDeclaredSkillMarkdown(raw: string, directoryName: string): boolean {
  const split = splitSkillFrontmatter(raw);
  if (!split) {
    return false;
  }
  const parsed = parseSkillFrontmatterFields(split.frontmatter);
  const name = parsed.name?.trim();
  const description = parsed.description?.trim();
  if (!name || !description) {
    return false;
  }
  if (validateSkillName(name) !== undefined) {
    return false;
  }
  return directoryName === name;
}
