import assert from "node:assert/strict";
import { test } from "vitest";

import { isStepfunApiHostname, resolveStepfunV1Url } from "./stepfun-api-hosts.js";

test("isStepfunApiHostname accepts China and International hosts", () => {
  assert.equal(isStepfunApiHostname("api.stepfun.com"), true);
  assert.equal(isStepfunApiHostname("api.stepfun.ai"), true);
  assert.equal(isStepfunApiHostname("api.example.com"), false);
});

test("resolveStepfunV1Url uses the configured origin and keeps the China fallback", () => {
  assert.equal(resolveStepfunV1Url(undefined, "/search"), "https://api.stepfun.com/v1/search");
  assert.equal(
    resolveStepfunV1Url("https://api.stepfun.ai/v1", "/search"),
    "https://api.stepfun.ai/v1/search",
  );
  assert.equal(
    resolveStepfunV1Url("https://api.stepfun.ai/step_plan/v1", "/images/generations"),
    "https://api.stepfun.ai/v1/images/generations",
  );
});
