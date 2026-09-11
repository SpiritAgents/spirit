export const SPIRIT_NOTIFICATION_PROTOCOL = "spirit";

export type SpiritNotificationProtocolHandlers = {
  onFocus?: () => void;
  onNewSession?: () => void;
  onOpenSession?: (sessionPath: string) => void | Promise<void>;
};

export function parseSpiritNotificationProtocolUrl(raw: string): null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${SPIRIT_NOTIFICATION_PROTOCOL}:`) {
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export function findSpiritNotificationProtocolUrl(argv: readonly string[]): string | undefined {
  return argv.find((entry) => entry.startsWith(`${SPIRIT_NOTIFICATION_PROTOCOL}://`));
}

/** Leftover spirit:// notification / Jump List URLs are not a live entry. */
export function dispatchSpiritNotificationProtocolUrl(
  rawUrl: string,
  handlers: SpiritNotificationProtocolHandlers | undefined,
): boolean {
  return handlers !== undefined && parseSpiritNotificationProtocolUrl(rawUrl) !== null;
}

export function handleSpiritNotificationProtocolArgv(
  argv: readonly string[],
  handlers: SpiritNotificationProtocolHandlers | undefined,
): boolean {
  const rawUrl = findSpiritNotificationProtocolUrl(argv);
  if (!rawUrl) {
    return false;
  }
  return dispatchSpiritNotificationProtocolUrl(rawUrl, handlers);
}
