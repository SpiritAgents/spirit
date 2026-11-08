import { createHash, randomBytes } from "node:crypto";
import { toString as renderQrCode } from "qrcode";

export function createDesktopWebDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDesktopWebDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildDesktopWebDeviceUrl(origin: string, token: string): string {
  const url = new URL(origin);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("A root HTTP(S) Remote Control origin is required.");
  }
  url.searchParams.set("token", token);
  return url.toString();
}

export async function createDesktopWebDeviceQrCodeSvg(url: string): Promise<string> {
  return renderQrCode(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}
