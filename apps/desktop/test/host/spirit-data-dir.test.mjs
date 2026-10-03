import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { product } from "@spiritagent/product";

import {
  resolveConfiguredSpiritDataDir,
  resolveDefaultSpiritDataDir,
} from "../../dist-electron/src/host/storage.js";

async function withEnv(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("resolveDefaultSpiritDataDir uses the product directory under home", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "spirit-home-"));
  try {
    await withEnv(
      {
        APPDATA: path.join(home, "legacy-appdata"),
        HOME: home,
        USERPROFILE: home,
        SPIRIT_DATA_DIR: undefined,
      },
      async () => {
        assert.equal(resolveDefaultSpiritDataDir(), path.join(home, product.userDataFolderName));
      },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("resolveConfiguredSpiritDataDir honors SPIRIT_DATA_DIR", async () => {
  await withEnv(
    {
      SPIRIT_DATA_DIR: "/tmp/spirit-custom-data-dir",
      APPDATA: "/tmp/spirit-appdata",
      HOME: "/tmp/spirit-home",
    },
    async () => {
      assert.equal(resolveConfiguredSpiritDataDir(), "/tmp/spirit-custom-data-dir");
    },
  );
});
