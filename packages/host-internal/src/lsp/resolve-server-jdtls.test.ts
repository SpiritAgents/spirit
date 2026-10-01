import assert from "node:assert/strict";
import { test } from "vitest";

import { buildJdtlsServerCommand } from "./resolve-server-jdtls.js";
import { resolveOmnisharpOnPath } from "./resolve-server-omnisharp.js";

test("buildJdtlsServerCommand returns undefined without JDTLS_HOME", async () => {
  const result = await buildJdtlsServerCommand(process.cwd(), { PATH: "", HOME: "" }, "linux");
  assert.equal(result, undefined);
});

test("resolveOmnisharpOnPath returns undefined without PATH or OMNISHARP_PATH", async () => {
  const result = await resolveOmnisharpOnPath({ PATH: "", HOME: "" }, "linux");
  assert.equal(result, undefined);
});
