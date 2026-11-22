import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { developmentTurboBuildPlans } from "../scripts/build-dev-deps.mjs";
import { buildNativeAppkit } from "../scripts/build-native-appkit.mjs";
import { computeBrandAssetsStamp, isBrandAssetsUpToDate } from "../scripts/gen-brand-assets.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-dev-cache-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("desktop dev startup build helpers", () => {
  it("excludes @spiritagent/web from dev runtime Turbo build plans", () => {
    const plans = developmentTurboBuildPlans();
    expect(plans).toHaveLength(2);
    expect(plans[0]).toContain("--filter=@spiritagent/extensions");
    expect(plans[0]).not.toContain("--filter=@spiritagent/workbench");
    expect(plans[0]).not.toContain("--filter=@spiritagent/web");
    expect(plans[1]).toEqual([
      "exec",
      "turbo",
      "run",
      "build",
      "--only",
      "--filter=@spiritagent/workbench",
    ]);
  });

  it("reuses brand assets only when inputs and expected outputs match the stamp", () => {
    const dir = makeTempDir();
    const inputFile = path.join(dir, "logo.svg");
    const outFile = path.join(dir, "icon.png");
    const stampFile = path.join(dir, ".brand-assets-stamp.json");
    fs.writeFileSync(inputFile, "<svg/>");

    const stamp = computeBrandAssetsStamp([inputFile], "darwin");
    expect(isBrandAssetsUpToDate({ stampFile, expectedOutputs: [outFile], stamp })).toBe(false);

    fs.writeFileSync(outFile, "png-bytes");
    fs.writeFileSync(stampFile, JSON.stringify(stamp));
    expect(isBrandAssetsUpToDate({ stampFile, expectedOutputs: [outFile], stamp })).toBe(true);

    fs.writeFileSync(inputFile, "<svg><rect/></svg>");
    const nextStamp = computeBrandAssetsStamp([inputFile], "darwin");
    expect(isBrandAssetsUpToDate({ stampFile, expectedOutputs: [outFile], stamp: nextStamp })).toBe(
      false,
    );
  });

  it("skips native appkit rebuild when sources and target match the cached stamp", () => {
    const dir = makeTempDir();
    const appkitRoot = path.join(dir, "native", "appkit");
    const desktopRoot = path.join(dir, "desktop");
    fs.mkdirSync(path.join(appkitRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(appkitRoot, "binding.gyp"), "{}");
    fs.writeFileSync(path.join(appkitRoot, "src", "appkit.mm"), "// v1");

    let rebuildCount = 0;
    const fakeRebuild = ({ rootDir }) => {
      rebuildCount += 1;
      const releaseDir = path.join(rootDir, "build", "Release");
      fs.mkdirSync(releaseDir, { recursive: true });
      fs.writeFileSync(path.join(releaseDir, "spirit_desktop_appkit.node"), `bin-${rebuildCount}`);
    };

    const first = buildNativeAppkit({
      platform: "darwin",
      appkitRoot,
      desktopRoot,
      electronVersion: "43.8.1",
      arch: "arm64",
      rebuild: fakeRebuild,
    });
    expect(first).toEqual({ skipped: false, reused: false });
    expect(rebuildCount).toBe(1);

    const destAddon = path.join(
      desktopRoot,
      "dist-electron",
      "native",
      "spirit_desktop_appkit.node",
    );
    expect(fs.readFileSync(destAddon, "utf8")).toBe("bin-1");

    // Removing dist-electron output still reuses the compiled Release artifact without rebuilding.
    fs.rmSync(destAddon);
    const second = buildNativeAppkit({
      platform: "darwin",
      appkitRoot,
      desktopRoot,
      electronVersion: "43.8.1",
      arch: "arm64",
      rebuild: fakeRebuild,
    });
    expect(second).toEqual({ skipped: false, reused: true });
    expect(rebuildCount).toBe(1);
    expect(fs.readFileSync(destAddon, "utf8")).toBe("bin-1");

    // Editing a native source invalidates the stamp and triggers a rebuild.
    fs.writeFileSync(path.join(appkitRoot, "src", "appkit.mm"), "// v2");
    const third = buildNativeAppkit({
      platform: "darwin",
      appkitRoot,
      desktopRoot,
      electronVersion: "43.8.1",
      arch: "arm64",
      rebuild: fakeRebuild,
    });
    expect(third).toEqual({ skipped: false, reused: false });
    expect(rebuildCount).toBe(2);
    expect(fs.readFileSync(destAddon, "utf8")).toBe("bin-2");
  });
});
