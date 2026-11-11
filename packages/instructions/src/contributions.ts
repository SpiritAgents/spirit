import type { LlmEnabledRule, LlmEnabledSkillCatalogEntry } from "@spiritagent/agent-core";

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

export function overlayExtensionRulesAndSkills(
  existingRules: readonly LlmEnabledRule[],
  existingSkills: readonly LlmEnabledSkillCatalogEntry[],
  contributions: {
    skills: readonly HostExtensionContributedSkill[];
    rules: readonly HostExtensionContributedRule[];
  },
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
