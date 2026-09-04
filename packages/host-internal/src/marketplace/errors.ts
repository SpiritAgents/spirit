import type { MarketplaceReviewStatus } from "@spiritagent/marketplace-toolkit";

/**
 * Raised when installing or updating an entry whose reviewStatus is not
 * "verified" without an explicit user acknowledgement. Callers catch this to
 * show the confirmation gate and retry with `reviewAcknowledged: true`.
 */
export class MarketplaceReviewAcknowledgementRequiredError extends Error {
  readonly extensionId: string;
  readonly reviewStatus: MarketplaceReviewStatus;

  constructor(extensionId: string, reviewStatus: MarketplaceReviewStatus) {
    super(
      `Extension ${extensionId} is ${reviewStatus}; installing or updating it requires explicit user confirmation.`,
    );
    this.name = "MarketplaceReviewAcknowledgementRequiredError";
    this.extensionId = extensionId;
    this.reviewStatus = reviewStatus;
  }
}
