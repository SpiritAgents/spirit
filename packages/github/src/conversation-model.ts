import type {
  GitHubPullRequestConversationReview,
  GitHubPullRequestConversationItem,
  GitHubPullRequestConversationReviewThread,
} from "./types.js";

export function nestReviewThreadsUnderReviews(
  items: GitHubPullRequestConversationItem[],
): GitHubPullRequestConversationItem[] {
  const reviewIds = new Set(
    items
      .filter((item): item is GitHubPullRequestConversationReview => item.kind === "review")
      .map((item) => item.id),
  );
  const threadsByReviewId = new Map<string, GitHubPullRequestConversationReviewThread[]>();

  for (const item of items) {
    if (item.kind !== "reviewThread" || !item.reviewId || !reviewIds.has(item.reviewId)) {
      continue;
    }
    const bucket = threadsByReviewId.get(item.reviewId) ?? [];
    bucket.push(item);
    threadsByReviewId.set(item.reviewId, bucket);
  }

  const output: GitHubPullRequestConversationItem[] = [];

  for (const item of items) {
    if (item.kind === "reviewThread") {
      if (item.reviewId && reviewIds.has(item.reviewId)) {
        continue;
      }
      output.push(item);
      continue;
    }

    if (item.kind === "review") {
      const threads = [...(threadsByReviewId.get(item.id) ?? [])].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      );
      output.push({ ...item, threads });
      continue;
    }

    output.push(item);
  }

  return output;
}
