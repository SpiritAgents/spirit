import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import type { Messages } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";

export type WorkspaceTerminalTabProps = {
  workspaceRoot: string;
};

const TERMINAL_FONT_FAMILY =
  '"Cascadia Code", "Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace';

function terminalCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Theme colors come from the --terminal-* variables in index.css (light/dark variants), switched via html.dark. */
function terminalTheme(): ITheme {
  return {
    background: terminalCssVar("--terminal-bg"),
    foreground: terminalCssVar("--terminal-fg"),
    cursor: terminalCssVar("--terminal-cursor"),
    cursorAccent: terminalCssVar("--terminal-cursor-accent"),
    selectionBackground: terminalCssVar("--terminal-selection-bg"),
  };
}

function writeClipboard(text: string): void {
  const bridge = window.spiritDesktop;
  if (bridge?.writeClipboardText) {
    bridge.writeClipboardText(text);
    return;
  }
  void navigator.clipboard.writeText(text);
}

function readClipboardSync(): string | null {
  const bridge = window.spiritDesktop;
  if (bridge?.readClipboardText) {
    try {
      return bridge.readClipboardText();
    } catch {
      return null;
    }
  }
  return null;
}

function promptForWorkspace(workspaceRoot: string): string {
  return `PS ${workspaceRoot}> `;
}

function mockCommandOutput(
  command: string,
  workspaceRoot: string,
  copy: Messages["desktop"]["shell"],
): string[] {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  if (normalized === "help") {
    return [
      copy.helpTitle,
      copy.helpDir,
      copy.helpTree,
      copy.helpGitStatus,
      copy.helpBuild,
      copy.helpClear,
      "",
      copy.currentWorkspace(workspaceRoot),
    ];
  }

  if (normalized === "dir" || normalized === "ls") {
    return [
      "Directory: D:\\spiritagent.app",
      "",
      "Mode                LastWriteTime         Name",
      "d----        2026/04/07     09:00         public",
      "d----        2026/04/07     09:00         src",
      "d----        2026/04/07     09:00         SPIRIT",
      "-a---        2026/04/07     09:00         package.json",
      "-a---        2026/04/07     09:00         vite.config.ts",
    ];
  }

  if (normalized === "tree") {
    return [
      ".\\",
      "|-- public",
      "|   `-- favicon.svg",
      "|-- src",
      "|   |-- App.tsx",
      "|   |-- index.css",
      "|   `-- components",
      "|       |-- hero.tsx",
      "|       `-- spirit-desktop-window.tsx",
      "`-- SPIRIT",
    ];
  }

  if (normalized === "git status") {
    return [
      "On branch main",
      "Your branch is up to date with 'origin/main'.",
      "",
      "Changes not staged for commit:",
      "  modified: src/components/hero.tsx",
      "  modified: src/index.css",
      "  modified: package.json",
      "",
      "no changes added to commit",
    ];
  }

  if (normalized === "npm run build" || normalized === "npm build") {
    return [
      "> spiritagent.app@0.0.0 build D:\\spiritagent.app",
      "> vite build",
      "",
      "vite v8 building for production...",
      "transforming modules...",
      "rendering chunks...",
      "dist/index.html                 0.62 kB",
      "dist/assets/index-preview.js  411.20 kB",
      "built in 2.31s",
    ];
  }

  if (normalized === "clear" || normalized === "cls") {
    return ["__CLEAR__"];
  }

  return [copy.unsupportedCommand(command.trim()), copy.typeHelp];
}

export function WorkspaceTerminalTab({ workspaceRoot }: WorkspaceTerminalTabProps) {
  const { messages } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const activePtyIdRef = useRef<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const bridge = typeof window !== "undefined" ? window.spiritDesktop : undefined;
  const canEmbed = Boolean(bridge?.ptyCreate && bridge?.ptySubscribe);
  const trimmed = workspaceRoot.trim();
  const terminalSessionKey = `${trimmed}\u0000${retryNonce}`;
  const [embedErrorResult, setEmbedErrorResult] = useState<{
    key: string;
    message: string | null;
  }>({ key: terminalSessionKey, message: null });
  const embedError = embedErrorResult.key === terminalSessionKey ? embedErrorResult.message : null;

  useEffect(() => {
    activePtyIdRef.current = null;
    termRef.current = null;
    if (!trimmed) {
      return;
    }

    const element = containerRef.current;
    if (!element) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      lineHeight: 1.2,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontWeight: "normal",
      theme: terminalTheme(),
      scrollback: 8000,
    });
    termRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    fitAddon.fit();

    // Re-read the --terminal-* variables when the system theme flips (html.dark toggle)
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const selection = terminal.getSelection();
      if (selection.length > 0) {
        writeClipboard(selection);
        terminal.clearSelection();
        return;
      }
      const sync = readClipboardSync();
      if (sync != null) {
        terminal.paste(sync);
        return;
      }
      void navigator.clipboard.readText().then((text) => {
        if (text) {
          terminal.paste(text);
        }
      });
    };
    element.addEventListener("contextmenu", onContextMenu, true);

    let resizeObserver: ResizeObserver | undefined;
    let unsubscribePty: (() => void) | undefined;
    let terminalDisposed = false;
    let ptyId: string | undefined;
    let alive = true;

    const disposeTerminal = (): void => {
      if (terminalDisposed) {
        return;
      }
      terminalDisposed = true;
      terminal.dispose();
      if (termRef.current === terminal) {
        termRef.current = null;
      }
    };

    const teardown = (): void => {
      element.removeEventListener("contextmenu", onContextMenu, true);
      themeObserver.disconnect();
      unsubscribePty?.();
      unsubscribePty = undefined;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      if (ptyId && bridge?.ptyKill) {
        void bridge.ptyKill(ptyId);
        ptyId = undefined;
      }
      disposeTerminal();
      activePtyIdRef.current = null;
    };

    if (canEmbed && bridge?.ptyCreate && bridge.ptySubscribe) {
      unsubscribePty = bridge.ptySubscribe({
        onData: (payload) => {
          if (payload.id === activePtyIdRef.current) {
            terminal.write(payload.data);
          }
        },
        onExit: (payload) => {
          if (payload.id === activePtyIdRef.current) {
            terminal.write(
              `\r\n\x1b[90m${messages.desktop.shell.exited(payload.exitCode)}\x1b[0m\r\n`,
            );
            activePtyIdRef.current = null;
          }
        },
      });

      void (async () => {
        const created = await bridge.ptyCreate({
          cwd: trimmed,
          cols: terminal.cols,
          rows: terminal.rows,
        });

        if (!alive) {
          if (created.ok && bridge.ptyKill) {
            void bridge.ptyKill(created.id);
          }
          teardown();
          return;
        }

        if (!created.ok) {
          setEmbedErrorResult({ key: terminalSessionKey, message: created.error });
          teardown();
          return;
        }

        ptyId = created.id;
        activePtyIdRef.current = created.id;
        terminal.onData((data) => {
          bridge.ptyWrite?.(created.id, data);
        });

        resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
          bridge.ptyResize?.(created.id, terminal.cols, terminal.rows);
        });
        resizeObserver.observe(element);

        queueMicrotask(() => {
          if (alive) {
            terminal.focus();
          }
        });
      })();
    } else {
      let buffer = "";
      const prompt = promptForWorkspace(trimmed);
      const writePrompt = () => terminal.write(`\r\n${prompt}`);

      terminal.write(prompt);

      const disposable = terminal.onData((data) => {
        if (data === "\r") {
          const command = buffer;
          buffer = "";
          const output = mockCommandOutput(command, trimmed, messages.desktop.shell);
          if (output[0] === "__CLEAR__") {
            terminal.clear();
            terminal.write(prompt);
            return;
          }
          terminal.write("\r\n");
          for (const line of output) {
            terminal.writeln(line);
          }
          writePrompt();
          return;
        }

        if (data === "\u0003") {
          buffer = "";
          terminal.write("^C");
          writePrompt();
          return;
        }

        if (data === "\u007f") {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            terminal.write("\b \b");
          }
          return;
        }

        if (data >= " " && data !== "\u007f") {
          buffer += data;
          terminal.write(data);
        }
      });

      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(element);

      queueMicrotask(() => {
        if (alive) {
          terminal.focus();
        }
      });

      return () => {
        alive = false;
        disposable.dispose();
        teardown();
      };
    }

    return () => {
      alive = false;
      teardown();
    };
  }, [bridge, canEmbed, messages.desktop.shell, terminalSessionKey, trimmed]);

  const openExternal = (): void => {
    if (!bridge?.openSystemTerminal || !trimmed) {
      return;
    }
    void bridge.openSystemTerminal(trimmed);
  };

  if (!trimmed) {
    return <p className="text-muted-foreground">{messages.desktop.shell.noWorkspace}</p>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      {embedError ? (
        <div className="flex shrink-0 flex-col gap-2">
          <p className="text-xs text-destructive">{embedError}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEmbedErrorResult({ key: terminalSessionKey, message: null });
                setRetryNonce((value) => value + 1);
              }}
            >
              {messages.desktop.shell.retry}
            </Button>
            {bridge?.openSystemTerminal ? (
              <Button type="button" variant="secondary" size="sm" onClick={openExternal}>
                {messages.desktop.shell.openSystemTerminal}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={cn(
          "workspace-terminal-xterm min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border/40 bg-background",
          embedError ? "hidden" : "block",
        )}
      />
    </div>
  );
}
