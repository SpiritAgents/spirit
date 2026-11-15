import assert from "node:assert/strict";
import { test } from "vitest";

import { formatTitleFromId } from "./id-display-title.js";
import { WELL_KNOWN_CASING_OVERRIDES } from "./well-known-casing.js";

test("well-known casing overrides format OAuth and existing tokens", () => {
  assert.equal(
    formatTitleFromId("oauth", { casingOverrides: WELL_KNOWN_CASING_OVERRIDES }),
    "OAuth",
  );
  assert.equal(
    formatTitleFromId("devops", { casingOverrides: WELL_KNOWN_CASING_OVERRIDES }),
    "DevOps",
  );
  assert.equal(
    formatTitleFromId("github", { casingOverrides: WELL_KNOWN_CASING_OVERRIDES }),
    "GitHub",
  );
});
