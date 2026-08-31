import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  HOOK_EVENT_NAMES,
  parseHooksConfigFile,
  parseMcpConfigFile,
  type HookEventName,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type McpConfigFile,
  type McpServerConfig,
  type McpStdioTransportConfig,
  type ResolvedHookDefinition,
} from "@spiritagent/agent-core";

import { validateSkillName } from "./discovery.js";
import {
  EXTENSION_HOOKS_CONFIG_FILE_NAME,
  EXTENSION_MCP_CONFIG_FILE_NAME,
  EXTENSION_RULE_FILE_NAME,
  EXTENSION_SKILLS_DIR_NAME,
  type HostInstalledExtension,
} from "./extensions.js";
import {
  parseSkillFrontmatterFields,
  SKILL_FILE_NAME,
  splitSkillFrontmatter,
} from "./skill-paths.js";
import { stablePathId } from "./storage.js";

export interface HostExtensionContributedSkill {
  id: string;
  extensionId: string;
  extensionName: string;
  scope: "extension";
  name: string;
  description: string;
  path: string;
  content: string;
}

export interface HostExtensionContributedRule {
  id: string;
  extensionId: string;
  extensionName: string;
  scope: "extension";
  title: string;
  path: string;
  content: string;
}

export interface HostExtensionContributedHook extends ResolvedHookDefinition {
  event: HookEventName;
  extensionId: string;
}

export interface HostExtensionInstructionContributions {
  mcp: McpConfigFile;
  hooks: HostExtensionContributedHook[];
  skills: HostExtensionContributedSkill[];
  rules: HostExtensionContributedRule[];
}

export async function collectEnabledExtensionInstructionContributions(
  extensions: readonly HostInstalledExtension[],
  log?: (message: string) => void,
): Promise<HostExtensionInstructionContributions> {
  const mcp: McpConfigFile = { servers: {} };
  const hooks: HostExtensionContributedHook[] = [];
  const skills: HostExtensionContributedSkill[] = [];
  const rules: HostExtensionContributedRule[] = [];
  const skillNames = new Set<string>();

  const ordered = [...extensions]
    .filter((extension) => extension.enabled)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  for (const extension of ordered) {
    if (isDeclaredInstructionContribution(extension, "mcp")) {
      await collectExtensionMcpContribution(extension, mcp, log);
    }
    if (isDeclaredInstructionContribution(extension, "hooks")) {
      await collectExtensionHooksContribution(extension, hooks, log);
    }
    if (isDeclaredInstructionContribution(extension, "skills")) {
      await collectExtensionSkillsContribution(extension, skills, skillNames, log);
    }
    if (isDeclaredInstructionContribution(extension, "rules")) {
      await collectExtensionRulesContribution(extension, rules, log);
    }
  }

  return { mcp, hooks, skills, rules };
}

export interface HostExtensionMcpContributionSummary {
  name: string;
  transport: "stdio" | "http";
}

export interface HostExtensionInstructionContributionSummary {
  mcp?: HostExtensionMcpContributionSummary[];
  hooks?: HookEventName[];
  skills?: string[];
  rules?: boolean;
}

/** Per-extension contribution-point summary for the extension surface (告知权). Disabled packages still summarize. */
export async function summarizeDeclaredExtensionContributionPoints(
  extension: HostInstalledExtension,
  log?: (message: string) => void,
): Promise<HostExtensionInstructionContributionSummary | undefined> {
  const summary: HostExtensionInstructionContributionSummary = {};

  if (isDeclaredInstructionContribution(extension, "mcp")) {
    const mcp: McpConfigFile = { servers: {} };
    await collectExtensionMcpContribution(extension, mcp, log);
    summary.mcp = Object.entries(mcp.servers).map(([name, server]) => ({
      name,
      transport: server.transport.type,
    }));
  }
  if (isDeclaredInstructionContribution(extension, "hooks")) {
    const hooks: HostExtensionContributedHook[] = [];
    await collectExtensionHooksContribution(extension, hooks, log);
    summary.hooks = HOOK_EVENT_NAMES.filter((event) => hooks.some((hook) => hook.event === event));
  }
  if (isDeclaredInstructionContribution(extension, "skills")) {
    const skills: HostExtensionContributedSkill[] = [];
    await collectExtensionSkillsContribution(extension, skills, new Set(), log);
    summary.skills = skills.map((skill) => skill.name);
  }
  if (isDeclaredInstructionContribution(extension, "rules")) {
    const rules: HostExtensionContributedRule[] = [];
    await collectExtensionRulesContribution(extension, rules, log);
    summary.rules = rules.length > 0;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function isDeclaredInstructionContribution(
  extension: HostInstalledExtension,
  key: "mcp" | "hooks" | "skills" | "rules",
): boolean {
  return (
    extension.manifest.contributes?.[key] === true &&
    extension.manifest.requestedCapabilities?.includes(key) === true
  );
}

async function collectExtensionMcpContribution(
  extension: HostInstalledExtension,
  merged: McpConfigFile,
  log?: (message: string) => void,
): Promise<void> {
  const configPath = path.join(extension.directoryPath, EXTENSION_MCP_CONFIG_FILE_NAME);
  let parsed: McpConfigFile;
  try {
    const raw = await readFile(configPath, "utf8");
    parsed = parseMcpConfigFile(JSON.parse(raw) as unknown);
  } catch (error) {
    log?.(
      `[extensions] skipped invalid ${EXTENSION_MCP_CONFIG_FILE_NAME} extension=${extension.id} path=${configPath} error=${describeError(error)}`,
    );
    return;
  }

  for (const [name, server] of Object.entries(parsed.servers)) {
    if (name in merged.servers) {
      log?.(`[extensions] shadowed mcp server name=${name} kept=existing ignored=${extension.id}`);
      continue;
    }
    try {
      merged.servers[name] = rewriteExtensionMcpServer(server, extension.directoryPath);
    } catch (error) {
      log?.(
        `[extensions] skipped mcp server name=${name} extension=${extension.id} error=${describeError(error)}`,
      );
    }
  }
}

function rewriteExtensionMcpServer(
  server: McpServerConfig,
  extensionRoot: string,
): McpServerConfig {
  if (server.transport.type !== "stdio") {
    return server;
  }

  const transport: McpStdioTransportConfig = {
    ...server.transport,
    command: resolveExtensionStdioCommand(extensionRoot, server.transport.command),
    cwd: resolveExtensionStdioCwd(extensionRoot, server.transport.cwd),
  };
  return { ...server, transport };
}

function resolveExtensionStdioCommand(extensionRoot: string, command: string): string {
  const trimmed = command.trim();
  if (!trimmed.includes("/") && !trimmed.includes("\\")) {
    return trimmed;
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolveInsideExtensionRoot(extensionRoot, trimmed);
}

function resolveExtensionStdioCwd(extensionRoot: string, cwd: string | undefined): string {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed) {
    return path.resolve(extensionRoot);
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolveInsideExtensionRoot(extensionRoot, trimmed);
}

function resolveInsideExtensionRoot(extensionRoot: string, relativePath: string): string {
  const configRoot = path.resolve(extensionRoot);
  const resolved = path.resolve(configRoot, relativePath);
  const relative = path.relative(configRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes extension directory: ${relativePath}`);
  }
  return resolved;
}

async function collectExtensionHooksContribution(
  extension: HostInstalledExtension,
  collected: HostExtensionContributedHook[],
  log?: (message: string) => void,
): Promise<void> {
  const configPath = path.join(extension.directoryPath, EXTENSION_HOOKS_CONFIG_FILE_NAME);
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseHooksConfigFile(JSON.parse(raw) as unknown);
    const configDir = path.resolve(extension.directoryPath);
    for (const event of HOOK_EVENT_NAMES) {
      for (const entry of parsed.hooks[event] ?? []) {
        collected.push({
          ...entry,
          event,
          extensionId: extension.id,
          scope: "extension",
          configDir,
          timeout:
            entry.timeout !== undefined && entry.timeout > 0
              ? entry.timeout
              : DEFAULT_HOOK_TIMEOUT_SECONDS,
        });
      }
    }
  } catch (error) {
    log?.(
      `[extensions] skipped invalid ${EXTENSION_HOOKS_CONFIG_FILE_NAME} extension=${extension.id} path=${configPath} error=${describeError(error)}`,
    );
  }
}

async function collectExtensionSkillsContribution(
  extension: HostInstalledExtension,
  collected: HostExtensionContributedSkill[],
  claimedNames: Set<string>,
  log?: (message: string) => void,
): Promise<void> {
  const skillsRoot = path.join(extension.directoryPath, EXTENSION_SKILLS_DIR_NAME);
  if (!existsSync(skillsRoot)) {
    log?.(
      `[extensions] skipped missing ${EXTENSION_SKILLS_DIR_NAME} directory extension=${extension.id}`,
    );
    return;
  }

  let directoryEntries;
  try {
    directoryEntries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    log?.(
      `[extensions] skipped unreadable ${EXTENSION_SKILLS_DIR_NAME} directory extension=${extension.id} error=${describeError(error)}`,
    );
    return;
  }

  const skillDirs = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  for (const skillDir of skillDirs) {
    const skillPath = path.join(skillDir, SKILL_FILE_NAME);
    const parsed = await parseExtensionSkillDocument(skillPath, path.basename(skillDir), log);
    if (!parsed) {
      continue;
    }
    if (claimedNames.has(parsed.name)) {
      log?.(`[extensions] shadowed skill name=${parsed.name} kept=existing ignored=${skillPath}`);
      continue;
    }
    claimedNames.add(parsed.name);
    collected.push({
      id: await stablePathId(skillPath),
      extensionId: extension.id,
      extensionName: extension.manifest.name,
      scope: "extension",
      name: parsed.name,
      description: parsed.description,
      path: skillPath,
      content: parsed.body,
    });
  }
}

async function parseExtensionSkillDocument(
  filePath: string,
  directoryName: string,
  log?: (message: string) => void,
): Promise<{ name: string; description: string; body: string } | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    log?.(`[extensions] skipped unreadable skill path=${filePath} error=${describeError(error)}`);
    return undefined;
  }
  const split = splitSkillFrontmatter(raw);
  if (!split) {
    log?.(`[extensions] skipped missing skill frontmatter path=${filePath}`);
    return undefined;
  }
  const parsed = parseSkillFrontmatterFields(split.frontmatter);
  const name = parsed.name?.trim();
  const description = parsed.description?.trim();
  if (!name || !description) {
    log?.(`[extensions] skipped incomplete skill frontmatter path=${filePath}`);
    return undefined;
  }
  if (validateSkillName(name) !== undefined || directoryName !== name) {
    log?.(`[extensions] skipped non-conforming skill path=${filePath} name=${name}`);
    return undefined;
  }
  return { name, description, body: split.body.trim() };
}

async function collectExtensionRulesContribution(
  extension: HostInstalledExtension,
  collected: HostExtensionContributedRule[],
  log?: (message: string) => void,
): Promise<void> {
  const rulePath = path.join(extension.directoryPath, EXTENSION_RULE_FILE_NAME);
  try {
    const content = await readFile(rulePath, "utf8");
    if (!content.trim()) {
      log?.(
        `[extensions] skipped empty ${EXTENSION_RULE_FILE_NAME} extension=${extension.id} path=${rulePath}`,
      );
      return;
    }
    collected.push({
      id: await stablePathId(rulePath),
      extensionId: extension.id,
      extensionName: extension.manifest.name,
      scope: "extension",
      title: `Extension ${extension.manifest.name} rules`,
      path: rulePath,
      content,
    });
  } catch (error) {
    log?.(
      `[extensions] skipped unreadable ${EXTENSION_RULE_FILE_NAME} extension=${extension.id} path=${rulePath} error=${describeError(error)}`,
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function overlayEnabledExtensionRulesAndSkills(
  extensions: readonly HostInstalledExtension[],
  existingRules: readonly LlmEnabledRule[],
  existingSkills: readonly LlmEnabledSkillCatalogEntry[],
  log?: (message: string) => void,
): Promise<{
  rules: LlmEnabledRule[];
  skills: LlmEnabledSkillCatalogEntry[];
}> {
  const contributions = await collectEnabledExtensionInstructionContributions(extensions, log);
  return overlayExtensionRulesAndSkills(existingRules, existingSkills, contributions, log);
}

export function overlayExtensionRulesAndSkills(
  existingRules: readonly LlmEnabledRule[],
  existingSkills: readonly LlmEnabledSkillCatalogEntry[],
  contributions: HostExtensionInstructionContributions,
  log?: (message: string) => void,
): {
  rules: LlmEnabledRule[];
  skills: LlmEnabledSkillCatalogEntry[];
} {
  const claimedSkillNames = new Set(existingSkills.map((skill) => skill.name));
  const overlaySkills: LlmEnabledSkillCatalogEntry[] = [];
  for (const skill of contributions.skills) {
    if (claimedSkillNames.has(skill.name)) {
      log?.(`[extensions] shadowed skill name=${skill.name} kept=existing ignored=${skill.path}`);
      continue;
    }
    claimedSkillNames.add(skill.name);
    overlaySkills.push({
      id: skill.id,
      scope: "extension",
      name: skill.name,
      description: skill.description,
      path: skill.path,
    });
  }

  return {
    rules: [
      ...existingRules,
      ...contributions.rules.map((rule) => ({
        id: rule.id,
        scope: "extension" as const,
        title: rule.title,
        path: rule.path,
        content: rule.content,
      })),
    ],
    skills: [...existingSkills, ...overlaySkills],
  };
}
