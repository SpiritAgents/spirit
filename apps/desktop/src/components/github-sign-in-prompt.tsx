import { useTranslation } from "react-i18next";

import { TEXT_LINK_CLASS, TEXT_LINK_POPOVER_CLASS } from "@/components/ui/link";
import { cn } from "@/lib/utils";

export type GitHubSignInPromptProps = {
  onSignIn: () => void;
  className?: string;
  linkClassName?: string;
};

export function GitHubSignInPrompt({
  onSignIn,
  className,
  linkClassName,
}: GitHubSignInPromptProps) {
  const { t } = useTranslation();

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {t("workspace.prGitHubConnectPromptBefore")}
      <button type="button" className={cn(TEXT_LINK_CLASS, linkClassName)} onClick={onSignIn}>
        {t("workspace.prGitHubConnectLink")}
      </button>
    </p>
  );
}

export type GitHubConnectTooltipContentProps = {
  onSignIn: () => void;
};

export function GitHubConnectTooltipContent({ onSignIn }: GitHubConnectTooltipContentProps) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex max-w-[16rem] flex-wrap items-center gap-0.5 text-left leading-snug">
      {t("workspace.prGitHubConnectTooltipBefore")}
      <button type="button" className={TEXT_LINK_POPOVER_CLASS} onClick={onSignIn}>
        {t("workspace.prGitHubConnectLink")}
      </button>
    </span>
  );
}
