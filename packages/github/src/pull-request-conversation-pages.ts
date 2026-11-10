import { nestReviewThreadsUnderReviews } from "./conversation.js";
import type {
  GitHubPullRequestConversationItem,
  GitHubPullRequestConversationReview,
} from "./types.js";

function flattenConversationItems(
  items: GitHubPullRequestConversationItem[],
): GitHubPullRequestConversationItem[] {
  const output: GitHubPullRequestConversationItem[] = [];

  for (const item of items) {
    if (item.kind === "review") {
      const { threads, ...review } = item as GitHubPullRequestConversationReview;
      output.push({ ...review, threads: [] });
      for (const thread of threads) {
        output.push(thread);
      }
      continue;
    }

    output.push(item);
  }

  return output;
}

/** Merge a conversation pagination page into an existing timeline by item id. */
export function appendPullRequestConversationPages(
  existing: GitHubPullRequestConversationItem[],
  incoming: GitHubPullRequestConversationItem[],
): GitHubPullRequestConversationItem[] {
  if (incoming.length === 0) {
    return existing;
  }

  const seen = new Set(flattenConversationItems(existing).map((item) => item.id));
  const appended = flattenConversationItems(incoming).filter((item) => !seen.has(item.id));
  if (appended.length === 0) {
    return existing;
  }

  const merged = [...flattenConversationItems(existing), ...appended];
  merged.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  return nestReviewThreadsUnderReviews(merged);
}
