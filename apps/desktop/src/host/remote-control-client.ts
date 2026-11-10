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
  let stopped = false;
  let attaching = false;
  let unsubscribeNotifications: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const attach = async () => {
    if (stopped || attaching) return;
    attaching = true;
    try {
      const client = await sharedDesktopServerClient(dataDir);
      unsubscribeNotifications = client.onNotification((notification) => {
        if (notification.method === "remote.updated") handlers.onUpdated?.();
        if (notification.method === "remote.confirmationRequested") {
          handlers.onConfirmationRequested?.();
        }
      });
      client.onDisconnect(() => {
        if (stopped) return;
        unsubscribeNotifications?.();
        unsubscribeNotifications = undefined;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void attach();
        }, 250);
      });
    } catch {
      if (!stopped) {
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void attach();
        }, 250);
      }
    } finally {
      attaching = false;
    }
  };

  await attach();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    unsubscribeNotifications?.();
  };
}
