import assert from "node:assert/strict";
import { test } from "vitest";

import {
  builtInCreateAutomationToolCallSummaryParts,
  parseLazyToolGatewayFieldsFromJson,
  resolveCreateAutomationSummaryDetail,
} from "../../../../packages/sessions/dist/lib/lazy-built-in-tool-display.js";

test("parseLazyToolGatewayFieldsFromJson: partial gateway JSON exposes built-in create_automation", () => {
  const partial =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI news digest"';
  assert.deepEqual(parseLazyToolGatewayFieldsFromJson(partial), {
    provider: "built-in",
    server: "desktop",
    tool: "create_automation",
  });
});

test("resolveCreateAutomationSummaryDetail: progressive title then trigger from streaming JSON", () => {
  const titleOnly =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI news digest","trigger":{"kind":"time","schedule":{"kind":"daily"';
  assert.deepEqual(
    resolveCreateAutomationSummaryDetail({
      gatewayJson: titleOnly,
      formatTriggerLabel: () => "Daily 08:00",
    }),
    { title: "AI news digest" },
  );

  const withTrigger =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI news digest","trigger":{"kind":"time","schedule":{"kind":"daily","hour":8,"minute":0}}}}';
  assert.deepEqual(
    resolveCreateAutomationSummaryDetail({
      gatewayJson: withTrigger,
      formatTriggerLabel: () => "Daily 08:00",
    }),
    { title: "AI news digest", triggerLabel: "Daily 08:00" },
  );
});

test("builtInCreateAutomationToolCallSummaryParts: headline without detail once tool is identified", () => {
  const gatewayOnly =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{';
  assert.deepEqual(
    builtInCreateAutomationToolCallSummaryParts({
      gatewayJson: gatewayOnly,
      headline: "Create automation",
      formatTriggerLabel: () => "Daily 08:00",
    }),
    { headline: "Create automation" },
  );
});
