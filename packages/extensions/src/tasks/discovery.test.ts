import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";

import {
  loadTaskFiles,
  matchesTaskFileVersion,
  userTasksFilePath,
  vscodeTasksFilePath,
  workspaceTasksFilePath,
} from "./discovery.js";

async function withTempDirs(
  run: (dirs: { workspaceRoot: string; spiritDataDir: string }) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-tasks-ws-"));
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-tasks-data-"));
  try {
    await run({ workspaceRoot, spiritDataDir });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(spiritDataDir, { recursive: true, force: true });
  }
}

async function writeJson(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

test("loadTaskFiles loads all three sources in priority order", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeJson(
      workspaceTasksFilePath(workspaceRoot),
      JSON.stringify({ schemaVersion: 1, tasks: [{ label: "ws", command: "a" }] }),
    );
    await writeJson(
      userTasksFilePath(spiritDataDir),
      JSON.stringify({ schemaVersion: 1, tasks: [{ label: "user", command: "b" }] }),
    );
    await writeJson(
      vscodeTasksFilePath(workspaceRoot),
      JSON.stringify({ version: "2.0.0", tasks: [{ label: "vs", command: "c" }] }),
    );

    const files = await loadTaskFiles({ workspaceRoot, spiritDataDir });
    assert.deepEqual(
      files.map((file) => file.sourceKind),
      ["workspace", "user", "vscode-compat"],
    );
    assert.deepEqual(
      files.map((file) => file.path),
      [
        workspaceTasksFilePath(workspaceRoot),
        userTasksFilePath(spiritDataDir),
        vscodeTasksFilePath(workspaceRoot),
      ],
    );
  });
});

test("loadTaskFiles returns only the user file when workspaceRoot is absent", async () => {
  await withTempDirs(async ({ spiritDataDir }) => {
    await writeJson(
      userTasksFilePath(spiritDataDir),
      JSON.stringify({ schemaVersion: 1, tasks: [] }),
    );
    const files = await loadTaskFiles({ spiritDataDir });
    assert.deepEqual(
      files.map((file) => file.sourceKind),
      ["user"],
    );
  });
});

test("loadTaskFiles returns nothing when no files exist", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);
  });
});

test("loadTaskFiles skips files with invalid JSON", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeJson(workspaceTasksFilePath(workspaceRoot), "{ not json");
    await writeJson(
      userTasksFilePath(spiritDataDir),
      JSON.stringify({ schemaVersion: 1, tasks: [] }),
    );
    const files = await loadTaskFiles({ workspaceRoot, spiritDataDir });
    assert.deepEqual(
      files.map((file) => file.sourceKind),
      ["user"],
    );
  });
});

test("loadTaskFiles requires schemaVersion 1 in Spirit files", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    const filePath = workspaceTasksFilePath(workspaceRoot);

    await writeJson(filePath, JSON.stringify({ tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    await writeJson(filePath, JSON.stringify({ schemaVersion: 2, tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    await writeJson(filePath, JSON.stringify({ schemaVersion: "1", tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    // A VS Code style version field is not accepted in Spirit files.
    await writeJson(filePath, JSON.stringify({ version: "2.0.0", tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    await writeJson(filePath, JSON.stringify({ schemaVersion: 1, tasks: [] }));
    assert.equal((await loadTaskFiles({ workspaceRoot, spiritDataDir })).length, 1);
  });
});

test("loadTaskFiles requires version 2.0.0 in .vscode files", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    const filePath = vscodeTasksFilePath(workspaceRoot);

    await writeJson(filePath, JSON.stringify({ tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    await writeJson(filePath, JSON.stringify({ version: "1.0.0", tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    // A Spirit style schemaVersion is not accepted in .vscode files.
    await writeJson(filePath, JSON.stringify({ schemaVersion: 1, tasks: [] }));
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    await writeJson(filePath, JSON.stringify({ version: "2.0.0", tasks: [] }));
    assert.equal((await loadTaskFiles({ workspaceRoot, spiritDataDir })).length, 1);
  });
});

test("matchesTaskFileVersion rejects non-object documents", () => {
  assert.equal(matchesTaskFileVersion("workspace", null), false);
  assert.equal(matchesTaskFileVersion("workspace", "schemaVersion 1"), false);
  assert.equal(matchesTaskFileVersion("workspace", [1]), false);
  assert.equal(matchesTaskFileVersion("user", { schemaVersion: 1 }), true);
  assert.equal(matchesTaskFileVersion("vscode-compat", { version: "2.0.0" }), true);
});

test("loadTaskFiles parses JSONC .vscode files with comments and trailing commas", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    const jsonc = `{
  // line comment before the version
  "version": "2.0.0", // line comment after a value
  /* block comment
     spanning lines */
  "tasks": [
    {
      "label": "build", /* inline block */
      "command": "echo // not a comment",
      "args": ["a", "b",],
    },
    {
      "label": "escaped",
      "command": "echo \\"quoted /* still string */\\" tail",
      "detail": "http://not-a-comment.example",
    },
  ],
}
`;
    await writeJson(vscodeTasksFilePath(workspaceRoot), jsonc);

    const files = await loadTaskFiles({ workspaceRoot, spiritDataDir });
    assert.equal(files.length, 1);
    assert.equal(files[0]!.sourceKind, "vscode-compat");
    const json = files[0]!.json as {
      version: string;
      tasks: { label: string; command: string; args?: string[]; detail?: string }[];
    };
    assert.equal(json.version, "2.0.0");
    assert.equal(json.tasks.length, 2);
    // Comment-shaped text inside string values is preserved verbatim.
    assert.equal(json.tasks[0]!.command, "echo // not a comment");
    assert.deepEqual(json.tasks[0]!.args, ["a", "b"]);
    assert.equal(json.tasks[1]!.command, 'echo "quoted /* still string */" tail');
    assert.equal(json.tasks[1]!.detail, "http://not-a-comment.example");
  });
});

test("loadTaskFiles applies version gating after the JSONC-tolerant parse", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeJson(
      vscodeTasksFilePath(workspaceRoot),
      `{
  // wrong version, even though the file parses
  "version": "1.0.0",
  "tasks": [],
}
`,
    );
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);
  });
});

test("loadTaskFiles keeps Spirit files strict and rejects comments in them", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeJson(
      workspaceTasksFilePath(workspaceRoot),
      `{
  // comments are not allowed in Spirit's own format
  "schemaVersion": 1,
  "tasks": [],
}
`,
    );
    await writeJson(
      userTasksFilePath(spiritDataDir),
      `{
  "schemaVersion": 1,
  "tasks": [], // trailing commas are not allowed either
}
`,
    );
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);
  });
});

test("loadTaskFiles yields nothing for malformed JSONC and never throws", async () => {
  await withTempDirs(async ({ workspaceRoot, spiritDataDir }) => {
    const filePath = vscodeTasksFilePath(workspaceRoot);

    // Unterminated string.
    await writeJson(filePath, `{ "version": "2.0.0", "tasks": [{ "label": "x, "command": "e" }] }`);
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    // Unterminated block comment swallows the rest of the document.
    await writeJson(filePath, `{ "version": "2.0.0", "tasks": [] /* unterminated`);
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);

    // Trailing junk after the closing brace.
    await writeJson(filePath, `{ "version": "2.0.0", "tasks": [] } junk`);
    assert.deepEqual(await loadTaskFiles({ workspaceRoot, spiritDataDir }), []);
  });
});
