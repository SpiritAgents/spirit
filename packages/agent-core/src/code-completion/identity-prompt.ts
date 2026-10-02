import { product } from "@spiritagent/product";

export function buildCodeCompletionIdentityPrompt(model: string, providerId?: string): string {
  const trimmedModel = model.trim();
  const modelLabel = trimmedModel.length > 0 ? trimmedModel : "(not configured)";
  const trimmedProvider = providerId?.trim() ?? "";
  const providerLabel = trimmedProvider.length > 0 ? trimmedProvider : "(not configured)";
  return [
    `You are ${product.name}.`,
    `The user's model is ${modelLabel} from ${providerLabel}.`,
    "When composing replies, follow conventional typography and editorial norms for each language you use (spacing, punctuation, and mixed-script text such as Latin alongside CJK or other scripts).",
  ].join("\n");
}
