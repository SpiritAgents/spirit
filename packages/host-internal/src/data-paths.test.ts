import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";
import { product } from "@spiritagent/product";
import {
  hooksUserConfigPath,
  hooksWorkspaceConfigPath,
  hooksWorkspaceScriptsDir,
  mcpUserConfigPath,
  mcpWorkspaceConfigPath,
  resolveDefaultSpiritDataDir,
  resolveSpiritDataDir,
  resolveWorkspaceDataDir,
} from "./data-paths.js";

for (const platform of ["darwin", "linux", "win32"] as const) {
  test(`shared data uses the product home directory on ${platform}, not application data`, () => {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const home = platform === "win32" ? "C:\\Users\\fixture" : "/fixture/home";
    const env = {
      HOME: platform === "win32" ? "/must-not-use" : home,
      USERPROFILE: platform === "win32" ? home : "/must-not-use",
      APPDATA: "/legacy/appdata",
      XDG_DATA_HOME: "/legacy/xdg",
    };
    assert.equal(
      resolveDefaultSpiritDataDir({
        platform,
        env,
        homeDirectory: () => {
          throw new Error("Home fallback must not run");
        },
      }),
      paths.join(home, product.userDataFolderName),
    );
    assert.equal(
      resolveSpiritDataDir({ platform, env: { ...env, SPIRIT_DATA_DIR: "  /explicit/root  " } }),
      "/explicit/root",
    );
  });
}

test("an absent home fails explicitly and a host-provided home fallback is supported", () => {
  assert.throws(
    () => resolveDefaultSpiritDataDir({ env: {}, homeDirectory: () => "" }),
    /Cannot resolve the user home directory/,
  );
  assert.equal(
    resolveDefaultSpiritDataDir({
      platform: "linux",
      env: { HOME: " " },
      homeDirectory: () => "/fallback/home",
    }),
    path.posix.join("/fallback/home", product.userDataFolderName),
  );
});

test("workspace configuration uses the common product directory, not the user quality root", () => {
  const root = path.resolve("fixture-workspace");
  const workspaceData = path.join(root, product.workspaceDataFolderName);
  assert.equal(resolveWorkspaceDataDir(root), workspaceData);
  assert.equal(mcpWorkspaceConfigPath(root), path.join(workspaceData, "mcp.json"));
  assert.equal(hooksWorkspaceConfigPath(root), path.join(workspaceData, "hooks.json"));
  assert.equal(hooksWorkspaceScriptsDir(root), path.join(workspaceData, "hooks"));
  assert.equal(mcpUserConfigPath(root), path.join(root, "mcp.json"));
  assert.equal(hooksUserConfigPath(root), path.join(root, "hooks.json"));
});
