import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import { TerminalSelectionMenu } from "@/components/workspace-terminal-selection-menu";
import { createWorkspaceTerminalSession } from "@/lib/workspace-xterm";
import { desktopTranslucencyTerminalTintClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import type { Terminal } from "@xterm/xterm";

export type WorkspaceTerminalTabProps = {
  workspaceRoot: string;
  /** Notifies the parent when the terminal title changes (from OSC 0/2 sequences); undefined when there is no title */
  onTitleChange?: (title: string | undefined) => void;
  /** Terminal name used for the Chip and menu display (OSC title or the default Terminal label). */
  terminalDisplayName?: string;
  onTerminalAddToChat?: (
    attachment: import("@/lib/terminal-snippet-attachment").TerminalSnippetAttachment,
  ) => void;
  /** True while the sidebar is being continuously drag-resized; pauses terminal fit until release. */
  suspendTerminalResize?: boolean;
  /** Windows Mica / macOS Vibrancy: the terminal keeps higher opacity to ensure ANSI readability. */
  useTranslucency?: boolean;
};

export function WorkspaceTerminalTab({
  workspaceRoot,
  onTitleChange,
  terminalDisplayName = "Terminal",
  onTerminalAddToChat,
  suspendTerminalResize = false,
  useTranslucency = false,
}: WorkspaceTerminalTabProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const sessionScheduleFitRef = useRef<(() => void) | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const bridge = typeof window !== "undefined" ? window.spiritDesktop : undefined;
  const canEmbed = Boolean(bridge?.ptyCreate);
  const trimmed = workspaceRoot.trim();
  const onTitleChangeRef = useRef(onTitleChange);
  const tRef = useRef(t);
  const suspendResizeRef = useRef(suspendTerminalResize);
  useLayoutEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  });
  useLayoutEffect(() => {
    tRef.current = t;
  });
  useLayoutEffect(() => {
    suspendResizeRef.current = suspendTerminalResize;
  });

  useEffect(() => {
    setEmbedError(null);
    setTerminal(null);
    const b = typeof window !== "undefined" ? window.spiritDesktop : undefined;
    if (!trimmed || !b?.ptyCreate || !b.ptySubscribe) {
      return;
    }

    const el = containerRef.current;
    if (!el) {
      return;
    }

    const session = createWorkspaceTerminalSession({
      container: el,
      cwd: trimmed,
      bridge: b,
      onTitleChange: (title) => onTitleChangeRef.current?.(title),
      onEmbedError: setEmbedError,
      shellExitedMessage: (exitCode) => tRef.current("workspace.terminalExited", { exitCode }),
      isResizeSuspended: () => suspendResizeRef.current,
    });
    setTerminal(session.terminal);
    sessionScheduleFitRef.current = session.scheduleFit;

    return () => {
      session.dispose();
      setTerminal(null);
      sessionScheduleFitRef.current = null;
    };
  }, [trimmed, canEmbed, retryNonce]);

  useEffect(() => {
    if (!suspendTerminalResize) {
      sessionScheduleFitRef.current?.();
    }
  }, [suspendTerminalResize]);

  const openExternal = (): void => {
    if (!bridge?.openSystemTerminal || !trimmed) {
      return;
    }
    void bridge.openSystemTerminal(trimmed);
  };

  if (!trimmed) {
    return <p className="text-muted-foreground">{t("workspace.openWorkspaceToUse")}</p>;
  }

  if (!canEmbed || !bridge?.openSystemTerminal) {
    return <p className="text-muted-foreground">{t("workspace.terminalElectronOnly")}</p>;
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      {embedError ? (
        <div className="flex shrink-0 flex-col gap-2">
          <p className="text-xs text-destructive">{embedError}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEmbedError(null);
                setRetryNonce((n) => n + 1);
              }}
            >
              {t("common.retry")}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={openExternal}>
              {t("workspace.openSystemTerminal")}
            </Button>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={cn(
          "workspace-terminal-xterm min-h-0 min-w-0 flex-1 overflow-hidden",
          desktopTranslucencyTerminalTintClass(useTranslucency),
          embedError ? "hidden" : "block",
        )}
      />
      <TerminalSelectionMenu
        containerRef={containerRef}
        terminal={terminal}
        terminalDisplayName={terminalDisplayName}
        onTerminalAddToChat={onTerminalAddToChat}
      />
    </div>
  );
}
