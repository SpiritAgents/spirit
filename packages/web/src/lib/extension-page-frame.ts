import { product } from "@spiritagent/product";

export const SPIRIT_EXTENSION_UI_ORIGIN = `${product.urlProtocol}://extension-ui`;
export const EXTENSION_PAGE_READY_REQUEST = "spirit-extension-page-ready-request";
export const EXTENSION_PAGE_READY = "spirit-extension-page-ready";
export const EXTENSION_PAGE_ERROR = "spirit-extension-page-error";
export const EXTENSION_PAGE_CONTEXT = "spirit-extension-page-context";
export const EXTENSION_PAGE_REQUEST = "spirit-extension-page-request";
export const EXTENSION_PAGE_RESULT = "spirit-extension-page-result";
export const EXTENSION_PAGE_EVENT = "spirit-extension-page-event";
export const EXTENSION_PAGE_CLOSED = "spirit-extension-page-closed";
export const EXTENSION_PAGE_CLOSE = "spirit-extension-page-close";
export const EXTENSION_PAGE_SIZE = "spirit-extension-page-size";

export interface ExtensionPageIdentity {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
}

export function extensionPageUrl(kind: "tab" | "view", identity: ExtensionPageIdentity): string {
  const { extensionId, contributionId, instanceId, channelId } = identity;
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/${kind}/${encodeURIComponent(extensionId)}/${encodeURIComponent(contributionId)}/${encodeURIComponent(instanceId)}/index.html?channelId=${encodeURIComponent(channelId)}`;
}

export function matchesExtensionPageIdentity(
  value: unknown,
  identity: ExtensionPageIdentity,
): value is ExtensionPageIdentity & Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.extensionId === identity.extensionId &&
    data.contributionId === identity.contributionId &&
    data.instanceId === identity.instanceId &&
    data.channelId === identity.channelId
  );
}
