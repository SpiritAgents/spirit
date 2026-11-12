import { expect, it } from "vitest";
import { backgroundTaskOutputKind } from "./background-task-path.js";

it("recognizes only typed background output filenames on both path formats", () => {
  expect(backgroundTaskOutputKind("/data/background-tasks/shell-task_012345abcdef.log")).toBe(
    "shell",
  );
  expect(
    backgroundTaskOutputKind("C:\\data\\background-tasks\\subagent-task_012345abcdef.md"),
  ).toBe("subagent");
  for (const file of [
    "/data/shell-task_012345abcdef.log",
    "/data/background-tasks/subagent-task_012345abcdef.log",
    "/data/background-tasks/task_012345abcdef.json",
    "/data/tool-output-archives/shell-task_012345abcdef.log",
    "/data/background-tasks/shell-task_012345abcdef.log/other",
  ])
    expect(backgroundTaskOutputKind(file)).toBeUndefined();
});
