import { useTranslation } from "react-i18next";

import { AlertDialog } from "@/components/ui/alert-dialog";
import type { DesktopSnapshot } from "@/types";

export type BranchCheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchCheckoutBlockedByChanges: boolean;
  git: DesktopSnapshot["git"] | undefined;
  commitBusy: boolean;
  onCancel: () => void;
  onConfirmCheckout: () => void;
  onDiscardAndCheckout: () => void;
};

export function BranchCheckoutDialog({
  open,
  onOpenChange,
  branchCheckoutBlockedByChanges,
  git,
  commitBusy,
  onCancel: _onCancel,
  onConfirmCheckout,
  onDiscardAndCheckout,
}: BranchCheckoutDialogProps) {
  const { t } = useTranslation();
  const targetBranch = git?.selectedBranch ?? git?.branch ?? "";

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        branchCheckoutBlockedByChanges
          ? t("app.discardAndSwitchConfirmTitle", { branch: targetBranch })
          : t("app.switchBranchConfirmTitle", { branch: targetBranch })
      }
      description={
        branchCheckoutBlockedByChanges
          ? t("app.discardAndSwitchConfirmDescription")
          : t("app.switchBranchConfirmDescription")
      }
      confirmLabel={
        branchCheckoutBlockedByChanges ? t("app.discardAndSwitch") : t("app.switchAndSend")
      }
      cancelLabel={t("common.cancel")}
      variant={branchCheckoutBlockedByChanges ? "destructive" : "default"}
      busy={commitBusy}
      onConfirm={() => {
        if (branchCheckoutBlockedByChanges) {
          onDiscardAndCheckout();
          return;
        }
        onConfirmCheckout();
      }}
    />
  );
}
