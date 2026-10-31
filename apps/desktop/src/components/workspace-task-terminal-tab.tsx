import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "@xterm/xterm/css/xterm.css";

import { desktopTranslucencyTerminalTintClass } from "@/lib/desktop-translucency-surface";
import { disposeTaskTerminal, registerTaskTerminal } from "@/lib/task-terminal-registry";
import { createWorkspaceTaskTerminalSession } from "@/lib/workspace-task-terminal";
import { WorkspaceTerminalContextMenu } from "@/components/workspace-terminal-context-menu";
import { cn } from "@/lib/utils";
import type { Terminal } from "@xterm/xterm";

export type WorkspaceTaskTerminalTabProps = {
  tabId: string;
  taskKey: string;
  onTitleChange?: (title: string | undefined) => void;
  /** True while the sidebar is being continuously drag-resized; pauses terminal fit until release. */
  suspendTerminalResize?: boolean;
  /** Windows Mica / macOS Vibrancy: the terminal keeps higher opacity to ensure ANSI readability. */
  useTranslucency?: boolean;
};

/** Mounts one task terminal session into the tab and registers it for the task coordinator. */
export function WorkspaceTaskTerminalTab({
  tabId,
  taskKey,
  onTitleChange,
  suspendTerminalResize = false,
  useTranslucency = false,
}: WorkspaceTaskTerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  const suspendResizeRef = useRef(suspendTerminalResize);
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  });
  useEffect(() => {
    suspendResizeRef.current = suspendTerminalResize;
  });
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    const el = containerRef.current;
    const bridge = typeof window !== "undefined" ? window.spiritDesktop : undefined;
    if (!el || !bridge?.ptyCreate || !bridge.ptySubscribe) {
      return;
    }
    const session = createWorkspaceTaskTerminalSession({
      container: el,
      bridge,
      onTitleChange: (title) => onTitleChangeRef.current?.(title),
      exitedMessage: (exitCode) => tRef.current("workspace.terminalExited", { exitCode }),
      isResizeSuspended: () => suspendResizeRef.current,
    });
    setTerminal(session.terminal);
    registerTaskTerminal(tabId, { session, taskKey, running: false });
    return () => {
      setTerminal(null);
      disposeTaskTerminal(tabId);
    };
  }, [tabId, taskKey]);

  return (
    <WorkspaceTerminalContextMenu terminal={terminal}>
      <div
        ref={containerRef}
        className={cn(
          "workspace-terminal-xterm min-h-0 min-w-0 flex-1 overflow-hidden",
          desktopTranslucencyTerminalTintClass(useTranslucency),
        )}
      />
    </WorkspaceTerminalContextMenu>
  );
}
