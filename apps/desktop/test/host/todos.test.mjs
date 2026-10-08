import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { createHostTodoStore } from "@spiritagent/host-internal";

import {
  createTodoSessionScopeKey,
  listSessionTodos,
  replaceSessionTodos,
  resolveTodoSessionKey,
  normalizeTodoSessionStorageKey,
} from "../../dist-electron/src/host/todos.js";
import {
  isProvisionalSessionPath,
  provisionalNewSessionPath,
  spiritDataDir,
} from "../../dist-electron/src/host/storage.js";
import { DesktopToolExecutor } from "../../dist-electron/src/host/tool-executor.js";

function functionToolNames(definitions) {
  return Array.isArray(definitions)
    ? definitions.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const tool = entry.function;
        return tool && typeof tool === "object" && typeof tool.name === "string" ? [tool.name] : [];
      })
    : [];
}

test("provisional chat paths do not alias todo storage", () => {
  const workspaceRoot = path.join(process.cwd(), "workspace-a");
  const provisionalPath = provisionalNewSessionPath(workspaceRoot);
  const scopeKey = createTodoSessionScopeKey();
  assert.ok(isProvisionalSessionPath(provisionalPath));
  assert.notEqual(
    resolveTodoSessionKey({
      sessionFilePath: provisionalPath,
      bundleId: provisionalPath,
      todoSessionScopeKey: scopeKey,
    }),
    path.resolve(provisionalPath),
  );
  assert.equal(
    resolveTodoSessionKey({
      sessionFilePath: provisionalPath,
      bundleId: provisionalPath,
      todoSessionScopeKey: scopeKey,
    }),
    scopeKey,
  );
  assert.equal(normalizeTodoSessionStorageKey(scopeKey), scopeKey);
  assert.notEqual(normalizeTodoSessionStorageKey(scopeKey), path.resolve(scopeKey));
  const savedPath = path.join(process.cwd(), "chats", "session-1.json");
  assert.equal(
    resolveTodoSessionKey({
      sessionFilePath: savedPath,
      bundleId: provisionalPath,
      todoSessionScopeKey: scopeKey,
    }),
    path.resolve(savedPath),
  );
});

test("desktop todo tools are exposed on the main agent executor", () => {
  const executor = new DesktopToolExecutor(process.cwd(), {
    todoScope: { sessionKey: path.join(process.cwd(), "session-a.json") },
  });
  const names = functionToolNames(executor.toolDefinitionsJson());
  assert.ok(names.includes("todo_write"));
  assert.ok(names.includes("todo_list"));
  assert.equal(names.filter((name) => name.startsWith("todo_")).length, 2);
});

test("replaceAll restores rewind todo snapshot per session", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "spirit-todos-rewind-"));
  const previousDataDir = process.env.SPIRIT_DATA_DIR;
  const sessionKey = path.join(tempRoot, "session-rewind.json");

  try {
    process.env.SPIRIT_DATA_DIR = tempRoot;
    const store = createHostTodoStore({
      spiritDataDir: spiritDataDir(),
      scope: { sessionKey },
    });
    await store.write([{ title: "Before rewind", status: "pending" }]);
    const snapshot = await listSessionTodos(sessionKey);
    await store.write([
      { title: "Before rewind", status: "pending" },
      { title: "After more work", status: "pending" },
    ]);
    assert.equal((await listSessionTodos(sessionKey)).length, 2);

    await replaceSessionTodos(sessionKey, snapshot);
    const restored = await listSessionTodos(sessionKey);
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.title, "Before rewind");
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.SPIRIT_DATA_DIR;
    } else {
      process.env.SPIRIT_DATA_DIR = previousDataDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
