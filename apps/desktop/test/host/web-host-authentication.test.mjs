import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createDesktopHttpRequestHandler,
  isAllowedRequestHostHeader,
} from "../../dist-electron/electron/http-host.js";
import { hashRemoteControlToken } from "@spiritagent/remote-control";
import {
  closeDesktopWebHostDeviceConnections,
  isDesktopWebHostDeviceOnline,
  registerDesktopWebHostDeviceConnection,
} from "../../../../packages/sessions/dist/host/web-host-state.js";

function makeRequest({ method, url, host = "127.0.0.1:7788", body, token, userAgent, ip }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    headers: {
      ...(host === null ? {} : { host }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
    socket: { remoteAddress: ip ?? "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers ?? {});
    },
    end(payload) {
      this.body = payload === undefined ? "" : String(payload);
    },
    once() {},
  };
}

function makeDevice(id, token) {
  return {
    id,
    tokenHash: hashRemoteControlToken(token),
    name: `Device ${id}`,
    createdAt: "2026-01-02T03:04:05.000Z",
  };
}

function makeHandler(devices) {
  const state = { devices, commands: [], access: [], pendingToken: undefined };
  const handler = createDesktopHttpRequestHandler({
    host: "127.0.0.1",
    invokeHostCommand: async (command, payload) => {
      state.commands.push({ command, payload });
      return {};
    },
    auth: {
      requestAccess: async (token, metadata) => {
        state.access.push({ token, metadata });
        if (state.pendingToken === token) {
          return { code: "DEVICE_APPROVAL_REQUIRED", pairingId: "pending-device" };
        }
        const device = state.devices.find(
          (candidate) => candidate.tokenHash === hashRemoteControlToken(token),
        );
        return device ? { code: "OK", device } : { code: "TOKEN_REQUIRED" };
      },
    },
  });
  return { handler, state };
}

async function request(handler, options) {
  const response = makeResponse();
  await handler(makeRequest(options), response);
  return response;
}

const deviceA = makeDevice("device-a", "fake-token-a");
const deviceB = makeDevice("device-b", "fake-token-b");

test("requires a valid device token for every API, including health", async () => {
  const { handler } = makeHandler([deviceA]);
  for (const options of [
    { method: "GET", url: "/api/health" },
    { method: "GET", url: "/api/health", token: "invalid-token" },
  ]) {
    const response = await request(handler, options);
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).code, "TOKEN_REQUIRED");
  }
});

test("allows independently authenticated devices concurrently", async () => {
  const { handler } = makeHandler([deviceA, deviceB]);
  const [first, second] = await Promise.all([
    request(handler, { method: "GET", url: "/api/health", token: "fake-token-a" }),
    request(handler, { method: "GET", url: "/api/health", token: "fake-token-b" }),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
});

test("rejects a removed device without affecting other devices", async () => {
  const { handler, state } = makeHandler([deviceA, deviceB]);
  state.devices = state.devices.filter((device) => device.id !== deviceA.id);

  const revoked = await request(handler, {
    method: "GET",
    url: "/api/health",
    token: "fake-token-a",
  });
  const allowed = await request(handler, {
    method: "GET",
    url: "/api/health",
    token: "fake-token-b",
  });
  assert.equal(revoked.statusCode, 401);
  assert.equal(allowed.statusCode, 200);
});

test("removes pairing routes instead of accepting legacy enrollment", async () => {
  const { handler } = makeHandler([deviceA]);
  const response = await request(handler, {
    method: "POST",
    url: "/api/pairing",
    token: "fake-token-a",
    body: { code: "123456" },
  });
  assert.equal(response.statusCode, 404);
});

test("records connection metadata against the same device identity", async () => {
  const { handler, state } = makeHandler([deviceA]);
  const response = await request(handler, {
    method: "POST",
    url: "/api/bootstrap",
    token: "fake-token-a",
    userAgent: "Example Agent",
    ip: "127.0.0.1",
    body: {},
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(state.access[0].metadata, {
    userAgent: "Example Agent",
    ip: "127.0.0.1",
    recordConnection: true,
  });
  assert.equal(state.commands[0].command, "bootstrap");
  assert.equal(state.devices.length, 1);
});

test("returns approval-required without running business commands for a pending token", async () => {
  const { handler, state } = makeHandler([]);
  state.pendingToken = "pending-fake-token";
  const response = await request(handler, {
    method: "POST",
    url: "/api/bootstrap",
    token: "pending-fake-token",
    body: {},
  });
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).code, "DEVICE_APPROVAL_REQUIRED");
  assert.equal(state.commands.length, 0);
});

test("API requests retain Host header validation before token authentication", async () => {
  const { handler } = makeHandler([deviceA]);
  const rejected = await request(handler, {
    method: "GET",
    url: "/api/health",
    host: "attacker.example.com:7788",
    token: "fake-token-a",
  });
  const missing = await request(handler, {
    method: "GET",
    url: "/api/health",
    host: null,
    token: "fake-token-a",
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(missing.statusCode, 403);
});

test("isAllowedRequestHostHeader keeps configured host and wildcard rules", () => {
  assert.equal(isAllowedRequestHostHeader("127.0.0.1:7788", "127.0.0.1"), true);
  assert.equal(isAllowedRequestHostHeader("localhost", "127.0.0.1"), true);
  assert.equal(isAllowedRequestHostHeader("myhost.lan:7788", "myhost.lan"), true);
  assert.equal(isAllowedRequestHostHeader("attacker.com", "127.0.0.1"), false);
  assert.equal(isAllowedRequestHostHeader("192.168.1.5:7788", "192.168.1.5"), true);
  assert.equal(isAllowedRequestHostHeader("attacker.com:7788", "0.0.0.0"), false);
});

test("tracks concurrent streams and closes only the selected device connections", () => {
  let firstCloseCount = 0;
  let secondCloseCount = 0;
  const unregisterFirst = registerDesktopWebHostDeviceConnection(deviceA.id, () => {
    firstCloseCount += 1;
  });
  registerDesktopWebHostDeviceConnection(deviceA.id, () => {
    firstCloseCount += 1;
  });
  registerDesktopWebHostDeviceConnection(deviceB.id, () => {
    secondCloseCount += 1;
  });

  assert.equal(isDesktopWebHostDeviceOnline(deviceA.id), true);
  assert.equal(isDesktopWebHostDeviceOnline(deviceB.id), true);
  closeDesktopWebHostDeviceConnections(deviceA.id);
  assert.equal(firstCloseCount, 2);
  assert.equal(secondCloseCount, 0);
  assert.equal(isDesktopWebHostDeviceOnline(deviceA.id), false);
  assert.equal(isDesktopWebHostDeviceOnline(deviceB.id), true);

  unregisterFirst();
  closeDesktopWebHostDeviceConnections(deviceB.id);
  assert.equal(secondCloseCount, 1);

  registerDesktopWebHostDeviceConnection(deviceB.id, () => {
    secondCloseCount += 1;
  });
  assert.equal(secondCloseCount, 2);
  assert.equal(isDesktopWebHostDeviceOnline(deviceB.id), false);
});
