import assert from "node:assert/strict";
import { test } from "vitest";

import type { HostAutomationDefinition, HostAutomationRun } from "@spiritagent/automations";
import {
  notifyAutomationRunFinished,
  notifyAutomationTriggerError,
  resetAutomationTriggerErrorNotification,
  setDesktopAutomationNotificationAdapter,
} from "./automation-notifications.js";

const definition: HostAutomationDefinition = {
  id: "automation-1",
  title: "Demo",
  overview: "Run demo",
  trigger: { kind: "time", schedule: { kind: "hourly" } },
  workspaceRoot: "/tmp",
  modelRef: { providerId: "test", name: "local" },
  approvalLevel: "default",
  enabled: true,
  createdAtUnixMs: 1,
  updatedAtUnixMs: 1,
};

function run(status: HostAutomationRun["status"]): HostAutomationRun {
  return {
    id: `run-${status}`,
    automationId: definition.id,
    sessionPath: "/tmp/automation.json",
    status,
    startedAtUnixMs: 1,
  };
}

test("run notifications are emitted only while away and retain their navigation context", async () => {
  let away = false;
  const shown: unknown[] = [];
  setDesktopAutomationNotificationAdapter({
    isAway: async () => away,
    show: async (payload) => {
      shown.push(payload);
    },
  });
  try {
    await notifyAutomationRunFinished(definition, run("completed"));
    assert.equal(shown.length, 0);
    away = true;
    await notifyAutomationRunFinished(definition, run("blocked"));
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0], {
      title: "Demo needs attention",
      tag: "spirit-automation-automation-1",
      kind: "automation",
      context: {
        automationId: "automation-1",
        runId: "run-blocked",
        sessionPath: "/tmp/automation.json",
      },
    });
  } finally {
    setDesktopAutomationNotificationAdapter(undefined);
  }
});

test("trigger errors dedupe, allow changed errors, and reset after recovery", async () => {
  const shown: unknown[] = [];
  setDesktopAutomationNotificationAdapter({
    isAway: async () => true,
    show: async (payload) => {
      shown.push(payload);
    },
  });
  try {
    await notifyAutomationTriggerError(definition, "offline");
    await notifyAutomationTriggerError(definition, "offline");
    assert.equal(shown.length, 1);
    await notifyAutomationTriggerError(definition, "denied");
    assert.equal(shown.length, 2);
    await notifyAutomationTriggerError(definition, undefined);
    assert.equal(shown.length, 2);
    await notifyAutomationTriggerError(definition, "offline");
    assert.equal(shown.length, 3);
  } finally {
    resetAutomationTriggerErrorNotification(definition.id);
    setDesktopAutomationNotificationAdapter(undefined);
  }
});

test("trigger errors first seen while present notify after the user goes away", async () => {
  let away = false;
  const shown: unknown[] = [];
  setDesktopAutomationNotificationAdapter({
    isAway: async () => away,
    show: async (payload) => {
      shown.push(payload);
    },
  });
  try {
    await notifyAutomationTriggerError(definition, "offline");
    assert.equal(shown.length, 0);
    away = true;
    await notifyAutomationTriggerError(definition, "offline");
    assert.equal(shown.length, 1);
    await notifyAutomationTriggerError(definition, "offline");
    assert.equal(shown.length, 1);
  } finally {
    resetAutomationTriggerErrorNotification(definition.id);
    setDesktopAutomationNotificationAdapter(undefined);
  }
});
