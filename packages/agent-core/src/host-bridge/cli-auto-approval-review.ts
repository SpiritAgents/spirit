import { runAutoApprovalReview } from "../auto-approval/run-review.js";
import type { ToolAutoReviewInput, ToolAutoReviewResult } from "../auto-approval/types.js";
import type { LlmTransportConfig } from "../provider-config.js";
import { buildSpiritCoreHostPrompt } from "../tool-agent.js";
import { createJsonSchemaTransport } from "../transport-factory.js";

/** When the CLI has no separate lightweight config, reuse the current transport's active model. */
export function createCliAutoApprovalReviewer(
  config: LlmTransportConfig,
  providerId?: string,
): (input: ToolAutoReviewInput) => Promise<ToolAutoReviewResult | undefined> {
  return async (input) => {
    if (!config.apiKey?.trim()) {
      return undefined;
    }
    const transport = createJsonSchemaTransport(config);
    return runAutoApprovalReview(transport, config, input, {
      systemSections: [buildSpiritCoreHostPrompt(config.model, providerId)],
    });
  };
}
