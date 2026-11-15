import { SPIRIT_EXTENSION_UI_ORIGIN } from "@/lib/extension-view-frame";

export const SPIRIT_EXTENSION_TAB_READY_REQUEST = "spirit-extension-tab-ready-request";
export const SPIRIT_EXTENSION_TAB_READY = "spirit-extension-tab-ready";
export const SPIRIT_EXTENSION_TAB_CONTEXT = "spirit-extension-tab-context";

export function extensionTabPageUrl(input: {
  extensionId: string;
  contributionId: string;
  instanceId: string;
}): string {
  const extension = encodeURIComponent(input.extensionId);
  const contribution = encodeURIComponent(input.contributionId);
  const instance = encodeURIComponent(input.instanceId);
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/tab/${extension}/${contribution}/${instance}/index.html`;
}

export function extensionTabPackagedIconUrl(extensionId: string, iconPath: string): string {
  const path = iconPath.split("/").map(encodeURIComponent).join("/");
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/tab-icon/${encodeURIComponent(extensionId)}/${path}`;
}
