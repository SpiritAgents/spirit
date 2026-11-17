import { normalizeBrowserUrl } from "@/lib/browser-url";

export type TryHandleDesktopWorkspaceLinkOptions = {
  hostKind?: "electron" | "web";
};
export type DesktopWorkspaceLinkHandlers = {
  openUrl: (url: string) => void;
};

/** Route web links through declared extension handlers before opening a browser tab. */
export function tryHandleDesktopWorkspaceLink(
  href: string,
  handlers: DesktopWorkspaceLinkHandlers,
  options?: TryHandleDesktopWorkspaceLinkOptions,
): boolean {
  if (options?.hostKind !== "electron" || href.trim().startsWith("#")) return false;
  const url = normalizeBrowserUrl(href);
  if (!url) return false;
  handlers.openUrl(url);
  return true;
}
