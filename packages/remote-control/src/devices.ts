import { createHash, randomBytes } from "node:crypto";
import { create as createQrCode, toString as renderQrCode } from "qrcode";
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
    ? renderRoundedQrCodeSvg(url)
    : renderQrCode(url, { type: "terminal", small: true });
}

const qrMargin = 1;

function renderRoundedQrCodeSvg(url: string): string {
  const { modules } = createQrCode(url, { errorCorrectionLevel: "M" });
  const size = modules.size;
  const dimension = size + qrMargin * 2;
  const modulesSvg: string[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!modules.get(row, column) || isFinderModule(row, column, size)) continue;
      modulesSvg.push(
        `<circle cx="${column + qrMargin + 0.5}" cy="${row + qrMargin + 0.5}" r="0.42"/>`,
      );
    }
  }

  // Only the SVG geometry changes; qrcode still owns encoding and the module matrix.
  const finderSvg = [
    renderFinder(qrMargin, qrMargin),
    renderFinder(size - 7 + qrMargin, qrMargin),
    renderFinder(qrMargin, size - 7 + qrMargin),
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="geometricPrecision"><rect width="${dimension}" height="${dimension}" fill="#fff"/><g fill="#000">${modulesSvg.join("")}${finderSvg}</g></svg>\n`;
}

function isFinderModule(row: number, column: number, size: number): boolean {
  const inLeft = column < 7;
  const inRight = column >= size - 7;
  const inTop = row < 7;
  const inBottom = row >= size - 7;
  return (inTop && (inLeft || inRight)) || (inBottom && inLeft);
}

function renderFinder(x: number, y: number): string {
  return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.25" fill="none" stroke="#000" stroke-width="1"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5"/>`;
}

// TODO: Native apps should declare their client identity explicitly; only then show
// Phone/Pad icons or "Spirit App" instead of guessing from a browser user agent.
export function remoteControlDeviceLabel(userAgent?: string, fallback = "This Device"): string {
  const value = inferRemoteControlDevicePresentation(userAgent);
  const platform = value.mobile ?? value.system;
  if (platform && value.browser) return `${platform} / ${value.browser}`;
  return platform ?? value.browser ?? fallback;
}
