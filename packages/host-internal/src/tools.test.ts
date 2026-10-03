import { product } from "@spiritagent/product";
import { test } from "vitest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { NodeHostToolService, type HostToolExecutionOutput } from "./tools.js";
import { SPIRIT_CONFIG_SCHEMA_VERSION } from "./config-v2.js";
import { configFilePath } from "./credentials/spirit-config.js";
import { loadPermissionConfig } from "./permissions/index.js";

const execFileAsync = promisify(execFile);

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zp1cAAAAASUVORK5CYII=";

function createMockImageFetch(): typeof fetch {
  return (async () => {
    const bytes = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");
    return {
      status: 200,
      url: "https://example.com/final-image",
      headers: new Headers({
        "content-type": "image/png",
      }),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => {
        throw new Error("image response should not be read as text");
      },
    } as unknown as Response;
  }) as typeof fetch;
}

test("read_file returns unsupported image text without image part when model blocks image input", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-image-blocked-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const imagePath = join(workspaceRoot, "blocked.png");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: {},
        }),
      },
    );

    const output = await service.execute({
      name: "read_file",
      path: imagePath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /This model does not support image input/u);
    assert.equal(
      output.content.some((part) => part.type === "image"),
      false,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test("read_file returns unsupported video text without video part when model blocks video input", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-video-blocked-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const videoPath = join(workspaceRoot, "blocked.mp4");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(videoPath, MINIMAL_MP4_HEADER);

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: {},
        }),
      },
    );

    const output = await service.execute({
      name: "read_file",
      path: videoPath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /This model does not support video input/u);
    assert.equal(
      output.content.some((part) => part.type === "video"),
      false,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("read_file still returns video part when model explicitly supports video input", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-video-allowed-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const videoPath = join(workspaceRoot, "allowed.mp4");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(videoPath, MINIMAL_MP4_HEADER);

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { videoInput: true },
        }),
      },
    );

    const output = await service.execute({
      name: "read_file",
      path: videoPath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /Video file returned as video input/u);
    assert.equal(
      output.content.some((part) => part.type === "video"),
      true,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("read_file still returns image part when model explicitly supports image input", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-image-allowed-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const imagePath = join(workspaceRoot, "allowed.png");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { imageInput: true },
        }),
      },
    );

    const output = await service.execute({
      name: "read_file",
      path: imagePath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /Image file returned as image input/u);
    assert.equal(
      output.content.some((part) => part.type === "image"),
      true,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const ICO_HEADER = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

test("read_file returns image part for validated ico files", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-image-ico-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const imagePath = join(workspaceRoot, "favicon.ico");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(imagePath, ICO_HEADER);

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { imageInput: true },
        }),
      },
    );

    const output = await service.execute({
      name: "read_file",
      path: imagePath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /^\[read image\]/u);
    assert.match(output.summaryText, /mime_type: image\/x-icon/u);
    assert.equal(
      output.content.some((part) => part.type === "image"),
      true,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("web_fetch executes in background like shell", () => {
  const service = new NodeHostToolService(
    { workspaceRoot: "/tmp", spiritDataDir: "/tmp/.spirit-data" },
    { getApprovalLevel: () => "bypass-approval" },
  );
  assert.equal(
    service.shouldExecuteInBackground?.({ name: "web_fetch", url: "https://example.com/" }),
    true,
  );
  assert.equal(
    service.backgroundStatusText?.({ name: "web_fetch", url: "https://example.com/" }),
    undefined,
  );
});

test("web_fetch returns image part for supported remote image responses", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-web-fetch-image-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const originalFetch = globalThis.fetch;

  try {
    await mkdir(spiritDataDir, { recursive: true });
    globalThis.fetch = createMockImageFetch();

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { imageInput: true },
        }),
      },
    );

    const output = await service.execute({
      name: "web_fetch",
      url: "https://example.com/source-image",
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /^\[web image\]/u);
    assert.equal(
      output.content.some((part) => part.type === "image"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("web_fetch returns blocked-image text without image part for remote image responses", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-web-fetch-blocked-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const originalFetch = globalThis.fetch;

  try {
    await mkdir(spiritDataDir, { recursive: true });
    globalThis.fetch = createMockImageFetch();

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: {},
        }),
      },
    );

    const output = await service.execute({
      name: "web_fetch",
      url: "https://example.com/source-image",
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /This model does not support image input/u);
    assert.equal(
      output.content.some((part) => part.type === "image"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const MINIMAL_MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

test("saveGeneratedImage returns a managed markdown reference instead of a raw local path", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-generated-image-ref-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const saved = await service.saveGeneratedImage({
      data: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      mediaType: "image/png",
      prompt: "concept image",
      model: "test-image-model",
    });

    assert.equal(dirname(saved.path), join(spiritDataDir, "generated-images"));
    assert.equal(
      saved.markdownRef,
      `${product.urlProtocol}://generated/image/${encodeURIComponent(basename(saved.path))}`,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("saveGeneratedVideo returns a managed markdown reference instead of a raw local path", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-generated-video-ref-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const saved = await service.saveGeneratedVideo({
      data: MINIMAL_MP4_BYTES,
      mediaType: "video/mp4",
      prompt: "concept video",
      model: "test-video-model",
    });

    assert.equal(dirname(saved.path), join(spiritDataDir, "generated-videos"));
    assert.equal(
      saved.markdownRef,
      `${product.urlProtocol}://generated/video/${encodeURIComponent(basename(saved.path))}`,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("read_file accepts Spirit-managed generated image refs without leaking local paths", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-managed-image-read-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { imageInput: true },
        }),
      },
    );

    const saved = await service.saveGeneratedImage({
      data: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      mediaType: "image/png",
      prompt: "concept image",
      model: "test-image-model",
    });

    const authorization = await service.authorize({
      name: "read_file",
      path: saved.markdownRef ?? "",
    });
    assert.deepEqual(authorization, { kind: "allowed" });

    const output = await service.execute({
      name: "read_file",
      path: saved.markdownRef ?? "",
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /^\[read image\]/u);
    assert.match(output.summaryText, new RegExp(`path: ${escapeRegExp(saved.markdownRef ?? "")}`));
    assert.doesNotMatch(output.summaryText, new RegExp(escapeRegExp(saved.path)));
    assert.equal(
      output.content.some((part) => part.type === "image"),
      true,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("read_file accepts Spirit-managed generated image refs with mixed-case URL scheme and host", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-managed-image-read-case-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { imageInput: true },
        }),
      },
    );

    const saved = await service.saveGeneratedImage({
      data: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      mediaType: "image/png",
      prompt: "concept image",
      model: "test-image-model",
    });
    const mixedCaseRef = saved.markdownRef.replace(
      `${product.urlProtocol}://generated/image/`,
      `${product.urlProtocol.toUpperCase()}://GENERATED/image/`,
    );

    const authorization = await service.authorize({
      name: "read_file",
      path: mixedCaseRef,
    });
    assert.deepEqual(authorization, { kind: "allowed" });

    const output = await service.execute({
      name: "read_file",
      path: mixedCaseRef,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, new RegExp(`path: ${escapeRegExp(mixedCaseRef)}`));
    assert.equal(
      output.content.some((part) => part.type === "image"),
      true,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("read_file missing Spirit-managed generated image ref reports sanitized error", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "spirit-host-tools-missing-managed-image-read-"),
  );
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const missingRef = `${product.urlProtocol}://generated/image/missing-image.png`;
  const leakedLocalPath = join(spiritDataDir, "generated-images", "missing-image.png");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: "read_file",
          path: missingRef,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(escapeRegExp(missingRef)));
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(leakedLocalPath)));
        return true;
      },
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("read_file reports canonical path for non-managed files", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-read-file-canonical-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  const nestedDir = join(workspaceRoot, "nested");
  const filePath = join(nestedDir, "note.txt");

  try {
    await mkdir(nestedDir, { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(filePath, "alpha\nbeta\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "read_file",
      path: "./nested/../nested/note.txt",
      offset: 1,
      limit: 1,
    });

    assertHostToolExecutionOutput(output);
    // The tool reports the realpath'd canonical path; on macOS tmpdir() is a
    // /var symlink, so compare against the canonical form of the fixture.
    assert.match(
      output.summaryText,
      new RegExp(`^\\[read\\]\\npath: ${escapeRegExp(await realpath(filePath))}\\nrange: 1-1`, "u"),
    );
    assert.doesNotMatch(output.summaryText, /\.\/nested\/\.\.\/nested\/note\.txt/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep limits search to files matched by glob", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-glob-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(join(workspaceRoot, "src"), { recursive: true });
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "src", "app.ts"), "needle here\n");
    await writeFile(join(workspaceRoot, "docs", "readme.md"), "needle here\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      glob: "src/**/*.ts",
    });

    assertTextToolOutput(output);
    assert.match(output, /src\/app\.ts:1:needle here/u);
    assert.doesNotMatch(output, /readme\.md/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep rejects glob patterns that escape the workspace", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-glob-escape-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: "grep",
          pattern: "needle",
          glob: "../**/*.ts",
        }),
      /glob pattern must not escape the workspace/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall parses grep glob", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-glob-parse-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      "grep",
      '{"pattern":"needle","glob":"src/**/*.ts"}',
    );

    assert.deepEqual(request, {
      name: "grep",
      pattern: "needle",
      glob: "src/**/*.ts",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep matches ripgrep regular expressions by default", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-regexp-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "runtime    parity\nsecond line\n");
    await writeFile(join(workspaceRoot, "beta.txt"), "no match here\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "runtime\\s+parity",
    });

    assertTextToolOutput(output);
    assert.match(output, /alpha\.txt:1:runtime    parity/u);
    assert.doesNotMatch(output, /beta\.txt/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep is case-sensitive by default and -i ignores case", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-case-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "Runtime    parity\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const sensitive = await service.execute({
      name: "grep",
      pattern: "runtime",
    });
    assertTextToolOutput(sensitive);
    assert.equal(sensitive, "No matches found");

    const insensitive = await service.execute({
      name: "grep",
      pattern: "runtime",
      caseInsensitive: true,
    });
    assertTextToolOutput(insensitive);
    assert.match(insensitive, /alpha\.txt:1:Runtime    parity/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep lists matching files in files_with_matches mode", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-files-mode-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "needle one\nneedle two\n");
    await writeFile(join(workspaceRoot, "beta.txt"), "needle here\n");
    await writeFile(join(workspaceRoot, "gamma.txt"), "no hit\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      outputMode: "files_with_matches",
    });

    assertTextToolOutput(output);
    assert.match(output, /^alpha\.txt$/mu);
    assert.match(output, /^beta\.txt$/mu);
    assert.doesNotMatch(output, /gamma\.txt/u);
    assert.doesNotMatch(output, /needle one/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep reports per-file counts in count_matches mode", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-count-mode-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "needle one\nneedle two\n");
    await writeFile(join(workspaceRoot, "beta.txt"), "needle here\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      outputMode: "count_matches",
    });

    assertTextToolOutput(output);
    assert.match(output, /^alpha\.txt:2$/mu);
    assert.match(output, /^beta\.txt:1$/mu);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep pages content results with head_limit and offset", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-paging-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "needle 1\nneedle 2\nneedle 3\nneedle 4\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const firstPage = await service.execute({
      name: "grep",
      pattern: "needle",
      headLimit: 2,
    });
    assertTextToolOutput(firstPage);
    assert.match(firstPage, /alpha\.txt:1:needle 1\nalpha\.txt:2:needle 2\n/u);
    assert.doesNotMatch(firstPage, /needle 3/u);
    assert.match(
      firstPage,
      /\[truncated\] Showing 2 of 4 matches \(offset 0\)\. Pass offset 2 to continue\./u,
    );

    const secondPage = await service.execute({
      name: "grep",
      pattern: "needle",
      headLimit: 2,
      offset: 2,
    });
    assertTextToolOutput(secondPage);
    assert.match(secondPage, /alpha\.txt:3:needle 3\nalpha\.txt:4:needle 4\n/u);
    assert.doesNotMatch(secondPage, /\[truncated\]/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep omits line numbers in content mode when -n is false", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-no-line-numbers-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "needle here\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      lineNumbers: false,
    });

    assertTextToolOutput(output);
    assert.match(output, /^alpha\.txt:needle here\n/mu);
    assert.doesNotMatch(output, /alpha\.txt:1:needle/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep shows context lines around matches with -C", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-context-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(
      join(workspaceRoot, "alpha.txt"),
      "before\nneedle one\nafter\nfiller\nfiller\nfiller\nbefore two\nneedle two\nafter two\n",
    );

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      contextLines: 1,
    });

    assertTextToolOutput(output);
    assert.match(
      output,
      /alpha\.txt-1-before\nalpha\.txt:2:needle one\nalpha\.txt-3-after\n--\nalpha\.txt-7-before two\nalpha\.txt:8:needle two\nalpha\.txt-9-after two\n/u,
    );
    assert.doesNotMatch(output, /filler/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep restricts search to a ripgrep file type", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-type-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.ts"), "needle\n");
    await writeFile(join(workspaceRoot, "beta.txt"), "needle\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      fileType: "ts",
    });

    assertTextToolOutput(output);
    assert.match(output, /alpha\.ts:1:needle/u);
    assert.doesNotMatch(output, /beta\.txt/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep searches gitignored files with include_ignored", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-ignored-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: workspaceRoot, windowsHide: true });
    await writeFile(join(workspaceRoot, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(workspaceRoot, "ignored.txt"), "needle here\n", "utf8");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
      includeIgnored: true,
    });

    assertTextToolOutput(output);
    assert.match(output, /ignored\.txt:1:needle here/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep matches across line boundaries with multiline", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-multiline-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "alpha.txt"), "foo\nbar\nplain\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "foo\\nbar",
      multiline: true,
    });

    assertTextToolOutput(output);
    assert.match(output, /alpha\.txt:1:foo\nbar/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall parses grep output mode and paging fields", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-parse-modes-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      "grep",
      '{"pattern":"needle","output_mode":"files_with_matches","head_limit":50,"offset":10,"-n":false}',
    );

    assert.deepEqual(request, {
      name: "grep",
      pattern: "needle",
      outputMode: "files_with_matches",
      headLimit: 50,
      offset: 10,
      lineNumbers: false,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall parses grep context options", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-parse-context-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      "grep",
      '{"pattern":"needle","-A":2,"-B":1,"-C":3}',
    );

    assert.deepEqual(request, {
      name: "grep",
      pattern: "needle",
      afterContext: 2,
      beforeContext: 1,
      contextLines: 3,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall parses grep type, include_ignored, and multiline", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-parse-filters-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      "grep",
      '{"pattern":"needle","type":"ts","include_ignored":true,"multiline":true}',
    );

    assert.deepEqual(request, {
      name: "grep",
      pattern: "needle",
      fileType: "ts",
      includeIgnored: true,
      multiline: true,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall rejects an unknown grep output mode", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-bad-mode-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () => service.requestFromFunctionCall("grep", '{"pattern":"needle","output_mode":"json"}'),
      /output_mode must be one of/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep rejects invalid regular expressions with a clear error", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-regexp-error-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: "grep",
          pattern: "(",
        }),
      /Invalid regex/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep skips files matched by .gitignore", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-gitignore-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: workspaceRoot, windowsHide: true });
    await writeFile(join(workspaceRoot, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(workspaceRoot, "ignored.txt"), "needle here\n", "utf8");
    await writeFile(join(workspaceRoot, "tracked.txt"), "needle here\n", "utf8");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "grep",
      pattern: "needle",
    });

    assertTextToolOutput(output);
    assert.match(output, /tracked\.txt:1:needle here/u);
    assert.doesNotMatch(output, /ignored\.txt/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("glob returns matching workspace files for a glob pattern", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-glob-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(join(workspaceRoot, "src", "nested"), { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, "src", "app.ts"), "export const app = 1;\n");
    await writeFile(join(workspaceRoot, "src", "nested", "util.ts"), "export const util = 1;\n");
    await writeFile(join(workspaceRoot, "src", "nested", "note.md"), "# note\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "glob",
      pattern: "src/**/*.ts",
    });

    assertTextToolOutput(output);
    assert.match(output, /^\[glob\]\npattern: src\/\*\*\/\*\.ts\nmatches: 2\n/mu);
    assert.match(output, /\nsrc\/app\.ts\n/u);
    assert.match(output, /\nsrc\/nested\/util\.ts\n/u);
    assert.doesNotMatch(output, /note\.md/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("glob skips files matched by .gitignore including dist directories", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-glob-gitignore-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(join(workspaceRoot, "src"), { recursive: true });
    await mkdir(join(workspaceRoot, "packages", "host-internal", "dist"), { recursive: true });
    await mkdir(join(workspaceRoot, "apps", "desktop", "dist-electron"), { recursive: true });
    await writeFile(join(workspaceRoot, ".gitignore"), "**/dist/\n**/dist-electron/\n", "utf8");
    await writeFile(join(workspaceRoot, "src", "app.ts"), "export const app = 1;\n");
    await writeFile(
      join(workspaceRoot, "packages", "host-internal", "dist", "index.js"),
      "module.exports = {};\n",
    );
    await writeFile(
      join(workspaceRoot, "apps", "desktop", "dist-electron", "main.js"),
      "module.exports = {};\n",
    );

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: "glob",
      pattern: "**/*",
    });

    assertTextToolOutput(output);
    assert.match(output, /\nsrc\/app\.ts\n/u);
    assert.doesNotMatch(output, /packages\/host-internal\/dist\//u);
    assert.doesNotMatch(output, /apps\/desktop\/dist-electron\//u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("glob rejects patterns that escape the workspace", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-glob-escape-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: "glob",
          pattern: "../**/*.ts",
        }),
      /glob pattern must not escape the workspace/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall parses glob pattern", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-glob-parse-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall("glob", '{"pattern":"src/**/*.ts"}');

    assert.deepEqual(request, {
      name: "glob",
      pattern: "src/**/*.ts",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall parses grep -i flag", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-search-parse-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      "grep",
      '{"pattern":"runtime\\\\s+parity","-i":true}',
    );

    assert.deepEqual(request, {
      name: "grep",
      pattern: "runtime\\s+parity",
      caseInsensitive: true,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("abortShell terminates a running shell by toolCallId", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-abort-shell-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = service.attachRequestMetadata!(
      {
        name: "shell",
        command: "sleep 30",
        reason: "test abort",
      },
      { toolCallId: "call_sleep_30", toolName: "shell" },
    );

    const executePromise = service.execute(request);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    assert.equal(service.abortShell("call_sleep_30"), true);
    assert.equal(service.abortShell("call_sleep_30"), false);
    assert.equal(service.abortShell("unknown-id"), false);

    const output = await executePromise;
    assertTextToolOutput(output);
    const parsed = JSON.parse(output) as { exitCode: number };
    assert.equal(parsed.exitCode, -1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize asks for shell commands that match no rule (fail-safe)", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-auth-default-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "default" },
    );
    const decision = await service.authorize({
      name: "shell",
      command: "echo hello",
      reason: "test",
    });

    assert.equal(decision.kind, "need-approval");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize allows shell commands under bypass-approval approval level", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-auth-full-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );
    const decision = await service.authorize({
      name: "shell",
      command: "echo hello",
      reason: "test",
    });

    assert.deepEqual(decision, { kind: "allowed" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize still requires ask_questions under bypass-approval approval level", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-auth-questions-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );
    const decision = await service.authorize({
      name: "ask_questions",
      questions: [
        {
          id: "q1",
          title: "Choose one",
          allowMultiple: false,
          options: [{ id: "a", label: "A" }],
        },
      ],
    });

    assert.equal(decision.kind, "need-questions");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize allows shell commands matched by an allow rule", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await writePermissionConfig(spiritDataDir, { shell: { "echo *": "allow" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({
      name: "shell",
      command: "echo hello",
      reason: "test",
    });

    assert.deepEqual(decision, { kind: "allowed" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize asks for shell commands matched by an ask rule and offers remembering", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await writePermissionConfig(spiritDataDir, { shell: { "npm *": "ask" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({
      name: "shell",
      command: "npm test",
      reason: "test",
    });

    assert.ok(decision.kind === "need-approval");
    assert.match(decision.prompt, /High-risk tool call: shell/u);
    assert.deepEqual(decision.rememberTarget, { kind: "shell", command: "npm test" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize denies shell commands matched by a deny rule and names the rule", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await writePermissionConfig(spiritDataDir, { shell: { "rm -rf *": "deny" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({
      name: "shell",
      command: "rm -rf build-output",
      reason: "test",
    });

    assert.deepEqual(decision, {
      kind: "denied",
      reason:
        'command segment "rm -rf build-output" matched deny rule "rm -rf *" in permission.shell',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize denies a composite shell command when a later segment matches a deny rule", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await writePermissionConfig(spiritDataDir, { shell: { allowed: "allow", "evil *": "deny" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({
      name: "shell",
      command: "allowed && evil",
      reason: "test",
    });

    assert.deepEqual(decision, {
      kind: "denied",
      reason: 'command segment "evil" matched deny rule "evil *" in permission.shell',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize shell deny wins over an allow-everything rule regardless of rule order", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await writePermissionConfig(spiritDataDir, { shell: { "evil *": "deny", "*": "allow" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const denied = await service.authorize({
      name: "shell",
      command: "evil thing",
      reason: "test",
    });
    assert.equal(denied.kind, "denied");

    const allowed = await service.authorize({
      name: "shell",
      command: "echo hello",
      reason: "test",
    });
    assert.deepEqual(allowed, { kind: "allowed" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize never folds a shell deny under bypass-approval or userInitiated", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await writePermissionConfig(spiritDataDir, { shell: { "rm -rf *": "deny" } });

    const bypassService = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );
    const bypassDecision = await bypassService.authorize({
      name: "shell",
      command: "rm -rf build-output",
      reason: "test",
    });
    assert.equal(bypassDecision.kind, "denied");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const userRequest = service.attachRequestMetadata!(
      { name: "shell", command: "rm -rf build-output", reason: "manual" },
      { userInitiated: true },
    );
    const userDecision = await service.authorize(userRequest);
    assert.equal(userDecision.kind, "denied");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize folds shell ask to allow for user-initiated commands", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = service.attachRequestMetadata!(
      { name: "shell", command: "echo hello", reason: "manual" },
      { userInitiated: true },
    );
    const decision = await service.authorize(request);

    assert.deepEqual(decision, { kind: "allowed" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("rememberApproval with session scope allows the exact shell command but never a deny", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await service.rememberApproval({ kind: "shell", command: "npm test" }, "session");

    const remembered = await service.authorize({
      name: "shell",
      command: "npm test",
      reason: "test",
    });
    assert.deepEqual(remembered, { kind: "allowed" });

    const other = await service.authorize({
      name: "shell",
      command: "npm run build",
      reason: "test",
    });
    assert.equal(other.kind, "need-approval");

    await writePermissionConfig(spiritDataDir, { shell: { "npm test": "deny" } });
    const denied = await service.authorize({
      name: "shell",
      command: "npm test",
      reason: "test",
    });
    assert.equal(denied.kind, "denied");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize allows workspace-internal reads without rules via the location fallback", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });
    const notePath = join(workspaceRoot, "docs", "note.txt");
    await writeFile(notePath, "hello\n");

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({ name: "read_file", path: notePath });

    assert.deepEqual(decision, { kind: "allowed" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize asks for external reads without rules and folds the ask under bypass-approval", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();
  const externalRoot = await createCanonicalTempDir("spirit-host-tools-external-");

  try {
    const externalPath = join(externalRoot, "note.txt");
    await writeFile(externalPath, "hello\n");
    const canonical = await realpath(externalPath);

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({ name: "read_file", path: externalPath });
    assert.ok(decision.kind === "need-approval");
    assert.deepEqual(decision.rememberTarget, { kind: "read_file", path: canonical });

    const bypassService = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );
    const bypassDecision = await bypassService.authorize({
      name: "read_file",
      path: externalPath,
    });
    assert.deepEqual(bypassDecision, { kind: "allowed" });
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize folds a read_file ask rule to allow under bypass-approval and asks otherwise", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();
  const externalRoot = await createCanonicalTempDir("spirit-host-tools-external-");

  try {
    const externalPath = join(externalRoot, "note.txt");
    await writeFile(externalPath, "hello\n");
    const canonical = await realpath(externalPath);
    await writePermissionConfig(spiritDataDir, { read_file: { [join(externalRoot, "*")]: "ask" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({ name: "read_file", path: externalPath });
    assert.ok(decision.kind === "need-approval");
    assert.deepEqual(decision.rememberTarget, { kind: "read_file", path: canonical });

    const bypassService = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );
    const bypassDecision = await bypassService.authorize({
      name: "read_file",
      path: externalPath,
    });
    assert.deepEqual(bypassDecision, { kind: "allowed" });
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize denies a workspace-internal read matched by a deny rule", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    await mkdir(join(workspaceRoot, "config"), { recursive: true });
    const envPath = join(workspaceRoot, "config", ".env");
    await writeFile(envPath, "SECRET=1\n");
    await writePermissionConfig(spiritDataDir, { read_file: { "*/.env*": "deny" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({ name: "read_file", path: envPath });

    assert.deepEqual(decision, {
      kind: "denied",
      reason: `path "${await realpath(envPath)}" matched deny rule "*/.env*" in permission.read_file`,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("rememberApproval with session scope allows an external read path", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();
  const externalRoot = await createCanonicalTempDir("spirit-host-tools-external-");

  try {
    const externalPath = join(externalRoot, "note.txt");
    await writeFile(externalPath, "hello\n");
    const canonical = await realpath(externalPath);

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const before = await service.authorize({ name: "read_file", path: externalPath });
    assert.equal(before.kind, "need-approval");

    await service.rememberApproval({ kind: "read_file", path: canonical }, "session");
    const after = await service.authorize({ name: "read_file", path: externalPath });
    assert.deepEqual(after, { kind: "allowed" });
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize read_file expands ~ in patterns at config load", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();
  const fakeHome = await createCanonicalTempDir("spirit-host-tools-home-");
  const previousHome = process.env["HOME"];
  const previousUserProfile = process.env["USERPROFILE"];

  try {
    process.env["HOME"] = fakeHome;
    process.env["USERPROFILE"] = fakeHome;
    await mkdir(join(fakeHome, "private"), { recursive: true });
    const secretPath = join(fakeHome, "private", "secret.txt");
    await writeFile(secretPath, "top secret\n");
    await writePermissionConfig(spiritDataDir, { read_file: { "~/private/*": "deny" } });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await service.authorize({ name: "read_file", path: secretPath });

    assert.ok(decision.kind === "denied");
    assert.match(decision.reason, /matched deny rule /u);
    assert.match(decision.reason, /private\/\*" in permission\.read_file$/u);
  } finally {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env["USERPROFILE"];
    } else {
      process.env["USERPROFILE"] = previousUserProfile;
    }
    await rm(fakeHome, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("rememberApproval with config scope writes an exact allow rule into config.json", async () => {
  const { workspaceRoot, spiritDataDir } = await createPermissionTestDirs();

  try {
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await service.rememberApproval({ kind: "shell", command: "npm test" }, "config");
    await service.rememberApproval({ kind: "read_file", path: "/etc/hosts" }, "config");

    const written = JSON.parse(await readFile(configFilePath(spiritDataDir), "utf8")) as {
      permission: { shell: Record<string, string>; read_file: Record<string, string> };
    };
    assert.equal(written.permission.shell["npm test"], "allow");
    assert.equal(written.permission.read_file["/etc/hosts"], "allow");

    const fresh = loadPermissionConfig(spiritDataDir);
    assert.deepEqual(fresh.config.shell, { "npm test": "allow" });
    assert.deepEqual(fresh.config.read_file, { "/etc/hosts": "allow" });

    const freshService = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const decision = await freshService.authorize({
      name: "shell",
      command: "npm test",
      reason: "test",
    });
    assert.deepEqual(decision, { kind: "allowed" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("requestFromFunctionCall accepts empty arguments for finish_task", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-finish-task-parse-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall("finish_task", "   ");

    assert.deepEqual(request, {
      name: "finish_task",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("create_plan writes plans/{name}.md and rejects duplicate names", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-create-plan-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      "create_plan",
      JSON.stringify({ name: "demo-plan", content: "# Demo\n\n- [ ] ship it" }),
    );

    assert.deepEqual(request, {
      name: "create_plan",
      plan_name: "demo-plan",
      content: "# Demo\n\n- [ ] ship it",
    });

    const output = await service.execute(request);
    assert.match(String(output), /\[plan\]\npath: .*plans[\\/]+demo-plan\.md/);

    await assert.rejects(
      () =>
        service.execute({
          name: "create_plan",
          plan_name: "demo-plan",
          content: "# Again",
        }),
      /Plan file already exists/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("create_automation writes automation file when defaults are provided", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-create-automation-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  let createdId: string | undefined;

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getAutomationCreateDefaults: () => ({
          workspaceRoot,
          modelRef: { groupId: "openai", name: "test-model" },
        }),
        onAutomationCreated: (definition) => {
          createdId = definition.id;
        },
      },
    );
    const request = await service.requestFromFunctionCall(
      "create_automation",
      JSON.stringify({
        overview: "Check CI status and summarize failures.",
        trigger: {
          kind: "time",
          schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 },
        },
      }),
    );

    assert.equal(request.name, "create_automation");
    assert.equal(request.title, "Check CI status and summarize failures.");
    assert.deepEqual(request.trigger, {
      kind: "time",
      schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 },
    });
    assert.equal(request.approval_level, "default");

    const output = await service.execute(request);
    assert.match(String(output), /\[automation\]\naction: create_automation\nid: /);
    assert.ok(createdId);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("create_file is rejected for new files under plans/", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-plans-whitelist-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await mkdir(join(spiritDataDir, "plans"), { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: "create_file",
          path: join(spiritDataDir, "plans", "blocked.md"),
          content: "nope",
        }),
      /create_plan/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function assertHostToolExecutionOutput(
  output: HostToolExecutionOutput | string,
): asserts output is HostToolExecutionOutput {
  assert.notEqual(typeof output, "string");
}

/**
 * mkdtemp + realpath: authorize realpath()s read targets, and on macOS
 * tmpdir() is a /var symlink, so canonical paths would otherwise escape the
 * workspace root in relative-pattern and location-fallback checks.
 */
async function createCanonicalTempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

async function createPermissionTestDirs(): Promise<{
  workspaceRoot: string;
  spiritDataDir: string;
}> {
  const workspaceRoot = await createCanonicalTempDir("spirit-host-tools-perm-");
  const spiritDataDir = join(workspaceRoot, ".spirit-data");
  await mkdir(spiritDataDir, { recursive: true });
  return { workspaceRoot, spiritDataDir };
}

async function writePermissionConfig(
  spiritDataDir: string,
  permission: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    configFilePath(spiritDataDir),
    `${JSON.stringify(
      {
        schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
        providerGroups: [],
        activeModel: { groupId: "", name: "" },
        permission,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function assertTextToolOutput(output: HostToolExecutionOutput | string): asserts output is string {
  assert.equal(typeof output, "string");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
