import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { mergePreEventHookPermission } from "@spiritagent/agent-core";

import { createHookRunner } from "./service.js";

test("mergePreEventHookPermission prefers deny over ask and allow", () => {
  assert.equal(mergePreEventHookPermission("ask", "deny"), "deny");
  assert.equal(mergePreEventHookPermission("allow", "ask"), "ask");
  assert.equal(mergePreEventHookPermission(undefined, "allow"), "allow");
});

test("createHookRunner aggregates ask permission across preToolUse hooks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spirit-hook-service-"));
  const allowScript = join(dir, "allow.sh");
  const askScript = join(dir, "ask.sh");
  await writeFile(
    allowScript,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"allow"}'
`,
    "utf8",
  );
  await writeFile(
    askScript,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"ask","userMessage":"hook wants confirmation"}'
`,
    "utf8",
  );
  await chmod(allowScript, 0o755);
  await chmod(askScript, 0o755);

  const runner = createHookRunner({
    spiritDataDir: dir,
    workspaceRoot: undefined,
    reloadConfig: () => ({
      user: {
        version: 1,
        hooks: {
          preToolUse: [{ command: "allow.sh" }, { command: "ask.sh" }],
        },
      },
      workspace: { version: 1, hooks: {} },
      userConfigDir: dir,
      workspaceConfigDir: undefined,
    }),
  });

  const result = await runner.runPreToolUse({
    sessionId: "s1",
    conversationPath: null,
    workspaceRoot: "/w",
    model: "m",
    toolName: "grep",
    toolCallId: "tc1",
    toolInput: { pattern: "hook" },
  });

  assert.equal(result.denied, false);
  assert.equal(result.permission, "ask");
  assert.equal(result.userMessage, "hook wants confirmation");
});

test("createHookRunner runs extension hooks without workspace trust", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spirit-hook-extension-"));
  const script = join(dir, "extension.sh");
  await writeFile(
    script,
    `#!/bin/bash
cat > /dev/null
echo '{"additionalContext":"from-extension"}'
`,
    "utf8",
  );
  await chmod(script, 0o755);

  const runner = createHookRunner({
    spiritDataDir: dir,
    workspaceRoot: join(dir, "workspace"),
    reloadConfig: () => ({
      user: { version: 1, hooks: {} },
      workspace: {
        version: 1,
        hooks: {
          sessionStart: [{ command: "missing-workspace.sh" }],
        },
      },
      userConfigDir: dir,
      workspaceConfigDir: join(dir, "workspace"),
    }),
    loadExtensionHooks: () => [
      {
        command: script,
        scope: "extension",
        configDir: dir,
        timeout: 30,
      },
    ],
  });

  const result = await runner.runSessionStart({
    sessionId: "s1",
    conversationPath: null,
    workspaceRoot: join(dir, "workspace"),
    model: "m",
    source: "startup",
  });

  assert.equal(result.denied, false);
  assert.deepEqual(result.additionalContexts, ["from-extension"]);
});
