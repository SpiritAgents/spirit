import assert from "node:assert/strict";
import { test } from "vitest";

import {
  dispatchSpiritNotificationProtocolUrl,
  findSpiritNotificationProtocolUrl,
  handleSpiritNotificationProtocolArgv,
  parseSpiritNotificationProtocolUrl,
} from "../../src/lib/spirit-notification-protocol.ts";

const leftoverUrls = [
  "spirit://notification-approval?decision=allow",
  "spirit://notification-approval?decision=deny&tag=spirit-approval",
  "spirit://notification-focus",
  "spirit://new-session",
  "spirit://open-session?path=C%3A%5Csessions%5Ca.json",
];

test("parseSpiritNotificationProtocolUrl ignores leftover notification and Jump List URLs", () => {
  for (const url of leftoverUrls) {
    assert.equal(parseSpiritNotificationProtocolUrl(url), null);
  }
});

test("dispatchSpiritNotificationProtocolUrl does not open leftover protocol URLs", () => {
  let dispatched = false;
  const handlers = {
    onFocus: () => {
      dispatched = true;
    },
    onNewSession: () => {
      dispatched = true;
    },
    onOpenSession: () => {
      dispatched = true;
    },
  };
  for (const url of leftoverUrls) {
    assert.equal(dispatchSpiritNotificationProtocolUrl(url, handlers), false);
  }
  assert.equal(dispatched, false);
});

test("handleSpiritNotificationProtocolArgv ignores leftover protocol URLs", () => {
  let dispatched = false;
  assert.equal(
    handleSpiritNotificationProtocolArgv(
      ["spirit.exe", "spirit://open-session?path=C%3A%5Cevil.json"],
      {
        onOpenSession: () => {
          dispatched = true;
        },
      },
    ),
    false,
  );
  assert.equal(
    handleSpiritNotificationProtocolArgv(["spirit.exe", "spirit://new-session"], {
      onNewSession: () => {
        dispatched = true;
      },
    }),
    false,
  );
  assert.equal(dispatched, false);
});

test("findSpiritNotificationProtocolUrl still scans argv", () => {
  assert.equal(
    findSpiritNotificationProtocolUrl(["electron.exe", "spirit://new-session"]),
    "spirit://new-session",
  );
});

test("dispatchSpiritNotificationProtocolUrl returns false without handlers", () => {
  assert.equal(dispatchSpiritNotificationProtocolUrl("spirit://new-session", undefined), false);
});
