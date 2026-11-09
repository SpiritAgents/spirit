import {
  buildRemoteControlUrl,
  createRemoteControlQrCode,
  createRemoteControlToken,
  hashRemoteControlToken,
} from "@spiritagent/remote-control";

export function createDesktopWebDeviceToken(): string {
  return createRemoteControlToken();
}

export function hashDesktopWebDeviceToken(token: string): string {
  return hashRemoteControlToken(token);
}

export function buildDesktopWebDeviceUrl(origin: string, token: string): string {
  return buildRemoteControlUrl(origin, token);
}

export async function createDesktopWebDeviceQrCodeSvg(url: string): Promise<string> {
  return createRemoteControlQrCode(url, "svg");
}
