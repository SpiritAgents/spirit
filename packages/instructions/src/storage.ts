import { realpath } from "node:fs/promises";
import path from "node:path";
import { product } from "@spiritagent/product";

import { SKILLS_DIR_NAME } from "./skill-paths.js";

export { SKILL_FILE_NAME, SKILLS_DIR_NAME } from "./skill-paths.js";
export {
  loadToggleState,
  saveToggleState,
  type HostToggleState,
} from "@spiritagent/config/toggle-state";

export const SPIRIT_DIR_NAME = product.workspaceDataFolderName;
export const AGENTS_DIR_NAME = ".agents";
export const USER_RULE_FILE_NAME = "rule.md";
export const WORKSPACE_RULE_FILE_NAME = "AGENTS.md";
export const WORKSPACE_SPIRIT_RULE_FILE_NAME = path.join(SPIRIT_DIR_NAME, "rule.md");
export const WORKSPACE_SPIRIT_SKILLS_DIR = path.join(SPIRIT_DIR_NAME, SKILLS_DIR_NAME);
export const WORKSPACE_SPIRIT_MCP_CONFIG = path.join(SPIRIT_DIR_NAME, "mcp.json");
export const WORKSPACE_AGENTS_SKILLS_DIR = path.join(AGENTS_DIR_NAME, SKILLS_DIR_NAME);
export const PLANS_DIR_NAME = "plans";
export const RULES_STATE_FILE_NAME = "rules-state.json";
export const SKILLS_STATE_FILE_NAME = "skills-state.json";

export interface InstructionDiscoveryContext {
  workspaceRoot: string;
  spiritDataDir: string;
  includeWorkspaceScope?: boolean;
}

export interface InstructionPaths {
  workspaceSpiritRuleFile: string;
  workspaceAgentsRuleFile: string;
  userRuleFile: string;
  workspaceSpiritSkillsDir: string;
  workspaceAgentsSkillsDir: string;
  userSkillsDir: string;
  rulesStateFile: string;
  skillsStateFile: string;
  plansDir: string;
}

export function resolveInstructionPaths(context: InstructionDiscoveryContext): InstructionPaths {
  return {
    workspaceSpiritRuleFile: path.join(context.workspaceRoot, WORKSPACE_SPIRIT_RULE_FILE_NAME),
    workspaceAgentsRuleFile: path.join(context.workspaceRoot, WORKSPACE_RULE_FILE_NAME),
    userRuleFile: path.join(context.spiritDataDir, USER_RULE_FILE_NAME),
    workspaceSpiritSkillsDir: path.join(context.workspaceRoot, WORKSPACE_SPIRIT_SKILLS_DIR),
    workspaceAgentsSkillsDir: path.join(context.workspaceRoot, WORKSPACE_AGENTS_SKILLS_DIR),
    userSkillsDir: path.join(context.spiritDataDir, SKILLS_DIR_NAME),
    rulesStateFile: path.join(context.spiritDataDir, RULES_STATE_FILE_NAME),
    skillsStateFile: path.join(context.spiritDataDir, SKILLS_STATE_FILE_NAME),
    plansDir: path.join(context.spiritDataDir, PLANS_DIR_NAME),
  };
}

export async function stablePathId(filePath: string): Promise<string> {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  try {
    return normalizePath(await realpath(absolute));
  } catch {
    return normalizePath(absolute);
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}
