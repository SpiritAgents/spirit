import { lookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import {
  isLoopbackLinkPreviewHostname,
  isPublicLinkPreviewAddress,
} from "@spiritagent/api/link-preview";
import type { LinkPreviewDocument } from "@spiritagent/api/types";

export { isPublicLinkPreviewAddress } from "@spiritagent/api/link-preview";

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

function normalizePreviewUrl(
  raw: string,
  allowPrivateNetwork: boolean,
  allowLoopback: boolean,
): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Link previews only support HTTP(S) URLs.");
  }
  if (url.username || url.password) {
    throw new Error("Link preview URLs must not contain credentials.");
  }
  url.hash = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !allowPrivateNetwork &&
    !allowLoopback &&
    isIP(hostname) &&
    !isPublicLinkPreviewAddress(hostname)
  ) {
    throw new Error("Link preview target is not a public address.");
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function createSafeLookup(
  allowPrivateNetwork: boolean,
  allowLoopback: boolean,
): RequestOptions["lookup"] {
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
          addresses.some(({ address }) =>
            allowLoopback
              ? !isLoopbackLinkPreviewHostname(address)
              : !isPublicLinkPreviewAddress(address),
          )
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
  allowLoopback: boolean,
): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      agent: false,
      lookup: createSafeLookup(options.allowPrivateNetwork === true, allowLoopback),
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
  const initialUrl = new URL(rawUrl.trim());
  const loopbackOrigin = isLoopbackLinkPreviewHostname(initialUrl.hostname)
    ? initialUrl.origin
    : null;
  const originalUrl = normalizePreviewUrl(rawUrl, allowPrivateNetwork, loopbackOrigin !== null);
  let currentUrl = originalUrl;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const allowLoopback = currentUrl.origin === loopbackOrigin;
    const response = await openResponse(currentUrl, options, allowLoopback);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.destroy();
      if (!location) throw new Error("Link preview redirect is missing a location.");
      if (redirects === maxRedirects) {
        throw new Error("Link preview exceeded the redirect limit.");
      }
      const nextUrl = new URL(location, currentUrl);
      currentUrl = normalizePreviewUrl(
        nextUrl.toString(),
        allowPrivateNetwork,
        nextUrl.origin === loopbackOrigin,
      );
      continue;
    }

    const contentType = (response.headers["content-type"] ?? "").split(";", 1)[0]!.toLowerCase();
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new Error(`Link preview request failed with status ${status}.`);
    }
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      response.destroy();
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
