import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  RECENT_FILE_POOL_LIMIT,
  RECENT_FILE_POOL_STORAGE_KEY,
  readRecentFilePool,
  recentPoolEntryDisplayPath,
  recordRecentFilePoolEntry,
  removeRecentFilePoolEntries,
  visibleRecentPoolEntries,
} from "../src/lib/recent-file-pool.ts";

function createMockStorage(initial) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    map,
  };
}

test("record prepends new entries in MRU order", () => {
  const entries = recordRecentFilePoolEntry(
    [],
    { path: "/ws/app/src/a.ts", isDirectory: false, workspaceRoot: "/ws/app" },
    1000,
  );
  const next = recordRecentFilePoolEntry(
    entries,
    { path: "/ws/app/src/b.ts", isDirectory: false, workspaceRoot: "/ws/app" },
    2000,
  );

  assert.deepEqual(
    next.map((entry) => entry.path),
    ["/ws/app/src/b.ts", "/ws/app/src/a.ts"],
  );
  assert.equal(next[0].openedAtUnixMs, 2000);
  assert.deepEqual(next[0].workspaces, ["/ws/app"]);
});

test("record refreshes an existing entry to the front without duplicating it", () => {
  let entries = recordRecentFilePoolEntry(
    [],
    { path: "/ws/app/src/a.ts", isDirectory: false, workspaceRoot: "/ws/app" },
    1000,
  );
  entries = recordRecentFilePoolEntry(
    entries,
    { path: "/ws/app/src/b.ts", isDirectory: false, workspaceRoot: "/ws/app" },
    2000,
  );
  entries = recordRecentFilePoolEntry(
    entries,
    { path: "/ws/app/src/a.ts", isDirectory: false, workspaceRoot: "/ws/app" },
    3000,
  );

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["/ws/app/src/a.ts", "/ws/app/src/b.ts"],
  );
  assert.equal(entries[0].openedAtUnixMs, 3000);
});

test("record normalizes backslashes and merges case-insensitively", () => {
  let entries = recordRecentFilePoolEntry(
    [],
    { path: "C:\\Ws\\App\\Src\\A.ts", isDirectory: false, workspaceRoot: "C:\\Ws\\App" },
    1000,
  );
  entries = recordRecentFilePoolEntry(
    entries,
    { path: "c:/ws/app/src/a.ts", isDirectory: false, workspaceRoot: "c:/ws/app" },
    2000,
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].openedAtUnixMs, 2000);
});

test("visibility union: a workspace-scoped entry opened via Files becomes visible everywhere", () => {
  let entries = recordRecentFilePoolEntry(
    [],
    { path: "/ws/app/src/a.ts", isDirectory: false, workspaceRoot: "/ws/app" },
    1000,
  );
  entries = recordRecentFilePoolEntry(
    entries,
    { path: "/ws/app/src/a.ts", isDirectory: false, workspaceRoot: null },
    2000,
  );

  assert.deepEqual(entries[0].workspaces, []);
  assert.deepEqual(visibleRecentPoolEntries(entries, "/ws/other").length, 1);
});

test("visibility union of two distinct workspaces stays scoped to those two", () => {
  let entries = recordRecentFilePoolEntry(
    [],
    { path: "/shared/docs/spec.md", isDirectory: false, workspaceRoot: "/ws/one" },
    1000,
  );
  entries = recordRecentFilePoolEntry(
    entries,
    { path: "/shared/docs/spec.md", isDirectory: false, workspaceRoot: "/ws/two" },
    2000,
  );

  assert.deepEqual(visibleRecentPoolEntries(entries, "/ws/one").length, 1);
  assert.deepEqual(visibleRecentPoolEntries(entries, "/ws/two").length, 1);
  assert.deepEqual(visibleRecentPoolEntries(entries, "/ws/three").length, 0);
});

test("pool evicts the oldest entry beyond the limit", () => {
  let entries = [];
  for (let index = 0; index < RECENT_FILE_POOL_LIMIT + 5; index += 1) {
    entries = recordRecentFilePoolEntry(
      entries,
      {
        path: `/ws/app/src/file-${index}.ts`,
        isDirectory: false,
        workspaceRoot: "/ws/app",
      },
      1000 + index,
    );
  }

  assert.equal(entries.length, RECENT_FILE_POOL_LIMIT);
  assert.equal(entries[0].path, `/ws/app/src/file-${RECENT_FILE_POOL_LIMIT + 4}.ts`);
  assert.equal(entries.at(-1).path, "/ws/app/src/file-5.ts");
});

test("read tolerates corrupt payloads", () => {
  assert.deepEqual(readRecentFilePool(createMockStorage()), []);
  assert.deepEqual(
    readRecentFilePool(createMockStorage({ [RECENT_FILE_POOL_STORAGE_KEY]: "{not json" })),
    [],
  );
  assert.deepEqual(
    readRecentFilePool(
      createMockStorage({
        [RECENT_FILE_POOL_STORAGE_KEY]: JSON.stringify({ version: 999, entries: [] }),
      }),
    ),
    [],
  );
});

test("read normalizes, dedupes, and sorts entries by recency", () => {
  const storage = createMockStorage({
    [RECENT_FILE_POOL_STORAGE_KEY]: JSON.stringify({
      version: 1,
      entries: [
        {
          path: "/ws/app/src/a.ts",
          isDirectory: false,
          workspaces: ["/ws/app"],
          openedAtUnixMs: 1000,
        },
        {
          path: "/ws/app/src/b.ts",
          isDirectory: false,
          workspaces: [],
          openedAtUnixMs: 3000,
        },
        {
          path: "/ws/app/src/A.ts/",
          isDirectory: false,
          workspaces: [],
          openedAtUnixMs: 2000,
        },
        { path: "", isDirectory: false, workspaces: [], openedAtUnixMs: 4000 },
        { nope: true },
      ],
    }),
  });

  const entries = readRecentFilePool(storage);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["/ws/app/src/b.ts", "/ws/app/src/a.ts"],
  );
});

test("display path is workspace-relative under the root and absolute elsewhere", () => {
  const inside = {
    path: "/ws/app/src/ui/",
    isDirectory: true,
    workspaces: [],
    openedAtUnixMs: 1,
  };
  const normalized = { ...inside, path: "/ws/app/src/ui" };
  assert.equal(recentPoolEntryDisplayPath(normalized, "/ws/app"), "src/ui/");
  assert.equal(recentPoolEntryDisplayPath(normalized, "/ws/app/"), "src/ui/");
  assert.equal(recentPoolEntryDisplayPath(normalized, "/ws/other"), "/ws/app/src/ui/");

  const file = { path: "/etc/hosts", isDirectory: false, workspaces: [], openedAtUnixMs: 1 };
  assert.equal(recentPoolEntryDisplayPath(file, "/ws/app"), "/etc/hosts");
});

test("store wrapper persists to localStorage, notifies listeners, and evicts", async () => {
  const storage = createMockStorage();
  vi.stubGlobal("window", { localStorage: storage });
  try {
    // Query suffix forces a fresh module instance with an empty in-memory cache.
    const module = await import("../src/lib/recent-file-pool.ts?store-wrapper");

    let notifications = 0;
    const unsubscribe = module.subscribeRecentFilePool(() => {
      notifications += 1;
    });

    module.recordRecentPoolPath({
      path: "/ws/app/src/a.ts",
      isDirectory: false,
      workspaceRoot: "/ws/app",
    });
    module.recordRecentPoolPath({
      path: "/ws/app/src/ui/",
      isDirectory: true,
      workspaceRoot: "/ws/app",
    });

    const entries = module.getRecentFilePoolEntries();
    assert.deepEqual(
      entries.map((entry) => entry.path),
      ["/ws/app/src/ui", "/ws/app/src/a.ts"],
    );
    assert.equal(entries[0].isDirectory, true);
    assert.equal(notifications, 2);

    const persisted = JSON.parse(storage.map.get(module.RECENT_FILE_POOL_STORAGE_KEY));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.entries.length, 2);

    module.evictRecentPoolPaths(["/ws/app/src/a.ts"]);
    assert.deepEqual(
      module.getRecentFilePoolEntries().map((entry) => entry.path),
      ["/ws/app/src/ui"],
    );
    assert.equal(notifications, 3);

    unsubscribe();
    module.recordRecentPoolPath({
      path: "/ws/app/src/c.ts",
      isDirectory: false,
      workspaceRoot: "/ws/app",
    });
    assert.equal(notifications, 3);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("remove drops entries case-insensitively and keeps the rest", () => {
  let entries = recordRecentFilePoolEntry(
    [],
    { path: "/ws/app/src/a.ts", isDirectory: false, workspaceRoot: null },
    1000,
  );
  entries = recordRecentFilePoolEntry(
    entries,
    { path: "/ws/app/src/b.ts", isDirectory: false, workspaceRoot: null },
    2000,
  );

  const next = removeRecentFilePoolEntries(entries, ["/WS/app/src/B.ts", ""]);
  assert.deepEqual(
    next.map((entry) => entry.path),
    ["/ws/app/src/a.ts"],
  );
  assert.deepEqual(removeRecentFilePoolEntries(entries, []), entries);
});
