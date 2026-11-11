import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectTaskVariableStrings,
  findUnsupportedTaskVariable,
  isSupportedTaskVariable,
  substituteTaskVariables,
  usesWorkspaceFolderVariable,
  type TaskVariableContext,
} from "./variables.js";

const CONTEXT: TaskVariableContext = {
  workspaceFolder: "/ws/app",
  cwd: "/ws/app",
  userHome: "/home/user",
  env: { TOKEN: "abc" },
  pathSeparator: "/",
};

test("substitutes every supported variable", () => {
  assert.equal(
    substituteTaskVariables(
      "${workspaceFolder}|${workspaceFolderBasename}|${cwd}|${userHome}|${pathSeparator}|${env:TOKEN}",
      CONTEXT,
    ),
    "/ws/app|app|/ws/app|/home/user|/|abc",
  );
});

test("substitutes the ${/} path separator alias", () => {
  assert.equal(substituteTaskVariables("a${/}b", CONTEXT), "a/b");
  assert.equal(substituteTaskVariables("a${/}b", { ...CONTEXT, pathSeparator: "\\" }), "a\\b");
});

test("substitutes missing env variables with an empty string", () => {
  assert.equal(substituteTaskVariables("[${env:MISSING}]", CONTEXT), "[]");
});

test("derives workspaceFolderBasename from both separator styles", () => {
  assert.equal(substituteTaskVariables("${workspaceFolderBasename}", CONTEXT), "app");
  assert.equal(
    substituteTaskVariables("${workspaceFolderBasename}", {
      ...CONTEXT,
      workspaceFolder: "C:\\ws\\app",
      pathSeparator: "\\",
    }),
    "app",
  );
});

test("leaves workspace folder variables untouched when no workspaceFolder is provided", () => {
  const context: TaskVariableContext = {
    cwd: "/tmp",
    userHome: "/home/user",
    env: {},
    pathSeparator: "/",
  };
  assert.equal(substituteTaskVariables("${workspaceFolder}/x", context), "${workspaceFolder}/x");
});

test("flags every unsupported variable", () => {
  const unsupported = [
    "${file}",
    "${input:foo}",
    "${config:x}",
    "${command:x}",
    "${selectedText}",
    "${defaultBuildTask}",
    "${lineNumber}",
  ];
  for (const reference of unsupported) {
    const name = reference.slice(2, -1);
    assert.equal(isSupportedTaskVariable(name), false, reference);
    assert.equal(findUnsupportedTaskVariable([`run ${reference} now`]), name, reference);
  }
});

test("accepts the supported variable set", () => {
  assert.equal(
    findUnsupportedTaskVariable([
      "${workspaceFolder} ${workspaceFolderBasename} ${cwd} ${userHome} ${pathSeparator} ${/} ${env:X}",
    ]),
    undefined,
  );
});

test("detects workspace folder variable usage", () => {
  assert.equal(usesWorkspaceFolderVariable(["${workspaceFolder}/x"]), true);
  assert.equal(usesWorkspaceFolderVariable(["${workspaceFolderBasename}"]), true);
  assert.equal(usesWorkspaceFolderVariable(["${cwd}", "${env:X}"]), false);
});

test("collectTaskVariableStrings covers command, args, cwd, env values and shell", () => {
  const strings = collectTaskVariableStrings(
    { value: "${command}", quoting: "strong" },
    ["plain", { value: "${arg}", quoting: "weak" }],
    {
      cwd: "${cwdVar}",
      env: { A: "${envVar}" },
      shell: { executable: "${shellExe}", args: ["${shellArg}"] },
    },
  );
  assert.deepEqual(strings, [
    "${command}",
    "plain",
    "${arg}",
    "${cwdVar}",
    "${envVar}",
    "${shellExe}",
    "${shellArg}",
  ]);
});

test("collectTaskVariableStrings covers the command array form", () => {
  assert.deepEqual(collectTaskVariableStrings(["a", "b"], undefined, undefined), ["a", "b"]);
});
