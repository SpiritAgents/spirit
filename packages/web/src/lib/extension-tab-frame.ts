import { extensionPageUrl, SPIRIT_EXTENSION_UI_ORIGIN } from "@/lib/extension-page-frame";

export {
  EXTENSION_PAGE_READY_REQUEST as SPIRIT_EXTENSION_TAB_READY_REQUEST,
  EXTENSION_PAGE_READY as SPIRIT_EXTENSION_TAB_READY,
  EXTENSION_PAGE_CONTEXT as SPIRIT_EXTENSION_TAB_CONTEXT,
  EXTENSION_PAGE_REQUEST as SPIRIT_EXTENSION_TAB_REQUEST,
  EXTENSION_PAGE_RESULT as SPIRIT_EXTENSION_TAB_RESULT,
  EXTENSION_PAGE_EVENT as SPIRIT_EXTENSION_TAB_EVENT,
  EXTENSION_PAGE_CLOSED as SPIRIT_EXTENSION_TAB_CLOSED,
} from "./extension-page-frame";

export function extensionTabPageUrl(input: {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
}): string {
  return extensionPageUrl("tab", input);
}

export function extensionTabPackagedIconUrl(extensionId: string, iconPath: string): string {
  const path = iconPath.split("/").map(encodeURIComponent).join("/");
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/tab-icon/${encodeURIComponent(extensionId)}/${path}`;
}

export const SPIRIT_EXTENSION_TAB_CHROME = "spirit-extension-tab-chrome";
export const SPIRIT_EXTENSION_WEB_VIEW_REQUEST = "spirit-extension-web-view-request";
export const SPIRIT_EXTENSION_WEB_VIEW_RESULT = "spirit-extension-web-view-result";
export const SPIRIT_EXTENSION_WEB_VIEW_EVENT = "spirit-extension-web-view-event";
