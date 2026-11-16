/** In-renderer navigation only; extension pages reach this through their validated page bridge. */
export const OPEN_EXTENSION_DETAILS_EVENT = "spirit-open-extension-details";

export function openExtensionDetails(extensionId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EXTENSION_DETAILS_EVENT, { detail: { extensionId } }));
}
