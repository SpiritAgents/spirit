import assert from "node:assert/strict";
import { test } from "vitest";

import {
  formatDesktopAutomationTriggerLabel,
  isValidDesktopAutomationTrigger,
} from "../../src/lib/automation-trigger.ts";

const labels = {
  hourly: "Hourly",
  dailyPrefix: "Daily",
  weeklyPrefix: "Weekly",
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  formatWeekly: (weekday, time) => `Weekly ${weekday} ${time}`,
};

test("formatDesktopAutomationTriggerLabel renders a contributed trigger", () => {
  assert.equal(
    formatDesktopAutomationTriggerLabel(
      {
        kind: "extension:personal/demo/activity",
        config: {},
        label: "Repository Activity",
      },
      labels,
    ),
    "Repository Activity",
  );
});

test("isValidDesktopAutomationTrigger validates schedules and contributed config", () => {
  assert.equal(
    isValidDesktopAutomationTrigger({ kind: "time", schedule: { kind: "hourly" } }),
    true,
  );
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: "time",
      schedule: { kind: "daily", hour: 9, minute: 30 },
    }),
    true,
  );
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: "time",
      schedule: { kind: "daily", hour: 25, minute: 0 },
    }),
    false,
  );
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: "time",
      schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 60 },
    }),
    false,
  );
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: "extension:personal/demo/activity",
      config: {},
      label: "Repository Activity",
    }),
    true,
  );
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: "extension:personal/demo/activity",
      config: [],
      label: "Repository Activity",
    }),
    false,
  );
});
