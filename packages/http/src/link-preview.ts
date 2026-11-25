import { lookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type { LinkPreviewDocument } from "@spiritagent/api/types";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

export type FetchLinkPreviewDocumentOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Test-only: local fixtures may explicitly opt into private and loopback addresses. */
  allowPrivateNetwork?: boolean;
};

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b, c, d] = parts as [number, number, number, number];
  if (parts.some((part) => part < 0 || part > 255)) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function expandIpv6(address: string): number[] | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const ipv4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (ipv4Tail) {
    const bytes = ipv4Tail[1]!.split(".").map(Number);
    if (bytes.some((part) => part < 0 || part > 255)) return null;
    const high = ((bytes[0]! << 8) | bytes[1]!).toString(16);
    const low = ((bytes[2]! << 8) | bytes[3]!).toString(16);
    normalized = `${normalized.slice(0, ipv4Tail.index)}${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length >= 8) return null;
  const values = [
    ...head,
    ...Array.from({ length: 8 - head.length - tail.length }, () => "0"),
    ...tail,
  ];
  if (values.length !== 8 || values.some((value) => !/^[\da-f]{1,4}$/.test(value))) {
    return null;
  }
  return values.map((value) => Number.parseInt(value, 16));
}

export function isPublicLinkPreviewAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;
  const groups = expandIpv6(normalized);
  if (!groups) return false;

  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0);
  if (ipv4Mapped && (groups[5] === 0 || groups[5] === 0xffff)) {
    const ipv4 = [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".");
    return isPublicIpv4(ipv4);
  }

  const first = groups[0]!;
  if (first < 0x2000 || first >= 0x4000) return false;
  if (first === 0x2002) return false;
  if (first === 0x2001 && (groups[1] === 0 || groups[1] === 0xdb8)) return false;
  return true;
}

function normalizePreviewUrl(raw: string, allowPrivateNetwork: boolean): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Link previews only support HTTP(S) URLs.");
  }
  if (url.username || url.password) {
    throw new Error("Link preview URLs must not contain credentials.");
  }
  url.hash = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivateNetwork && isIP(hostname) && !isPublicLinkPreviewAddress(hostname)) {
    throw new Error("Link preview target is not a public address.");
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function createSafeLookup(allowPrivateNetwork: boolean): RequestOptions["lookup"] {
  return ((
    hostname: string,
    options: { family?: number; all?: boolean },
    callback: LookupCallback,
  ) => {
    lookup(
      hostname,
      { all: true, verbatim: true, family: options.family ?? 0 },
      (error, addresses) => {
        if (error) {
          callback(error, "", 0);
          return;
        }
        const selected = addresses[0];
        if (!selected) {
          callback(new Error("Link preview hostname did not resolve."), "", 0);
          return;
        }
        if (
          !allowPrivateNetwork &&
          addresses.some(({ address }) => !isPublicLinkPreviewAddress(address))
        ) {
          callback(new Error("Link preview hostname resolves to a non-public address."), "", 0);
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        callback(null, selected.address, selected.family);
      },
    );
  }) as RequestOptions["lookup"];
}

function openResponse(
  url: URL,
  options: FetchLinkPreviewDocumentOptions,
): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      agent: false,
      lookup: createSafeLookup(options.allowPrivateNetwork === true),
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "Spirit-Link-Preview",
      },
    });
    request.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new Error("Link preview request timed out."));
    });
    request.once("error", reject);
    request.once("response", resolve);
    request.end();
  });
}

async function readLimitedHtml(
  response: import("node:http").IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        throw new Error("Link preview document exceeds the size limit.");
      }
      chunks.push(buffer);
    }
  } finally {
    response.destroy();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchLinkPreviewDocument(
  rawUrl: string,
  options: FetchLinkPreviewDocumentOptions = {},
): Promise<LinkPreviewDocument> {
  const allowPrivateNetwork = options.allowPrivateNetwork === true;
  const originalUrl = normalizePreviewUrl(rawUrl, allowPrivateNetwork);
  let currentUrl = originalUrl;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await openResponse(currentUrl, options);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();
      if (!location) throw new Error("Link preview redirect is missing a location.");
      if (redirects === maxRedirects) {
        throw new Error("Link preview exceeded the redirect limit.");
      }
      currentUrl = normalizePreviewUrl(
        new URL(location, currentUrl).toString(),
        allowPrivateNetwork,
      );
      continue;
    }

    const contentType = (response.headers["content-type"] ?? "").split(";", 1)[0]!.toLowerCase();
    if (status < 200 || status >= 300) {
      response.resume();
      throw new Error(`Link preview request failed with status ${status}.`);
    }
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      response.resume();
      throw new Error("Link preview target is not an HTML document.");
    }

    const raw = await readLimitedHtml(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    const headEnd = /<\/head\s*>/i.exec(raw);
    return {
      url: originalUrl.toString(),
      finalUrl: currentUrl.toString(),
      headHtml: headEnd ? raw.slice(0, headEnd.index + headEnd[0].length) : raw,
    };
  }
  throw new Error("Link preview exceeded the redirect limit.");
}
