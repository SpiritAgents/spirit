import { createHash, randomBytes } from "node:crypto";
import { toString as renderQrCode } from "qrcode";
import { inferRemoteControlDevicePresentation } from "./presentation.js";

export function createRemoteControlToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRemoteControlToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildRemoteControlUrl(origin: string, token: string): string {
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

export async function createRemoteControlQrCode(
  url: string,
  output: "svg" | "terminal",
): Promise<string> {
  return output === "svg"
    ? renderQrCode(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 })
    : renderQrCode(url, { type: "terminal", small: true });
}

// TODO: Native apps should declare their client identity explicitly; only then show
// Phone/Pad icons or "Spirit App" instead of guessing from a browser user agent.
export function remoteControlDeviceLabel(userAgent?: string, fallback = "This Device"): string {
  const value = inferRemoteControlDevicePresentation(userAgent);
  const platform = value.mobile ?? value.system;
  if (platform && value.browser) return `${platform} / ${value.browser}`;
  return platform ?? value.browser ?? fallback;
}
