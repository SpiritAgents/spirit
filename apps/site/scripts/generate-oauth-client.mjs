/**
 * Publishes Spirit's OAuth Client ID Metadata Document (CIMD) and the logo it references:
 * - public/oauth/client-metadata.json — checked in for review; its URL is Spirit's OAuth client_id
 * - public/oauth/logo.png (512) — not checked in; rendered from logo-dark.svg like the desktop packaging icon
 *
 * The client_id URL is a permanent identity: authorization servers treat a changed URL as a new client,
 * so every grant would need fresh user consent. Contents are pinned to the stable product and never
 * derive from deployment or request input (preview origins must not leak into the document).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readProduct } from "../../../packages/product/scripts/generate.mjs";

export const OAUTH_CLIENT_METADATA_PATH = "/oauth/client-metadata.json";
export const OAUTH_LOGO_PATH = "/oauth/logo.png";
const LOGO_SIZE = 512;

const publicDir = new URL("../public/", import.meta.url);

export function renderOAuthClientMetadata(product) {
  const origin = product.websiteOrigin;
  const metadata = {
    client_id: `${origin}${OAUTH_CLIENT_METADATA_PATH}`,
    client_name: product.name,
    client_uri: origin,
    logo_uri: `${origin}${OAUTH_LOGO_PATH}`,
    application_type: "native",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: ["http://127.0.0.1/callback"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods_supported: ["none"],
  };
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

async function renderLogoPng() {
  const [{ createOpticalLogoSvg }, { default: sharp }] = await Promise.all([
    import("@spiritagent/brand/src/optical-logo.js"),
    import("sharp"),
  ]);
  const source = readFileSync(
    new URL("../../../packages/brand/assets/logo-dark.svg", import.meta.url),
    "utf8",
  );
  return sharp(Buffer.from(createOpticalLogoSvg(source, LOGO_SIZE))).png().toBuffer();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const product = await readProduct("stable");
  mkdirSync(new URL("oauth/", publicDir), { recursive: true });
  writeFileSync(
    fileURLToPath(new URL(`.${OAUTH_CLIENT_METADATA_PATH}`, publicDir)),
    renderOAuthClientMetadata(product),
    "utf8",
  );
  writeFileSync(fileURLToPath(new URL(`.${OAUTH_LOGO_PATH}`, publicDir)), await renderLogoPng());
  console.log(
    `Generated public${OAUTH_CLIENT_METADATA_PATH} and public${OAUTH_LOGO_PATH} (${LOGO_SIZE}x${LOGO_SIZE})`,
  );
}
