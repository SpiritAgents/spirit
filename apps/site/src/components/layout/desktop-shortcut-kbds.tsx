import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  isMacDesktopPlatform,
  modAltLetterShortcutKbdKeys,
  modLetterShortcutKbdKeys,
} from "@/lib/desktop-shell";

export function ThreadSidebarShortcutKbd() {
  const keys = modLetterShortcutKbdKeys("B");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>B</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

export function NewThreadShortcutKbd() {
  const keys = modLetterShortcutKbdKeys("N");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>N</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

export function WorkspaceToolsShortcutKbd() {
  const keys = modAltLetterShortcutKbdKeys("B");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>Alt</Kbd>
          <span>+</span>
          <Kbd>B</Kbd>
        </>
      )}
    </KbdGroup>
  );
}
