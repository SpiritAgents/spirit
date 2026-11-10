import type { SidebarSessionDragPayload } from "@/contexts/conversation-split-context";

export const SIDEBAR_SESSION_DRAG_MIME = "application/x-spirit-sidebar-session";

export function setSidebarSessionDragData(
  dataTransfer: DataTransfer,
  payload: SidebarSessionDragPayload,
): void {
  dataTransfer.setData(SIDEBAR_SESSION_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copy";
}

export function parseSidebarSessionDragData(
  dataTransfer: DataTransfer,
): SidebarSessionDragPayload | null {
  const raw = dataTransfer.getData(SIDEBAR_SESSION_DRAG_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SidebarSessionDragPayload;
    if (
      parsed.kind === "stored" &&
      typeof parsed.sessionPath === "string" &&
      parsed.sessionPath.trim()
    ) {
      return { kind: "stored", sessionPath: parsed.sessionPath.trim() };
    }
    if (parsed.kind === "new") {
      return { kind: "new" };
    }
    if (
      parsed.kind === "new-in-workspace" &&
      typeof parsed.workspaceRoot === "string" &&
      parsed.workspaceRoot.trim()
    ) {
      return { kind: "new-in-workspace", workspaceRoot: parsed.workspaceRoot.trim() };
    }
  } catch {
    // Invalid drag payload.
  }
  return null;
}

export function isSidebarSessionDragBlockedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [role="menuitem"], [data-no-session-drag]'))
  );
}
