import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import { FormData as UndiciFormData } from "undici";

import {
  clearDeclaredFileUploadCacheForTests,
  FileUploadConfigError,
  uploadDeclaredFile,
  validateFileUploadConfig,
  type DeclaredFileUploadConnection,
} from "./uploader.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

const tempRoots: string[] = [];

afterEach(async () => {
  clearDeclaredFileUploadCacheForTests();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempFile(name = "clip.mp4", bytes: Buffer = MINIMAL_MP4_HEADER): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "spirit-core-file-upload-"));
  tempRoots.push(root);
  const path = join(root, name);
  await writeFile(path, bytes);
  return path;
}

type CapturedRequest = { url: string; init: RequestInit | undefined };

function fakeConnection(responder: (request: CapturedRequest) => Response | Promise<Response>): {
  connection: DeclaredFileUploadConnection;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: String(input), init };
    requests.push(request);
    return responder(request);
  }) as typeof fetch;
  return {
    connection: { apiBase: "https://api.example.com/v1", apiKey: "k", fetchImpl },
    requests,
  };
}

test("validateFileUploadConfig accepts path and url forms", () => {
  assert.deepEqual(validateFileUploadConfig({ path: "/files", refTemplate: "ms://{id}" }), {
    path: "/files",
    refTemplate: "ms://{id}",
  });
  const urlForm = {
    url: "https://api.example.com/v1/files/upload",
    purpose: { video: "video_understanding" },
    idPath: "file.file_id",
    refTemplate: "mm_file://{id}",
    maxBytes: 134217728,
  };
  assert.deepEqual(validateFileUploadConfig(urlForm), urlForm);
});

test("validateFileUploadConfig rejects missing path+url and refTemplates without {id}", () => {
  assert.throws(
    () => validateFileUploadConfig({ refTemplate: "ms://{id}" }),
    /at least one of "path" or "url"/,
  );
  assert.throws(
    () => validateFileUploadConfig({ path: "/files", refTemplate: "ms://" }),
    /must contain the "\{id\}" placeholder/,
  );
  assert.throws(() => validateFileUploadConfig({ path: "/files" }), /refTemplate/);
  assert.throws(() => validateFileUploadConfig(null), FileUploadConfigError);
});

test("validateFileUploadConfig rejects malformed purpose and maxBytes", () => {
  assert.throws(
    () => validateFileUploadConfig({ path: "/files", refTemplate: "ms://{id}", purpose: 1 }),
    /"purpose" must be a string/,
  );
  assert.throws(
    () =>
      validateFileUploadConfig({
        path: "/files",
        refTemplate: "ms://{id}",
        purpose: { video: 1 },
      }),
    /"purpose" must be a string/,
  );
  assert.throws(
    () => validateFileUploadConfig({ path: "/files", refTemplate: "ms://{id}", maxBytes: -1 }),
    /"maxBytes" must be a positive number/,
  );
});

test("uploadDeclaredFile posts multipart with a string purpose for every content purpose", async () => {
  const path = await tempFile();
  const { connection, requests } = fakeConnection(
    () => new Response(JSON.stringify({ id: "file-abc" }), { status: 200 }),
  );

  const result = await uploadDeclaredFile(
    validateFileUploadConfig({ path: "/files", purpose: "video", refTemplate: "ms://{id}" }),
    connection,
    path,
    "video",
  );

  assert.deepEqual(result, { kind: "uploaded", ref: "ms://file-abc" });
  assert.equal(requests[0]?.url, "https://api.example.com/v1/files");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer k");
  const body = requests[0]?.init?.body;
  assert.ok(body instanceof UndiciFormData);
  assert.equal(body.get("purpose"), "video");
  const file = body.get("file");
  assert.ok(file && typeof file === "object" && "name" in file);
  assert.equal((file as { name: string }).name, "clip.mp4");
});

test("uploadDeclaredFile maps object purposes and goes inline for purposes absent from the map", async () => {
  const path = await tempFile();
  const { connection, requests } = fakeConnection(
    () => new Response(JSON.stringify({ id: "file-xyz" }), { status: 200 }),
  );
  const config = validateFileUploadConfig({
    path: "/files",
    purpose: { video: "video_understanding" },
    refTemplate: "mm_file://{id}",
  });

  const uploaded = await uploadDeclaredFile(config, connection, path, "video");
  assert.deepEqual(uploaded, { kind: "uploaded", ref: "mm_file://file-xyz" });
  const body = requests[0]?.init?.body;
  assert.ok(body instanceof UndiciFormData);
  assert.equal(body.get("purpose"), "video_understanding");

  const inlineImage = await uploadDeclaredFile(config, connection, path, "image");
  assert.deepEqual(inlineImage, { kind: "inline" });
  const inlineUnknown = await uploadDeclaredFile(config, connection, path);
  assert.deepEqual(inlineUnknown, { kind: "inline" });
  assert.equal(requests.length, 1);
});

test("uploadDeclaredFile sends no purpose field when purpose is absent", async () => {
  const path = await tempFile();
  const { connection, requests } = fakeConnection(
    () => new Response(JSON.stringify({ id: "f1" }), { status: 200 }),
  );
  const result = await uploadDeclaredFile(
    validateFileUploadConfig({ path: "/files", refTemplate: "ms://{id}" }),
    connection,
    path,
    "video",
  );
  assert.equal(result.kind, "uploaded");
  const body = requests[0]?.init?.body;
  assert.ok(body instanceof UndiciFormData);
  assert.equal(body.get("purpose"), null);
});

test("uploadDeclaredFile reads idPath, stringifies numeric ids, and applies the refTemplate", async () => {
  const path = await tempFile();
  const { connection } = fakeConnection(
    () =>
      new Response(
        JSON.stringify({ file: { file_id: 413560385741067 }, base_resp: { status_code: 0 } }),
        { status: 200 },
      ),
  );
  const result = await uploadDeclaredFile(
    validateFileUploadConfig({
      url: "https://uploads.example.com/files/upload",
      idPath: "file.file_id",
      refTemplate: "mm_file://{id}",
    }),
    connection,
    path,
  );
  assert.deepEqual(result, { kind: "uploaded", ref: "mm_file://413560385741067" });
});

test("uploadDeclaredFile caches by path + mtime", async () => {
  const path = await tempFile();
  const { connection, requests } = fakeConnection(
    () => new Response(JSON.stringify({ id: "cached" }), { status: 200 }),
  );
  const config = validateFileUploadConfig({ path: "/files", refTemplate: "ms://{id}" });

  const first = await uploadDeclaredFile(config, connection, path);
  const second = await uploadDeclaredFile(config, connection, path);
  assert.deepEqual(first, { kind: "uploaded", ref: "ms://cached" });
  assert.deepEqual(second, first);
  assert.equal(requests.length, 1);
});

test("uploadDeclaredFile enforces maxBytes before uploading", async () => {
  const path = await tempFile("big.bin", Buffer.alloc(64));
  const { connection, requests } = fakeConnection(
    () => new Response(JSON.stringify({ id: "never" }), { status: 200 }),
  );
  const result = await uploadDeclaredFile(
    validateFileUploadConfig({ path: "/files", refTemplate: "ms://{id}", maxBytes: 16 }),
    connection,
    path,
  );
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.match(result.error, /exceeds the 16 byte upload limit/);
  }
  assert.equal(requests.length, 0);
});

test("uploadDeclaredFile fails on non-OK, non-JSON, and missing-id responses", async () => {
  const path = await tempFile();

  const httpError = fakeConnection(() => new Response("denied", { status: 403 }));
  const a = await uploadDeclaredFile(
    { path: "/files", refTemplate: "ms://{id}" },
    httpError.connection,
    path,
  );
  assert.deepEqual(a, { kind: "failed", error: "File upload failed (403): denied" });

  const nonJson = fakeConnection(() => new Response("nope", { status: 200 }));
  const b = await uploadDeclaredFile(
    { path: "/files", refTemplate: "ms://{id}" },
    nonJson.connection,
    path,
  );
  assert.deepEqual(b, { kind: "failed", error: "File upload returned a non-JSON response." });

  const missingId = fakeConnection(() => new Response(JSON.stringify({}), { status: 200 }));
  const c = await uploadDeclaredFile(
    { path: "/files", refTemplate: "ms://{id}" },
    missingId.connection,
    path,
  );
  assert.deepEqual(c, { kind: "failed", error: 'File upload response had no file id at "id".' });
});
