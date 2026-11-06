import { describe, expect, it } from "vitest";

import {
  formatBackgroundTaskNotification,
  isBackgroundTaskTerminal,
  parseBackgroundOptions,
  parseDelayRequest,
  type BackgroundTaskRecord,
} from "./background-tasks.js";
import { buildBuiltinHostToolDefinitions, readHostFunctionToolName } from "./host-tools.js";
import { buildSubagentUserTurn } from "./runtime.js";
import { isJsonObject } from "./tool-agent.js";

const environment = { shellDisplayName: "Shell", commandParameterDescription: "Command." };

describe("background task contracts", () => {
  it("only exposes background controls when the host supports them", () => {
    const disabled = buildBuiltinHostToolDefinitions(environment);
    expect(disabled.map(readHostFunctionToolName)).not.toContain("delay");
    const enabled = buildBuiltinHostToolDefinitions({
      ...environment,
      backgroundTasksEnabled: true,
    });
    expect(enabled.map(readHostFunctionToolName)).toContain("delay");
    expect(enabled.map(readHostFunctionToolName)).toContain("stop_task");
    for (const [definitions, background] of [
      [disabled, false],
      [enabled, true],
    ] as const) {
      const definition = definitions.find(
        (entry) => readHostFunctionToolName(entry) === "subagent",
      );
      expect(isJsonObject(definition)).toBe(true);
      if (!isJsonObject(definition) || !isJsonObject(definition.function)) {
        throw new Error("Missing subagent definition.");
      }
      const parameters = definition.function.parameters;
      if (!isJsonObject(parameters) || !isJsonObject(parameters.properties)) {
        throw new Error("Missing subagent parameters.");
      }
      expect(parameters.required).toEqual(["prompt"]);
      expect(Object.keys(parameters.properties).sort()).toEqual(
        background
          ? ["background", "prompt", "session_id", "worktree"]
          : ["prompt", "session_id", "worktree"],
      );
      const sessionIdSchema = parameters.properties.session_id;
      const worktreeSchema = parameters.properties.worktree;
      if (!isJsonObject(sessionIdSchema) || !isJsonObject(worktreeSchema)) {
        throw new Error("Missing subagent continuation schemas.");
      }
      expect(String(sessionIdSchema.description)).toContain("another agent is left untouched");
      expect(String(worktreeSchema.description)).toContain("persist that location");
    }
  });

  it("passes the child prompt without extra scaffolding", () => {
    const prompt = "Investigate the parser.\n\nReturn the relevant implementation paths.";
    expect(buildSubagentUserTurn({ prompt })).toBe(prompt);
  });

  it("validates background options without clamping", () => {
    expect(parseBackgroundOptions(undefined)).toBeUndefined();
    expect(parseBackgroundOptions({})).toEqual({});
    expect(parseBackgroundOptions({ type: false, delay: 0 })).toEqual({ type: false, delay: 0 });
    for (const value of [
      null,
      [],
      true,
      { type: "true" },
      { delay: -1 },
      { delay: Infinity },
      { extra: 1 },
    ]) {
      expect(() => parseBackgroundOptions(value)).toThrow();
    }
  });

  it("supports duration, task, and bounded task waits", () => {
    expect(parseDelayRequest({ seconds: 0 })).toEqual({ seconds: 0 });
    expect(parseDelayRequest({ task_id: "task_one" })).toEqual({ task_id: "task_one" });
    expect(parseDelayRequest({ seconds: 252, task_id: "task_one" })).toEqual({
      seconds: 252,
      task_id: "task_one",
    });
    for (const value of [{}, { seconds: -1 }, { seconds: null }, { task_id: "" }]) {
      expect(() => parseDelayRequest(value)).toThrow();
    }
  });

  it("reports recovery duration and unknown exit status without embedding output", () => {
    const record: BackgroundTaskRecord = {
      version: 1,
      id: "task_one",
      sessionKey: "conversation",
      runtimeId: "main",
      toolCallId: "call_one",
      kind: "shell",
      input: "node build.mjs\n",
      argumentsJson: "{}",
      owner: { id: "host_one", pid: 100 },
      status: "interrupted",
      background: true,
      outputPath: "/data/background-tasks/shell-task_one.log",
      startedAtUnixMs: 1000,
      updatedAtUnixMs: 13000,
      elapsedMs: 12000,
      elapsedApproximate: true,
    };
    const notification = formatBackgroundTaskNotification(record);
    expect(notification).toContain("elapsed_seconds: 12");
    expect(notification).toContain("exit_code: unknown");
    expect(notification).toContain('command: "node build.mjs\\n"');
    expect(notification).toContain("last recorded duration");
    expect(notification).toContain("Read the output file");
    expect(isBackgroundTaskTerminal("interrupted")).toBe(true);
    expect(isBackgroundTaskTerminal("blocked")).toBe(false);
    expect(() => formatBackgroundTaskNotification({ ...record, status: "running" })).toThrow();
  });
});
