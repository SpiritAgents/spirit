import { useTranslation } from "react-i18next";

import { ScrollArea } from "@spiritagent/ui/scroll-area";
import { formatRelativeTime } from "@spiritagent/ui/rendering/format-relative-time";
import { resolveGitHubAvatarUrl } from "../lib/github-avatar-url.js";
import { PR_LIST_ROW_RULES_CLASS } from "../lib/pr-list-row-rules.js";
import { cn } from "@spiritagent/ui/cn";
import type { GitHubPullRequestCommit } from "../types.js";

export type WorkspacePrCommitsViewProps = {
  commits: GitHubPullRequestCommit[];
  loading?: boolean;
  hasMore?: boolean;
  onOpenExternal?: (url: string) => void;
  className?: string;
};

function PrCommitRow({
  commit,
  onOpenExternal,
}: {
  commit: GitHubPullRequestCommit;
  onOpenExternal?: (url: string) => void;
}) {
  const { i18n } = useTranslation();
  const avatarUrl = resolveGitHubAvatarUrl(commit.authorLogin, commit.avatarUrl);

  const openCommit = () => {
    if (commit.url && onOpenExternal) {
      onOpenExternal(commit.url);
    }
  };

  return (
    <div className="space-y-1.5 px-3 py-3">
      {commit.url && onOpenExternal ? (
        <button
          type="button"
          className="block w-full truncate text-left text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={openCommit}
        >
          {commit.subject}
        </button>
      ) : (
        <p className="truncate text-xs leading-relaxed text-foreground">{commit.subject}</p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <img
          src={avatarUrl}
          alt=""
          className="size-5 shrink-0 rounded-full bg-muted object-cover"
        />
        <span className="truncate text-xs font-normal text-foreground/80">
          {commit.authorLogin}
        </span>
        <time
          className="shrink-0 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65"
          dateTime={commit.createdAt}
        >
          {formatRelativeTime(commit.createdAt, i18n.language)}
        </time>
      </div>
    </div>
  );
}

export function WorkspacePrCommitsView({
  commits,
  loading = false,
  hasMore = false,
  onOpenExternal,
  className,
}: WorkspacePrCommitsViewProps) {
  const { t } = useTranslation();

  if (loading && commits.length === 0) {
    return (
      <div className={cn("px-3 py-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prCommitsLoading")}
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div className={cn("px-3 py-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prCommitsEmpty")}
      </div>
    );
  }

  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)} type="auto">
      <div className={PR_LIST_ROW_RULES_CLASS} data-trailing-rule={hasMore ? undefined : ""}>
        {commits.map((commit) => (
          <PrCommitRow key={commit.sha} commit={commit} onOpenExternal={onOpenExternal} />
        ))}
        {hasMore ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/75 dark:text-muted-foreground/65">
            {t("workspace.prCommitsHasMore")}
          </p>
        ) : null}
      </div>
    </ScrollArea>
  );
}
