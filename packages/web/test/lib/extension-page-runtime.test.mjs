import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { test } from "vitest";

const source = stripTypeScriptTypes(
  await readFile(
    new URL("../../../extensions/src/extension-ui-kit/page-runtime.ts", import.meta.url),
    "utf8",
  ),
);

function runtime() {
  const listeners = new Map();
  const messages = [];
  const parent = { postMessage: (message) => messages.push(message) };
  const document = {
    documentElement: { setAttribute() {} },
    body: { getBoundingClientRect: () => ({ height: 200 }) },
    getElementById: () => undefined,
    createElement: () => ({}),
    head: { appendChild() {} },
  };
  const window = {
    addEventListener: (type, listener) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    parent,
    URLSearchParams,
    crypto: { randomUUID: () => "rpc-1" },
    location: {
      pathname: "/view/personal%2Fdemo/authorize/instance-1/index.html",
      search: "?channelId=channel-1",
    },
    ResizeObserver: class {
      observe() {}
    },
  });
  const identity = {
    extensionId: "personal/demo",
    contributionId: "authorize",
    instanceId: "instance-1",
    channelId: "channel-1",
  };
  const send = (data) =>
    listeners
      .get("message")
      .forEach((listener) => listener({ source: parent, data: { ...identity, ...data } }));
  const fire = (type, event = {}) =>
    listeners.get(type)?.forEach((listener) => listener({ target: window, ...event }));
  return { messages, page: window.spirit.view, send, document, fire };
}

test("context handshake is not a successful render; mounting is explicit", async () => {
  const { page, send, messages, document } = runtime();
  send({
    type: "spirit-extension-page-context",
    locale: "en",
    params: { step: 1 },
    theme: { htmlClassName: "dark", htmlStyle: "", cssText: ":root{--foreground:white}" },
  });
  assert.equal((await page.ready()).params.step, 1);
  assert.equal(document.documentElement.lang, "en");
  assert.equal(messages.filter((item) => item.type === "spirit-extension-page-ready").length, 0);
  page.mounted();
  assert.equal(messages.filter((item) => item.type === "spirit-extension-page-ready").length, 1);
});

test("parameter changes retain the runtime and closed pages reject outstanding requests", async () => {
  const { page, send } = runtime();
  const values = [];
  page.onContextChange((context) => values.push(context.params.step));
  const context = {
    type: "spirit-extension-page-context",
    locale: "en",
    theme: { htmlClassName: "", htmlStyle: "", cssText: "" },
  };
  send({ ...context, params: { step: 1 } });
  send({ ...context, channelId: "wrong", params: { step: 99 } });
  send({ ...context, params: { step: 2 } });
  assert.deepEqual(values, [1, 2]);
  const request = page.request("pending");
  send({ type: "spirit-extension-page-closed" });
  await assert.rejects(request, /closed/);
  await assert.rejects(page.request("late"), /closed/);
});

test("bootstrap errors are fatal but ordinary image failures are not", () => {
  const image = runtime();
  image.fire("error", { target: { tagName: "IMG" } });
  assert.equal(
    image.messages.some((message) => message.type === "spirit-extension-page-error"),
    false,
  );
  for (const event of [
    { target: { tagName: "SCRIPT" } },
    { target: { tagName: "LINK", rel: "stylesheet" } },
    { message: "Bootstrap crashed" },
  ]) {
    const boot = runtime();
    boot.fire("error", event);
    assert.equal(
      boot.messages.filter((message) => message.type === "spirit-extension-page-error").length,
      1,
    );
  }
  const rejected = runtime();
  rejected.fire("unhandledrejection", { reason: "Bootstrap rejected" });
  assert.equal(
    rejected.messages.filter((message) => message.type === "spirit-extension-page-error").length,
    1,
  );
});

test("mounted pages retain their UI after resource and unhandled request errors", () => {
  const { page, fire, messages } = runtime();
  page.mounted();
  fire("error", { target: { tagName: "IMG" } });
  fire("error", { message: "An optional widget failed" });
  fire("unhandledrejection", { reason: "An API request failed" });
  assert.equal(
    messages.some((message) => message.type === "spirit-extension-page-error"),
    false,
  );
  page.fail("Explicit fatal failure");
  assert.equal(
    messages.filter((message) => message.type === "spirit-extension-page-error").length,
    1,
  );
});
