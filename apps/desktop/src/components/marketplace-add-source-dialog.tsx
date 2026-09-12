import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";

/** Mirrors the host's deterministic git classification (for the conditional Git Ref field). */
export function isGitMarketplaceLocator(input: string): boolean {
  const trimmed = input.trim();
  return (
    trimmed.includes("/_git/") ||
    trimmed.endsWith(".git") ||
    trimmed.startsWith("git@") ||
    trimmed.startsWith("ssh://")
  );
}

type MarketplaceAddSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (request: { locator: string; ref?: string }) => Promise<void>;
};

export function MarketplaceAddSourceDialog({
  open,
  onOpenChange,
  busy,
  onSubmit,
}: MarketplaceAddSourceDialogProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [error, setError] = useState("");

  const gitLike = isGitMarketplaceLocator(source);

  const close = () => {
    setSource("");
    setGitRef("");
    setError("");
    onOpenChange(false);
  };

  const submit = () => {
    const locator = source.trim();
    if (!locator) {
      setError(t("marketplace.addSourceSourceRequired"));
      return;
    }
    void (async () => {
      try {
        await onSubmit({ locator, ...(gitRef.trim() ? { ref: gitRef.trim() } : {}) });
        close();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : String(submitError));
      }
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        }
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t("marketplace.addMarketplace")}</DialogTitle>
          <DialogDescription>{t("marketplace.addMarketplaceDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="marketplace-source">{t("marketplace.addSourceSourceLabel")}</Label>
            <DesktopFormInput
              id="marketplace-source"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setError("");
              }}
              placeholder={t("marketplace.addSourceSourcePlaceholder")}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          {gitLike ? (
            <div className="grid gap-1.5">
              <Label htmlFor="marketplace-git-ref">{t("marketplace.addSourceGitRefLabel")}</Label>
              <DesktopFormInput
                id="marketplace-git-ref"
                value={gitRef}
                onChange={(event) => setGitRef(event.target.value)}
                placeholder={t("marketplace.addSourceGitRefPlaceholder")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </div>
          ) : null}
          {error ? (
            <p data-spirit-selectable="text" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <DialogFooterActions>
            <Button type="button" variant="outline" size="sm" onClick={close} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" onClick={submit} disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("marketplace.addMarketplace")}
            </Button>
          </DialogFooterActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
