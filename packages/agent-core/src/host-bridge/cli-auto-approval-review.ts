import { runAutoApprovalReview } from "../auto-approval/run-review.js";
import type { ToolAutoReviewInput, ToolAutoReviewResult } from "../auto-approval/types.js";
import type { LlmTransportConfig } from "../provider-config.js";
import { isBedrockTransportConfig } from "../provider-config.js";
import { buildSpiritCoreHostPrompt } from "../tool-agent.js";
import { createJsonSchemaTransport } from "../transport-factory.js";

function providerIdForTransportConfig(config: LlmTransportConfig): string | undefined {
  if (isBedrockTransportConfig(config)) {
    return "bedrock";
  }
  // Neutral mechanism label for the host prompt: the declared SDK adapter package.
  return config.sdk;
}

/** When the CLI has no separate lightweight config, reuse the current transport's active model. */
export function createCliAutoApprovalReviewer(
  config: LlmTransportConfig,
): (input: ToolAutoReviewInput) => Promise<ToolAutoReviewResult | undefined> {
  return async (input) => {
    if (!config.apiKey?.trim()) {
      return undefined;
    }
    const transport = createJsonSchemaTransport(config);
    return runAutoApprovalReview(transport, config, input, {
      systemSections: [
        buildSpiritCoreHostPrompt(config.model, providerIdForTransportConfig(config)),
      ],
    });
  };
}
