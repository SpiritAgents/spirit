import { Trans, useTranslation } from "react-i18next";

import { TEXT_LINK_CLASS } from "@spiritagent/ui/link";
import { cn } from "@spiritagent/ui/cn";

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
      <Trans
        t={t}
        i18nKey="workspace.prGitHubAuthorizationRequired"
        components={{
          authorize: (
            <button
              type="button"
              className={cn(TEXT_LINK_CLASS, linkClassName)}
              onClick={onSignIn}
            />
          ),
        }}
      />
    </p>
  );
}
