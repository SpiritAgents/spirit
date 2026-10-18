import { getTokenProvider } from "@aws/bedrock-token-generator";

export interface BedrockMantleIamCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export function hasBedrockMantleIamCredentials(
  iam: BedrockMantleIamCredentials | undefined,
): iam is BedrockMantleIamCredentials {
  if (!iam) {
    return false;
  }
  return Boolean(iam.region.trim() && iam.accessKeyId.trim() && iam.secretAccessKey.trim());
}

export function createBedrockMantleBearerAuthFetch(
  baseFetch: typeof fetch,
  iam: BedrockMantleIamCredentials,
): typeof fetch {
  const provideToken = getTokenProvider({
    credentials: {
      accessKeyId: iam.accessKeyId.trim(),
      secretAccessKey: iam.secretAccessKey.trim(),
      ...(iam.sessionToken?.trim() ? { sessionToken: iam.sessionToken.trim() } : {}),
    },
    region: iam.region.trim(),
  });

  return async (input, init) => {
    const token = await provideToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  };
}

/**
 * SigV4 (Bedrock Mantle) auth: declared via `options.auth: "aws-sigv4"`, with IAM credentials in
 * the `bedrockMantleIam` slots. A static `apiKey` takes precedence when both are present.
 */
export function wrapFetchForBedrockMantleIamAuth(
  config: {
    apiKey?: string;
    bedrockMantleIam?: BedrockMantleIamCredentials;
    options?: Record<string, unknown>;
  },
  baseFetch: typeof fetch,
): typeof fetch {
  if (config.options?.auth !== "aws-sigv4") {
    return baseFetch;
  }
  if (config.apiKey?.trim() || !hasBedrockMantleIamCredentials(config.bedrockMantleIam)) {
    return baseFetch;
  }
  return createBedrockMantleBearerAuthFetch(baseFetch, config.bedrockMantleIam);
}

export function resolveBedrockMantleOpenResponsesApiKey(config: {
  apiKey?: string;
  bedrockMantleIam?: BedrockMantleIamCredentials;
}): string {
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    return apiKey;
  }
  if (hasBedrockMantleIamCredentials(config.bedrockMantleIam)) {
    return "bedrock-mantle-iam";
  }
  return "";
}
