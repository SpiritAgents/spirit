import type { RemoteControlAccessResult } from "@spiritagent/remote-control";
import { sharedDesktopServerClient } from "./remote-runtime.js";

export async function callDesktopRemoteControl<T = unknown>(
  dataDir: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const client = await sharedDesktopServerClient(dataDir);
  return client.call<T>(method, params);
}

export function requestDesktopRemoteControlAccess(
  dataDir: string,
  token: string,
  metadata: { userAgent?: string; ip?: string; recordConnection?: boolean },
): Promise<RemoteControlAccessResult> {
  return callDesktopRemoteControl<RemoteControlAccessResult>(dataDir, "remote.requestAccess", {
    token,
    ...metadata,
  });
}

export async function subscribeDesktopRemoteControl(
  dataDir: string,
  handlers: { onUpdated?: () => void; onConfirmationRequested?: () => void },
): Promise<() => void> {
  const client = await sharedDesktopServerClient(dataDir);
  return client.onNotification((notification) => {
    if (notification.method === "remote.updated") handlers.onUpdated?.();
    if (notification.method === "remote.confirmationRequested") {
      handlers.onConfirmationRequested?.();
    }
  });
}
