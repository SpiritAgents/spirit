import { Check, Copy, Handshake, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRemoteControlDeviceName } from "@/lib/remote-control-device-presentation";
import type { RemoteControlEnrollment, RemoteControlState } from "@spiritagent/remote-control";

export function RemoteControlPairingDialogs({
  stage,
  enrollment,
  pending,
  busy,
  onDismissIntro,
  onContinue,
  onCancel,
  onApprove,
  onReject,
}: {
  stage: "intro" | "qr" | null;
  enrollment: RemoteControlEnrollment | null;
  pending: RemoteControlState["pendingPairing"];
  busy: boolean;
  onDismissIntro: () => void;
  onContinue: () => void;
  onCancel: (pairingId: string) => void;
  onApprove: (pairingId: string) => void;
  onReject: (pairingId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const confirmationOpen =
    stage === "qr" && enrollment?.pairingId === pending?.id && Boolean(pending?.request);
  const deviceName = pending?.request
    ? formatRemoteControlDeviceName(
        {
          name: pending.name ?? t("settings.thisDevice"),
          lastUserAgent: pending.request.userAgent,
          customName: Boolean(pending.name),
        },
        i18n.language,
      )
    : "";

  return (
    <>
      <Dialog open={stage === "intro"} onOpenChange={(open) => !open && onDismissIntro()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.pairIntroducingTitle")}</DialogTitle>
          </DialogHeader>
          <div className="mx-auto grid max-w-xs gap-6 py-3">
            <IntroducingItem
              icon={<Handshake className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />}
              title={t("settings.pairFeatureTitle")}
              description={t("settings.pairFeatureDescription")}
            />
            <IntroducingItem
              icon={<ShieldCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />}
              title={t("settings.pairSecurityTitle")}
              description={t("settings.pairSecurityDescription")}
            />
          </div>
          <DialogFooter>
            <DialogFooterActions>
              <Button type="button" onClick={onContinue} disabled={busy}>
                {t("app.continue")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={stage === "qr" && enrollment !== null}
        modal={!confirmationOpen}
        onOpenChange={(open) => {
          if (!open && enrollment) onCancel(enrollment.pairingId);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.pairDialogTitle")}</DialogTitle>
          </DialogHeader>
          {enrollment?.qrCodeSvg ? (
            <div className="flex justify-center py-2">
              <img
                className="size-56 max-w-full rounded-md bg-white p-2"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrCodeSvg)}`}
                alt={t("settings.pairQrAlt")}
              />
            </div>
          ) : null}
          {enrollment ? (
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {enrollment.url}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label={copied ? t("settings.copied") : t("settings.copyEnrollmentUrl")}
                onClick={() => {
                  void navigator.clipboard.writeText(enrollment.url).then(() => {
                    setCopied(true);
                    if (copyTimer.current) clearTimeout(copyTimer.current);
                    copyTimer.current = setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? (
                  <Check className="size-3.5" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
                )}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmationOpen}
        onOpenChange={(open) => {
          if (!open && enrollment) onReject(enrollment.pairingId);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.allowDeviceControl", { device: deviceName })}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => enrollment && onReject(enrollment.pairingId)}
              >
                {t("settings.deny")}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => enrollment && onApprove(enrollment.pairingId)}
              >
                {t("settings.allow")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IntroducingItem({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="pt-0.5 text-foreground">{icon}</div>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-normal text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
