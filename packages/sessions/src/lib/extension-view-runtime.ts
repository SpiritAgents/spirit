import type { DesktopExtensionDesktopViewChrome } from "@/types";

export interface ExtensionViewOpenRequest {
  requestId: string;
  extensionId: string;
  viewId: string;
  viewUrl: string;
  title?: string;
  width?: number;
  height?: number;
  chrome?: DesktopExtensionDesktopViewChrome;
  params?: unknown;
}

type OpenListener = () => void;

let current: ExtensionViewOpenRequest | null = null;
let pending:
  | {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  | undefined;
const listeners = new Set<OpenListener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getOpenExtensionView(): ExtensionViewOpenRequest | null {
  return current;
}

export function subscribeOpenExtensionView(listener: OpenListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openExtensionView(
  request: Omit<ExtensionViewOpenRequest, "requestId"> & { requestId?: string },
): Promise<unknown> {
  if (pending) {
    pending.reject(new Error("Another extension view is already open."));
    pending = undefined;
  }

  const requestId = request.requestId ?? crypto.randomUUID();
  current = { ...request, requestId };
  const promise = new Promise<unknown>((resolve, reject) => {
    pending = { resolve, reject };
  });
  emit();
  return promise;
}

export function resolveOpenExtensionView(requestId: string, result: unknown): void {
  if (!current || current.requestId !== requestId || !pending) {
    return;
  }
  pending.resolve(result);
  current = null;
  pending = undefined;
  emit();
}

export function dismissOpenExtensionView(requestId: string): void {
  resolveOpenExtensionView(requestId, { dismissed: true });
}

export function closeOpenExtensionViewsForExtension(extensionId: string): void {
  if (current?.extensionId !== extensionId) {
    return;
  }
  dismissOpenExtensionView(current.requestId);
}

export function closeAllOpenExtensionViews(): void {
  if (!current) {
    return;
  }
  dismissOpenExtensionView(current.requestId);
}
