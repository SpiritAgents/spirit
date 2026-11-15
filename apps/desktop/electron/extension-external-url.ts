const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertExtensionExternalUrl(value: string): URL {
  const url = new URL(value);
  const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new Error("Extension external URLs must use HTTPS or loopback HTTP.");
  }
  return url;
}
