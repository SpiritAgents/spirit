import type { HostInstructionDiscovery } from "@spiritagent/instructions/discovery";
import type { HostStateStorage } from "./storage.js";
import type { HostBuiltinToolService } from "@spiritagent/api/tools";

export interface HostRuntimeModules<Config, Session, Rule, Skill, PlanMetadata, QuestionSpec> {
  storage: HostStateStorage<Config, Session>;
  discovery: HostInstructionDiscovery<Rule, Skill, PlanMetadata>;
  tools: HostBuiltinToolService<QuestionSpec>;
  extensions?: { list(): Promise<readonly unknown[]> };
}

export function defineHostRuntimeModules<Config, Session, Rule, Skill, PlanMetadata, QuestionSpec>(
  modules: HostRuntimeModules<Config, Session, Rule, Skill, PlanMetadata, QuestionSpec>,
): HostRuntimeModules<Config, Session, Rule, Skill, PlanMetadata, QuestionSpec> {
  return modules;
}
