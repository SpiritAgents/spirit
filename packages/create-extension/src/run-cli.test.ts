import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, test, vi } from "vitest";

import type { InitExtensionOptions, InitExtensionResult } from "./init.js";
import type { PartialInitOptions } from "./prompts.js";

const { initExtension, promptForInitOptions } = vi.hoisted(() => ({
  initExtension: vi.fn<(options: InitExtensionOptions) => Promise<InitExtensionResult>>(),
  promptForInitOptions:
    vi.fn<(partial: PartialInitOptions) => Promise<Omit<InitExtensionOptions, "targetDir">>>(),
}));

vi.mock("./init.js", () => ({
  initExtension,
}));

vi.mock("./prompts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompts.js")>();
  return {
    ...actual,
    promptForInitOptions,
  };
});

import { runCreateExtensionCli } from "./run-cli.js";

const wizardOptions = {
  name: "from-wizard",
  displayName: "From Wizard",
  description: "desc",
  capabilities: [] as const,
};

function stubInitSuccess(targetDir: string): void {
  initExtension.mockResolvedValue({
    targetDir,
    filesWritten: [],
    registryEntry: {},
  });
}

function withTty<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: enabled });
  return run().finally(() => {
    if (previous) {
      Object.defineProperty(process.stdout, "isTTY", previous);
      return;
    }
    delete (process.stdout as { isTTY?: boolean }).isTTY;
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

test("interactive init without a positional uses the wizard name as the target directory", async () => {
  promptForInitOptions.mockResolvedValue(wizardOptions);
  stubInitSuccess(path.resolve("from-wizard"));

  const exitCode = await withTty(true, () => runCreateExtensionCli([]));

  assert.equal(exitCode, 0);
  assert.equal(promptForInitOptions.mock.calls.length, 1);
  assert.deepEqual(initExtension.mock.calls[0]?.[0].targetDir, path.resolve("from-wizard"));
});

test("interactive init keeps an explicit positional target after the wizard", async () => {
  promptForInitOptions.mockResolvedValue(wizardOptions);
  stubInitSuccess(path.resolve("custom-dir"));

  const exitCode = await withTty(true, () => runCreateExtensionCli(["custom-dir"]));

  assert.equal(exitCode, 0);
  assert.deepEqual(initExtension.mock.calls[0]?.[0].targetDir, path.resolve("custom-dir"));
});
