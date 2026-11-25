import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, test } from "vitest";

import { fetchLinkPreviewDocument, isPublicLinkPreviewAddress } from "./link-preview.js";

const servers: Server[] = [];

async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

test("reads only the document head from an explicitly allowed loopback fixture", async () => {
  const origin = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<html><head><title>Fixture</title></head><body>ignored</body></html>");
  });
  const document = await fetchLinkPreviewDocument(`${origin}/page#section`, {
    allowPrivateNetwork: true,
  });
  assert.equal(document.url, `${origin}/page`);
  assert.equal(document.finalUrl, `${origin}/page`);
  assert.equal(document.headHtml, "<html><head><title>Fixture</title></head>");
});

test("resolves same-origin redirects and reports the final URL", async () => {
  const origin = await fixture((request, response) => {
    if (request.url === "/start") {
      response.writeHead(302, { Location: "/final" });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/xhtml+xml" });
    response.end("<head><title>Final</title></head>");
  });
  const document = await fetchLinkPreviewDocument(`${origin}/start`, {
    allowPrivateNetwork: true,
  });
  assert.equal(document.finalUrl, `${origin}/final`);
  assert.equal(document.headHtml, "<head><title>Final</title></head>");
});

test("resolves hostnames when Node requests all candidate addresses", async () => {
  const origin = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<head><title>Hostname</title></head>");
  });
  const url = new URL(origin);
  url.hostname = "localhost";
  const document = await fetchLinkPreviewDocument(url.toString(), { allowPrivateNetwork: true });
  assert.equal(document.headHtml, "<head><title>Hostname</title></head>");
});

test("rejects private targets and credentials without reaching the fixture", async () => {
  let requests = 0;
  const origin = await fixture((_request, response) => {
    requests += 1;
    response.end("ok");
  });
  const port = new URL(origin).port;
  for (const url of [
    origin,
    `http://localhost:${port}/`,
    "http://[::ffff:127.0.0.1]/",
    `http://user:secret@127.0.0.1:${port}/`,
  ]) {
    await assert.rejects(fetchLinkPreviewDocument(url));
  }
  assert.equal(requests, 0);
});

test("rejects non-HTML responses", async () => {
  const origin = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  await assert.rejects(
    fetchLinkPreviewDocument(origin, { allowPrivateNetwork: true }),
    /not an HTML document/,
  );
});

test("enforces the document size limit", async () => {
  const origin = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<head><title>This title exceeds the test limit</title></head>");
  });
  await assert.rejects(
    fetchLinkPreviewDocument(origin, { allowPrivateNetwork: true, maxBytes: 16 }),
    /size limit/,
  );
});

test("aborts requests that exceed the deadline", async () => {
  const origin = await fixture(() => {});
  await assert.rejects(
    fetchLinkPreviewDocument(origin, { allowPrivateNetwork: true, timeoutMs: 20 }),
    /timed out|aborted/i,
  );
});

test("classifies public and special-use IP addresses", () => {
  assert.equal(isPublicLinkPreviewAddress("8.8.8.8"), true);
  assert.equal(isPublicLinkPreviewAddress("2606:4700:4700::1111"), true);
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "198.18.0.1",
    "203.0.113.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002::1",
  ]) {
    assert.equal(isPublicLinkPreviewAddress(address), false, address);
  }
});
