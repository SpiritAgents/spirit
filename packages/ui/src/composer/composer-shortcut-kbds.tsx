import { CornerDownLeft } from "lucide-react";

import { Kbd, KbdGroup } from "../kbd.js";
import { useComposerLabels } from "./labels.js";
import { ctrlLetterShortcutKbdKeys, isMacNavigatorPlatform } from "../platform.js";

export function ComposerSendEnterKbd() {
  const labels = useComposerLabels();

  return (
    <Kbd aria-label={labels.sendEnterKeyAriaLabel}>
      <CornerDownLeft className="size-3" aria-hidden strokeWidth={1.75} />
    </Kbd>
  );
}

export function ComposerAbortShortcutKbd() {
  const keys = ctrlLetterShortcutKbdKeys("C");

  return (
    <KbdGroup>
      {isMacNavigatorPlatform() ? (
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
