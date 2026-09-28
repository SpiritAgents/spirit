import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSectionItems,
  ContextMenuTrigger,
  type ContextMenuSectionItem,
} from "@/components/ui/context-menu";
import { copyTerminalSelection, pasteTerminalClipboard } from "@/lib/workspace-xterm";
import type { Terminal } from "@xterm/xterm";

/** Right-click menu shared by the workspace terminals (interactive shell and task runs). */
export function WorkspaceTerminalContextMenu({
  terminal,
  children,
}: {
  terminal: Terminal | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [hasSelection, setHasSelection] = useState(false);

  const menuItems: ContextMenuSectionItem[] = [
    {
      section: "clipboard",
      item: (
        <ContextMenuItem
          disabled={!terminal || !hasSelection}
          onSelect={() => {
            if (terminal && copyTerminalSelection(terminal)) {
              terminal.focus();
            }
          }}
        >
          {t("common.copy")}
        </ContextMenuItem>
      ),
    },
    {
      section: "clipboard",
      item: (
        <ContextMenuItem
          disabled={!terminal}
          onSelect={() => {
            if (terminal) {
              pasteTerminalClipboard(terminal);
              terminal.focus();
            }
          }}
        >
          {t("common.paste")}
        </ContextMenuItem>
      ),
    },
    {
      section: "selection",
      item: (
        <ContextMenuItem
          disabled={!terminal}
          onSelect={() => {
            if (terminal) {
              terminal.selectAll();
              terminal.focus();
            }
          }}
        >
          {t("common.selectAll")}
        </ContextMenuItem>
      ),
    },
  ];

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) {
          setHasSelection(terminal?.hasSelection() ?? false);
        }
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSectionItems items={menuItems} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
