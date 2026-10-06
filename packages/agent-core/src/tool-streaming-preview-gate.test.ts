import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildEarlyExecutableArgumentsJson,
  hostToolArgumentsReadyForEarlyStreamingPreview,
  hostToolArgumentsReadyForPreview,
  previewRequestFromStreamingArguments,
  readFilePartialAllowsEarlyExecution,
  readFileStreamingPreviewSignature,
  resolveStreamingToolPreviewEmit,
  shouldEmitStreamingToolNamePreview,
  tryExtractPartialPlanName,
  tryExtractPartialReadFileFields,
  tryExtractPartialToolPath,
  tryExtractPartialSubagentTask,
  tryExtractPartialWebSearchQuery,
  subagentStreamingPreviewSignature,
  webSearchStreamingPreviewSignature,
} from "./tool-streaming-preview-gate.js";

test("shouldEmitStreamingToolNamePreview fires once when name first appears", () => {
  assert.equal(shouldEmitStreamingToolNamePreview("glob", ""), true);
  assert.equal(shouldEmitStreamingToolNamePreview("glob", "glob"), false);
  assert.equal(shouldEmitStreamingToolNamePreview("finish_task", ""), false);
});

test("tryExtractPartialToolPath reads path from incomplete JSON", () => {
  const partial = '{"path":"D:\\\\Spirit\\\\README.md","old_text":"';
  assert.equal(tryExtractPartialToolPath(partial), "D:\\Spirit\\README.md");
});

test("apply_patch early preview when operation.path is streamed", () => {
  const partial = '{"operation":{"type":"create_file","path":"demo.txt","diff":"+hel';
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("apply_patch", partial), true);
  assert.equal(hostToolArgumentsReadyForPreview("apply_patch", partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments("apply_patch", partial), {
    operation: { path: "demo.txt", type: "create_file" },
  });
});

test("apply_patch early preview readies on type or diff content before path arrives", () => {
  // The observed failure mode: the model streams the 300-line diff first and `path` last.
  const diffFirst = '{"operation":{"type":"update_file","diff":"@@\\n-a\\n+b\\n';
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("apply_patch", diffFirst), true);

  // A completed type alone also readies the preview (the header switches to the typed verb).
  assert.equal(
    hostToolArgumentsReadyForEarlyStreamingPreview(
      "apply_patch",
      '{"operation":{"type":"create_file"',
    ),
    true,
  );

  // Nothing parseable yet: not ready.
  assert.equal(
    hostToolArgumentsReadyForEarlyStreamingPreview("apply_patch", '{"operation":{"type":"upd'),
    false,
  );
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("apply_patch", ""), false);
});

test("resolveStreamingToolPreviewEmit re-emits apply_patch when type, path or diff counts change", () => {
  const withPath = '{"operation":{"type":"update_file","path":"a.ts","diff":"@@ \\n-a\\n+b';
  const first = resolveStreamingToolPreviewEmit("apply_patch", withPath, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  // Same parse state and same +/- counts: no re-emit even as the args string grows.
  const sameCounts = `${withPath}\\n context line grows`;
  const second = resolveStreamingToolPreviewEmit("apply_patch", sameCounts, first.nextState);
  assert.equal(second.emit, false);

  // A new added line flips the +/- counts: re-emit so the badge/diff update live.
  const countBump = `${withPath}\\n+c`;
  const third = resolveStreamingToolPreviewEmit("apply_patch", countBump, second.nextState);
  assert.equal(third.emit, true);
});

test("edit_file early preview when only path is streamed", () => {
  const partial = '{"path":"README.md","old_text":"';
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("edit_file", partial), true);
  assert.equal(hostToolArgumentsReadyForPreview("edit_file", partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments("edit_file", partial), {
    path: "README.md",
  });
});

test("create_file partial preview exposes path before content streams", () => {
  const partial = '{"path":"src/messages.ts","content":"';
  assert.deepEqual(previewRequestFromStreamingArguments("create_file", partial), {
    path: "src/messages.ts",
  });
});

test("create_plan early preview when only name is streamed", () => {
  const partial = '{"name":"random-fun-plan","content":"# Title';
  assert.equal(tryExtractPartialPlanName(partial), "random-fun-plan");
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("create_plan", partial), true);
  assert.equal(hostToolArgumentsReadyForPreview("create_plan", partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments("create_plan", partial), {
    name: "random-fun-plan",
  });
});

test("resolveStreamingToolPreviewEmit repeats for growing create_plan args", () => {
  const partial = '{"name":"demo-plan","content":"# ';
  const first = resolveStreamingToolPreviewEmit("create_plan", partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const longer = `${partial}${"x".repeat(500)}`;
  const second = resolveStreamingToolPreviewEmit("create_plan", longer, first.nextState);
  assert.equal(second.emit, true);
});

test("buildEarlyExecutableArgumentsJson waits for complete read_file JSON", () => {
  const partial = '{"path":"Cargo.toml","offset":';
  assert.equal(buildEarlyExecutableArgumentsJson("read_file", partial), undefined);
  assert.equal(readFilePartialAllowsEarlyExecution(partial), false);

  const pathOnly = '{"path":"package.json"';
  assert.equal(buildEarlyExecutableArgumentsJson("read_file", pathOnly), undefined);
  assert.equal(readFilePartialAllowsEarlyExecution(pathOnly), false);
  assert.deepEqual(previewRequestFromStreamingArguments("read_file", pathOnly), {
    path: "package.json",
  });

  const withLines = '{"path":"README.md","offset":10,"limit":41';
  assert.deepEqual(tryExtractPartialReadFileFields(withLines), {
    path: "README.md",
    offset: 10,
    limit: 41,
  });
  assert.equal(buildEarlyExecutableArgumentsJson("read_file", withLines), undefined);
  assert.equal(
    buildEarlyExecutableArgumentsJson("read_file", '{"path":"README.md","offset":10,"limit":41}'),
    '{"path":"README.md","offset":10,"limit":41}',
  );
});

test("resolveStreamingToolPreviewEmit repeats read_file preview when line range streams in", () => {
  const pathOnly = '{"path":"README.md"';
  const first = resolveStreamingToolPreviewEmit("read_file", pathOnly, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);
  assert.equal(readFileStreamingPreviewSignature(pathOnly), "README.md\0\0");

  const withOffset = '{"path":"README.md","offset":10';
  const second = resolveStreamingToolPreviewEmit("read_file", withOffset, first.nextState);
  assert.equal(second.emit, true);

  const withLimit = '{"path":"README.md","offset":10,"limit":41';
  const third = resolveStreamingToolPreviewEmit("read_file", withLimit, second.nextState);
  assert.equal(third.emit, true);

  const unchanged = resolveStreamingToolPreviewEmit("read_file", withLimit, third.nextState);
  assert.equal(unchanged.emit, false);
});

test("resolveStreamingToolPreviewEmit repeats create_file when content grows", () => {
  const partial = '{"path":"a.ts","content":"line';
  const first = resolveStreamingToolPreviewEmit("create_file", partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const longer = `${partial} one\\nline two`;
  const second = resolveStreamingToolPreviewEmit("create_file", longer, first.nextState);
  assert.equal(second.emit, true);

  const paddedSameShape = `${longer}${"x".repeat(80)}`;
  const third = resolveStreamingToolPreviewEmit("create_file", paddedSameShape, second.nextState);
  assert.equal(third.emit, true);
});

test("resolveStreamingToolPreviewEmit repeats edit_file when line delta changes", () => {
  const partial = '{"path":"README.md","old_text":"a\\nb","new_text":"a\\nb\\nc';
  const first = resolveStreamingToolPreviewEmit("edit_file", partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const withExtraLine = `${partial}\\nd`;
  const second = resolveStreamingToolPreviewEmit("edit_file", withExtraLine, first.nextState);
  assert.equal(second.emit, true);

  const paddedSameDelta = `${withExtraLine}${"x".repeat(500)}`;
  const third = resolveStreamingToolPreviewEmit("edit_file", paddedSameDelta, second.nextState);
  assert.equal(third.emit, false);
});

test("web_search early preview extracts query from incomplete JSON", () => {
  const partial = '{"query":"what is the Spirit project"';
  assert.equal(tryExtractPartialWebSearchQuery(partial), "what is the Spirit project");
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("web_search", partial), true);
  assert.equal(hostToolArgumentsReadyForPreview("web_search", partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments("web_search", partial), {
    query: "what is the Spirit project",
  });
});

test("resolveStreamingToolPreviewEmit repeats web_search preview when query grows", () => {
  const partial = '{"query":"Spirit';
  const first = resolveStreamingToolPreviewEmit("web_search", partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);
  assert.equal(webSearchStreamingPreviewSignature(partial), "Spirit");

  const longer = '{"query":"Spirit docs"';
  const second = resolveStreamingToolPreviewEmit("web_search", longer, first.nextState);
  assert.equal(second.emit, true);

  const unchanged = resolveStreamingToolPreviewEmit("web_search", longer, second.nextState);
  assert.equal(unchanged.emit, false);
});

test("subagent early preview extracts task from incomplete JSON", () => {
  const partial = '{"task":"Explore the repo and summarize"';
  assert.equal(tryExtractPartialSubagentTask(partial), "Explore the repo and summarize");
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview("subagent", partial), true);
  assert.equal(hostToolArgumentsReadyForPreview("subagent", partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments("subagent", partial), {
    task: "Explore the repo and summarize",
  });
});

test("resolveStreamingToolPreviewEmit repeats subagent preview when task grows", () => {
  const partial = '{"task":"Explore';
  const first = resolveStreamingToolPreviewEmit("subagent", partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);
  assert.equal(subagentStreamingPreviewSignature(partial), "Explore");

  const longer = '{"task":"Explore the repo"';
  const second = resolveStreamingToolPreviewEmit("subagent", longer, first.nextState);
  assert.equal(second.emit, true);

  const unchanged = resolveStreamingToolPreviewEmit("subagent", longer, second.nextState);
  assert.equal(unchanged.emit, false);
});

test("resolveStreamingToolPreviewEmit repeats tool_call when lazy gateway fields stream in", () => {
  const gatewayTool =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{';
  const first = resolveStreamingToolPreviewEmit("tool_call", gatewayTool, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const withTitle =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI daily news briefing"';
  const second = resolveStreamingToolPreviewEmit("tool_call", withTitle, first.nextState);
  assert.equal(second.emit, true);

  const withTrigger =
    '{"provider":"built-in","server":"desktop","tool":"create_automation","arguments":{"title":"AI daily news briefing","trigger":{"kind":"time","schedule":{"kind":"daily","hour":8,"minute":0}}}}';
  const third = resolveStreamingToolPreviewEmit("tool_call", withTrigger, second.nextState);
  assert.equal(third.emit, true);

  const unchanged = resolveStreamingToolPreviewEmit("tool_call", withTrigger, third.nextState);
  assert.equal(unchanged.emit, false);
});
