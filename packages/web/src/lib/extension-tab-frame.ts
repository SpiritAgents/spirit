import { SPIRIT_EXTENSION_UI_ORIGIN } from "@/lib/extension-view-frame";

export const SPIRIT_EXTENSION_TAB_READY_REQUEST = "spirit-extension-tab-ready-request";
export const SPIRIT_EXTENSION_TAB_READY = "spirit-extension-tab-ready";
export const SPIRIT_EXTENSION_TAB_CONTEXT = "spirit-extension-tab-context";

export function extensionTabPageUrl(input: {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
}): string {
  const extension = encodeURIComponent(input.extensionId);
  const contribution = encodeURIComponent(input.contributionId);
  const instance = encodeURIComponent(input.instanceId);
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/tab/${extension}/${contribution}/${instance}/index.html?channelId=${encodeURIComponent(input.channelId)}`;
}

export function extensionTabPackagedIconUrl(extensionId: string, iconPath: string): string {
  const path = iconPath.split("/").map(encodeURIComponent).join("/");
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/tab-icon/${encodeURIComponent(extensionId)}/${path}`;
}

export const SPIRIT_EXTENSION_TAB_REQUEST = "spirit-extension-tab-request";
export const SPIRIT_EXTENSION_TAB_RESULT = "spirit-extension-tab-result";
export const SPIRIT_EXTENSION_TAB_EVENT = "spirit-extension-tab-event";
export const SPIRIT_EXTENSION_TAB_CHROME = "spirit-extension-tab-chrome";
export const SPIRIT_EXTENSION_TAB_CLOSED = "spirit-extension-tab-closed";
export const SPIRIT_EXTENSION_WEB_VIEW_REQUEST = "spirit-extension-web-view-request";
export const SPIRIT_EXTENSION_WEB_VIEW_RESULT = "spirit-extension-web-view-result";
export const SPIRIT_EXTENSION_WEB_VIEW_EVENT = "spirit-extension-web-view-event";
