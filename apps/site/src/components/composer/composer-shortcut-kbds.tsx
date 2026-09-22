import { CornerDownLeft } from "lucide-react";
import { useTranslation } from "@/lib/desktop-preview-i18n";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ctrlLetterShortcutKbdKeys, isMacDesktopPlatform } from "@/lib/desktop-shell";

export function ComposerSendEnterKbd() {
  const { t } = useTranslation();

  return (
    <Kbd aria-label={t("composer.sendEnterKey")}>
      <CornerDownLeft className="size-3" aria-hidden strokeWidth={1.75} />
    </Kbd>
  );
}

export function ComposerAbortShortcutKbd() {
  const keys = ctrlLetterShortcutKbdKeys("C");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>C</Kbd>
        </>
      )}
    </KbdGroup>
  );
}
