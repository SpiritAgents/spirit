import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import {
  buildRipgrepArgs,
  formatGrepToolOutput,
  normalizeSearchLine,
  runRipgrepSearch,
} from "./ripgrep-search.js";

const execFileAsync = promisify(execFile);

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "spirit-ripgrep-search-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function initGitRepo(root: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
}

test("buildRipgrepArgs maps text query to fixed-string case-insensitive search", () => {
  const args = buildRipgrepArgs({
    workspaceRoot: "/workspace",
    query: "needle",
    isRegexp: false,
  });

  assert.deepEqual(args, [
    "--json",
    "--no-heading",
    "--color=never",
    "--line-number",
    "--max-filesize",
    "1M",
    "-g",
    "!**/.git/**",
    "--hidden",
    "-F",
    "-i",
    "needle",
    ".",
  ]);
});

test("buildRipgrepArgs maps case-sensitive whole-word text search", () => {
  const args = buildRipgrepArgs({
    workspaceRoot: "/workspace",
    query: "Needle",
    isRegexp: false,
    caseSensitive: true,
    wholeWord: true,
  });

  assert.deepEqual(args, [
    "--json",
    "--no-heading",
    "--color=never",
    "--line-number",
    "--max-filesize",
    "1M",
    "-g",
    "!**/.git/**",
    "--hidden",
    "-w",
    "-F",
    "Needle",
    ".",
  ]);
});

test("buildRipgrepArgs maps regexp query without --hidden when glob is set", () => {
  const args = buildRipgrepArgs({
    workspaceRoot: "C:\\repo",
    query: "runtime\\s+parity",
    isRegexp: true,
    globPattern: "src/**/*.ts",
  });

  assert.deepEqual(args, [
    "--json",
    "--no-heading",
    "--color=never",
    "--line-number",
    "--max-filesize",
    "1M",
    "-g",
    "!**/.git/**",
    "-g",
    "src/**/*.ts",
    "-i",
    "--regexp",
    "runtime\\s+parity",
    ".",
  ]);
});

test("runRipgrepSearch parses submatch column ranges", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "alpha.txt"), "foo NEEDLE bar\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "NEEDLE",
      isRegexp: false,
      caseSensitive: true,
    });

    assert.equal(matches.length, 1);
    assert.ok(matches[0]?.submatches.length);
    assert.equal(matches[0]?.submatches[0]?.start, 4);
    assert.equal(matches[0]?.submatches[0]?.end, 10);
  });
});

test("runRipgrepSearch finds case-insensitive text matches", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "alpha.txt"), "NEEDLE here\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
      isRegexp: false,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, "alpha.txt");
    assert.equal(matches[0]?.lineNumber, 1);
    assert.equal(matches[0]?.lineText, "NEEDLE here");
  });
});

test("runRipgrepSearch supports case-insensitive regular expressions", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "alpha.txt"), "Runtime    parity\n", "utf8");
    await writeFile(join(root, "beta.txt"), "no match here\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "runtime\\s+parity",
      isRegexp: true,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, "alpha.txt");
    assert.match(matches[0]?.lineText ?? "", /Runtime\s+parity/u);
  });
});

test("runRipgrepSearch limits search to glob pattern", async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "needle here\n", "utf8");
    await writeFile(join(root, "docs", "readme.md"), "needle here\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
      globPattern: "src/**/*.ts",
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, "src/app.ts");
  });
});

test("runRipgrepSearch returns no matches for missing query hits", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "alpha.txt"), "nothing here\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
    });

    assert.deepEqual(matches, []);
  });
});

test("runRipgrepSearch rejects invalid regular expressions", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "alpha.txt"), "value\n", "utf8");

    await assert.rejects(
      () =>
        runRipgrepSearch({
          workspaceRoot: root,
          query: "(",
          isRegexp: true,
        }),
      /Invalid regex/u,
    );
  });
});

test("runRipgrepSearch skips files matched by .gitignore", async () => {
  await withTempWorkspace(async (root) => {
    await initGitRepo(root);
    await writeFile(join(root, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(root, "ignored.txt"), "needle here\n", "utf8");
    await writeFile(join(root, "tracked.txt"), "needle here\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, "tracked.txt");
  });
});

test("runRipgrepSearch searches hidden directories in full-workspace mode", async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(join(root, ".cursor"), { recursive: true });
    await writeFile(join(root, ".cursor", "rules.md"), "needle in hidden dir\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, ".cursor/rules.md");
  });
});

test("runRipgrepSearch excludes .git directory at any path", async () => {
  await withTempWorkspace(async (root) => {
    await initGitRepo(root);
    await writeFile(join(root, "tracked.txt"), "needle in tracked file\n", "utf8");
    await writeFile(join(root, ".git", "spirit-test-needle"), "needle in git dir\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, "tracked.txt");
  });
});

function grepToolMatch(relativePath: string, lineNumber: number, lineText: string) {
  return { relativePath, lineNumber, lineText, submatches: [] };
}

test("formatGrepToolOutput renders ripgrep-style content lines", () => {
  const output = formatGrepToolOutput([grepToolMatch("src/app.ts", 1, "needle here")]);

  assert.equal(output, "src/app.ts:1:needle here\n");
});

test("formatGrepToolOutput omits line numbers when disabled", () => {
  const output = formatGrepToolOutput([grepToolMatch("src/app.ts", 1, "needle here")], {
    lineNumbers: false,
  });

  assert.equal(output, "src/app.ts:needle here\n");
});

test("formatGrepToolOutput lists unique paths in files_with_matches mode", () => {
  const output = formatGrepToolOutput(
    [
      grepToolMatch("src/app.ts", 1, "needle"),
      grepToolMatch("src/app.ts", 5, "needle again"),
      grepToolMatch("docs/readme.md", 2, "needle"),
    ],
    { mode: "files_with_matches" },
  );

  assert.equal(output, "src/app.ts\ndocs/readme.md\n");
});

test("formatGrepToolOutput counts matches per file in count_matches mode", () => {
  const output = formatGrepToolOutput(
    [
      grepToolMatch("src/app.ts", 1, "needle"),
      grepToolMatch("src/app.ts", 5, "needle again"),
      grepToolMatch("docs/readme.md", 2, "needle"),
    ],
    { mode: "count_matches" },
  );

  assert.equal(output, "src/app.ts:2\ndocs/readme.md:1\n");
});

test("formatGrepToolOutput pages entries with headLimit and offset", () => {
  const matches = [
    grepToolMatch("a.txt", 1, "needle 1"),
    grepToolMatch("a.txt", 2, "needle 2"),
    grepToolMatch("a.txt", 3, "needle 3"),
  ];

  const firstPage = formatGrepToolOutput(matches, { headLimit: 2 });
  assert.equal(
    firstPage,
    "a.txt:1:needle 1\na.txt:2:needle 2\n\n[truncated] Showing 2 of 3 entries (offset 0). Pass offset 2 to continue.\n",
  );

  const secondPage = formatGrepToolOutput(matches, { headLimit: 2, offset: 2 });
  assert.equal(secondPage, "a.txt:3:needle 3\n");
});

test("formatGrepToolOutput notes when the internal match cap was hit", () => {
  const output = formatGrepToolOutput([grepToolMatch("a.txt", 1, "needle")], {
    truncated: true,
  });

  assert.match(output, /\[truncated\] Search hit the internal limit of 10000 matches/u);
});

test("normalizeSearchLine strips trailing newline but keeps leading indent", () => {
  assert.equal(normalizeSearchLine("  needle here\n"), "  needle here");
});

test("runRipgrepSearch keeps submatch byte offsets aligned for indented CJK lines", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "sample.rs"), "    timeline.beginUserTurn('你好啊');\n", "utf8");

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "你好",
    });

    assert.equal(matches.length, 1);
    const match = matches[0]!;
    assert.ok(match.lineText.startsWith("    "));
    const submatch = match.submatches[0];
    assert.ok(submatch);
    const bytes = Buffer.from(match.lineText, "utf8");
    assert.equal(bytes.subarray(submatch.start, submatch.end).toString("utf8"), "你好");
  });
});

test("runRipgrepSearch supports single-character text queries", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "alpha.txt"), "alphabet\n", "utf8");
    await writeFile(join(root, "noise.bin"), Buffer.from([0x00, 0x61, 0x62, 0x00]));

    const { matches } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "a",
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, "alpha.txt");
    assert.equal(matches[0]?.lineText, "alphabet");
  });
});

test("runRipgrepSearch stops at maxMatches and reports truncated", async () => {
  await withTempWorkspace(async (root) => {
    for (let index = 0; index < 20; index += 1) {
      await writeFile(join(root, `file-${index}.txt`), "needle\n", "utf8");
    }

    const { matches, truncated } = await runRipgrepSearch({
      workspaceRoot: root,
      query: "needle",
      maxMatches: 5,
    });

    assert.equal(matches.length, 5);
    assert.equal(truncated, true);
  });
});

test("formatGrepToolOutput reports empty results", () => {
  assert.equal(formatGrepToolOutput([]), "No matches found");
});
