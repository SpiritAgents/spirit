import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readProduct } from "../../../packages/product/scripts/generate.mjs";
import {
  OAUTH_CLIENT_METADATA_PATH,
  OAUTH_LOGO_PATH,
  renderOAuthClientMetadata,
} from "./generate-oauth-client.mjs";

const committed = readFileSync(
  new URL(`../public${OAUTH_CLIENT_METADATA_PATH}`, import.meta.url),
  "utf8",
);
const metadata = JSON.parse(committed) as Record<string, unknown>;

test("committed client metadata matches the stable product", async () => {
  assert.equal(committed, renderOAuthClientMetadata(await readProduct("stable")));
});

// Authorization servers compare client_id to the fetched URL by simple string comparison and never
// normalize it, so the published value has to already be a canonical https URL with a real path.
test("client_id is the canonical URL the document is served from", async () => {
  const { websiteOrigin } = await readProduct("stable");
  const clientId = metadata.client_id as string;
  const url = new URL(clientId);

  assert.equal(clientId, `${websiteOrigin}${OAUTH_CLIENT_METADATA_PATH}`);
  assert.equal(url.href, clientId);
  assert.equal(url.protocol, "https:");
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.notEqual(url.pathname, "/");
  assert.equal(metadata.logo_uri, `${websiteOrigin}${OAUTH_LOGO_PATH}`);
});

test("client metadata describes a public native client", () => {
  const methods = metadata.token_endpoint_auth_methods_supported as string[];

  assert.equal(metadata.application_type, "native");
  assert.deepEqual(methods, ["none"]);
  assert.ok(methods.includes(metadata.token_endpoint_auth_method as string));
  assert.ok(!("client_secret" in metadata));
  // Recommended authorization server read limit is 5 KB.
  assert.ok(Buffer.byteLength(committed) < 5 * 1024);
});
