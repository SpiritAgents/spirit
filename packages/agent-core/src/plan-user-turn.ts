import { product } from "@spiritagent/product";

export function buildStartImplementingPrompt(activePlanPath?: string): string {
  const trimmed = activePlanPath?.trim();
  if (!trimmed) {
    return `The user has approved the plan and asked to start implementing, but this session has no usable implementation plan path. This may be caused by a deleted plan file or a ${product.name} issue. Investigate the cause. If regenerating the plan can resolve it, explain the issue and ask the user to switch to Plan mode and send a request to generate the plan again. Otherwise, use ask_questions to explain the issue and offer alternative ways to proceed.`;
  }
  return `The user has approved the plan and asked to start implementing. Before implementing, read the ${product.name}-managed plan file ${trimmed} and follow its execution plan for coding and verification.`;
}
