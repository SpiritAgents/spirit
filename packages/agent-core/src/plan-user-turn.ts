import { product } from "@spiritagent/product";

export function buildStartImplementingPrompt(activePlanPath?: string): string {
  const trimmed = activePlanPath?.trim();
  if (!trimmed) {
    return "The user has approved the plan and asked to start implementing. No usable implementation plan path is recorded for this session; create one with create_plan before implementing.";
  }
  return `The user has approved the plan and asked to start implementing. Before implementing, read the ${product.name}-managed plan file ${trimmed} and follow its execution plan for coding and verification. If the file does not exist, cannot be read, or clearly does not match the current request, say so explicitly and ask the user to regenerate or confirm the plan; do not assume its contents.`;
}
