import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createHostAutomationStore } from "@spiritagent/automations";
import { NodeHostToolService } from "./tools.js";

test("create_automation validates contributed triggers for approval and persistence", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-create-automation-tool-"));
  try {
    const service = new NodeHostToolService(
      { workspaceRoot: spiritDataDir, spiritDataDir },
      {
        getAutomationCreateDefaults: () => ({
          workspaceRoot: spiritDataDir,
          modelRef: { providerId: "test", name: "local" },
        }),
        validateAutomationTrigger: async (input) => {
          assert.equal(input.kind, "extension:personal/demo/activity");
          return {
            kind: "extension:personal/demo/activity",
            config: input.config,
            label: "Spirit activity",
          };
        },
      },
    );
    const request = await service.requestFromFunctionCall(
      "create_automation",
      JSON.stringify({
        overview: "Track repository activity",
        trigger: {
          kind: "extension:personal/demo/activity",
          config: { repository: "spirit" },
        },
      }),
    );
    const approval = await service.authorize(request);
    assert.deepEqual(approval, {
      kind: "need-approval",
      approval: {
        kind: "create_automation",
        title: "Track repository activity",
        trigger: {
          kind: "extension:personal/demo/activity",
          config: { repository: "spirit" },
          label: "Spirit activity",
        },
        approvalLevel: "default",
        overview: "Track repository activity",
        overviewChars: 25,
      },
    });

    const output = await service.execute(request);
    assert.match(String(output), /trigger: Spirit activity/);
    const [created] = await createHostAutomationStore(spiritDataDir).listSummaries();
    assert.equal(created?.scheduleLabel, "Spirit activity");
    assert.equal(created?.trigger.kind, "extension:personal/demo/activity");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
