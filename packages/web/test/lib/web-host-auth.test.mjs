/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createWebHostApi } from "../../src/adapters/web.ts";

const storageKey = "spirit-web-host-token";

beforeEach(() => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  vi.stubGlobal("localStorage", storage);
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("consumes a query token before bootstrap and pageUrl serialization", async () => {
  window.localStorage.setItem(storageKey, "previous-fake-token");
  window.history.replaceState({}, "", "/?token=query-fake-token&keep=1#remote");
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);

  const api = createWebHostApi();
  assert.equal(window.location.search, "?keep=1");
  assert.equal(window.location.hash, "#remote");
  assert.equal(window.localStorage.getItem(storageKey), "query-fake-token");
  await api.bootstrap();

  const [, init] = fetchMock.mock.calls[0];
  assert.equal(init.headers.Authorization, "Bearer query-fake-token");
  const body = JSON.parse(init.body);
  assert.equal(body.clientHost.pageUrl.includes("token="), false);
  assert.equal(body.clientHost.pageUrl.includes("keep=1"), true);
});

test("reuses a stored device token on subsequent visits", async () => {
  window.localStorage.setItem(storageKey, "stored-fake-token");
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);

  createWebHostApi().bootstrap();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [, init] = fetchMock.mock.calls[0];
  assert.equal(init.headers.Authorization, "Bearer stored-fake-token");
});

test("clears a rejected token and stops event-stream retries", async () => {
  window.localStorage.setItem(storageKey, "revoked-fake-token");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(jsonResponse({ code: "TOKEN_REQUIRED", error: "Unauthorized" }, 401));
  vi.stubGlobal("fetch", fetchMock);
  const onError = vi.fn();
  const api = createWebHostApi();

  const unsubscribe = api.subscribeDreamUpdates(() => {}, onError);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  assert.equal(window.localStorage.getItem(storageKey), null);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(onError.mock.calls[0][0].code, "TOKEN_REQUIRED");
  unsubscribe();
});

test("an empty query token clears a stale credential before bootstrap", async () => {
  window.localStorage.setItem(storageKey, "stale-fake-token");
  window.history.replaceState({}, "", "/?token=");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(jsonResponse({ code: "TOKEN_REQUIRED", error: "Unauthorized" }, 401));
  vi.stubGlobal("fetch", fetchMock);

  const api = createWebHostApi();
  assert.equal(window.location.search, "");
  assert.equal(window.localStorage.getItem(storageKey), null);
  await assert.rejects(api.bootstrap(), (error) => {
    assert.equal(error.code, "TOKEN_REQUIRED");
    return true;
  });
  const [, init] = fetchMock.mock.calls[0];
  assert.equal(init.headers.Authorization, undefined);
});

test("waits for pairing approval without clearing the device token", async () => {
  vi.useFakeTimers();
  window.localStorage.setItem(storageKey, "pending-fake-token");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ code: "DEVICE_APPROVAL_REQUIRED" }, 403))
    .mockResolvedValueOnce(jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);

  const bootstrap = createWebHostApi().bootstrap();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(fetchMock.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1000);
  await bootstrap;
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(window.localStorage.getItem(storageKey), "pending-fake-token");
  vi.useRealTimers();
});

test("keeps waiting through approval-required before stopping on a rotated token", async () => {
  vi.useFakeTimers();
  window.localStorage.setItem(storageKey, "pending-fake-token");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ code: "DEVICE_APPROVAL_REQUIRED" }, 403))
    .mockResolvedValueOnce(jsonResponse({ code: "TOKEN_REQUIRED", error: "Unauthorized" }, 401));
  vi.stubGlobal("fetch", fetchMock);
  const onError = vi.fn();
  const api = createWebHostApi();

  const unsubscribe = api.subscribeDreamUpdates(() => {}, onError);
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(fetchMock.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1000);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(window.localStorage.getItem(storageKey), null);
  unsubscribe();
  vi.useRealTimers();
});
