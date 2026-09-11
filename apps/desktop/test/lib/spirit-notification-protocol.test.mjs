import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildNewSessionProtocolUrl,
  buildOpenSessionProtocolUrl,
  dispatchSpiritNotificationProtocolUrl,
  findSpiritNotificationProtocolUrl,
  handleSpiritNotificationProtocolArgv,
  parseSpiritNotificationProtocolUrl,
} from "../../src/lib/spirit-notification-protocol.ts";

test("parseSpiritNotificationProtocolUrl ignores leftover approval URLs", () => {
  assert.equal(
    parseSpiritNotificationProtocolUrl(
      "spirit://notification-approval?decision=deny&tag=spirit-approval",
    ),
    null,
  );
  assert.equal(
    parseSpiritNotificationProtocolUrl("spirit://notification-approval?decision=allow"),
    null,
  );
});

test("handleSpiritNotificationProtocolArgv ignores leftover approval URLs", () => {
  let dispatched = false;
  assert.equal(
    handleSpiritNotificationProtocolArgv(
      ["spirit.exe", "spirit://notification-approval?decision=allow"],
      {
        onFocus: () => {
          dispatched = true;
        },
        onNewSession: () => {
          dispatched = true;
        },
        onOpenSession: () => {
          dispatched = true;
        },
      },
    ),
    false,
  );
  assert.equal(dispatched, false);
});

test("dispatchSpiritNotificationProtocolUrl does not approve leftover approval URLs", () => {
  let dispatched = false;
  assert.equal(
    dispatchSpiritNotificationProtocolUrl("spirit://notification-approval?decision=allow", {
      onFocus: () => {
        dispatched = true;
      },
      onNewSession: () => {
        dispatched = true;
      },
      onOpenSession: () => {
        dispatched = true;
      },
    }),
    false,
  );
  assert.equal(dispatched, false);
});

test("findSpiritNotificationProtocolUrl scans argv", () => {
  assert.equal(
    findSpiritNotificationProtocolUrl([
      "electron.exe",
      "spirit://notification-approval?decision=allow",
    ]),
    "spirit://notification-approval?decision=allow",
  );
});

test("buildNewSessionProtocolUrl returns stable host", () => {
  assert.equal(buildNewSessionProtocolUrl(), "spirit://new-session");
});

test("buildOpenSessionProtocolUrl encodes session path", () => {
  assert.equal(
    buildOpenSessionProtocolUrl("C:\\Users\\me\\session.json"),
    "spirit://open-session?path=C%3A%5CUsers%5Cme%5Csession.json",
  );
});

test("parseSpiritNotificationProtocolUrl reads new-session", () => {
  assert.deepEqual(parseSpiritNotificationProtocolUrl("spirit://new-session"), {
    kind: "new-session",
  });
});

test("parseSpiritNotificationProtocolUrl reads open-session path", () => {
  assert.deepEqual(
    parseSpiritNotificationProtocolUrl("spirit://open-session?path=C%3A%5Csessions%5Ca.json"),
    { kind: "open-session", path: "C:\\sessions\\a.json" },
  );
});

test("parseSpiritNotificationProtocolUrl rejects open-session without path", () => {
  assert.equal(parseSpiritNotificationProtocolUrl("spirit://open-session"), null);
  assert.equal(parseSpiritNotificationProtocolUrl("spirit://open-session?path="), null);
});

test("handleSpiritNotificationProtocolArgv returns false when open-session path is missing", () => {
  let focusCount = 0;
  const handlers = {
    onFocus: () => {
      focusCount += 1;
    },
  };
  assert.equal(
    handleSpiritNotificationProtocolArgv(["spirit.exe", "spirit://open-session"], handlers),
    false,
  );
  assert.equal(focusCount, 0);
});

test("handleSpiritNotificationProtocolArgv returns true when new-session dispatches", () => {
  let newSessionCount = 0;
  const handlers = {
    onNewSession: () => {
      newSessionCount += 1;
    },
  };
  assert.equal(
    handleSpiritNotificationProtocolArgv(["spirit.exe", "spirit://new-session"], handlers),
    true,
  );
  assert.equal(newSessionCount, 1);
});

test("dispatchSpiritNotificationProtocolUrl returns false without handlers", () => {
  assert.equal(dispatchSpiritNotificationProtocolUrl("spirit://new-session", undefined), false);
});
