import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "vitest";
import { product } from "@spiritagent/product";
import { configureElectronProductStorage } from "../../electron/product-storage.ts";

test("Electron keeps Chromium data under appData independently of shared storage", () => {
  const calls = [];
  const appData = mkdtempSync(path.join(tmpdir(), "product-private-"));
  try {
    configureElectronProductStorage({
      setName: (name) => calls.push(["name", name]),
      getPath: (name) => {
        assert.equal(name, "appData");
        return appData;
      },
      setPath: (name, value) => {
        assert.ok(statSync(value).isDirectory());
        calls.push([name, value]);
      },
    });
    assert.deepEqual(calls, [
      ["name", product.name],
      ["userData", path.join(appData, product.name)],
      ["sessionData", path.join(appData, product.name)],
    ]);
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});

test("Electron private directory errors propagate instead of falling back to shared data", () => {
  const appData = mkdtempSync(path.join(tmpdir(), "product-private-error-"));
  try {
    writeFileSync(path.join(appData, product.name), "not a directory");
    assert.throws(
      () =>
        configureElectronProductStorage({
          setName: () => {},
          getPath: () => appData,
          setPath: () => assert.fail("Cannot set a path that could not be created"),
        }),
      { code: "EEXIST" },
    );
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});
