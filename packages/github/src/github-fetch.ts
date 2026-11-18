import { AsyncLocalStorage } from "node:async_hooks";

interface GitHubRequestContext {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  refreshAccessToken?: (rejectedAccessToken: string) => Promise<string | undefined>;
}

const requests = new AsyncLocalStorage<GitHubRequestContext>();

export function withGitHubRequest<T>(options: GitHubRequestContext, run: () => T): T {
  return requests.run(options, run);
}

/** Uses the injected transport without inheriting the caller's cancellation or retry behavior. */
export function githubFetchDetached(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = requests.getStore();
  return (request?.fetch ?? globalThis.fetch)(input, init);
}

export function githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = requests.getStore();
  const perform = async (requestInit?: RequestInit): Promise<Response> => {
    const signals = [request?.signal, requestInit?.signal].filter((signal): signal is AbortSignal =>
      Boolean(signal),
    );
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    signal?.throwIfAborted();
    return (request?.fetch ?? globalThis.fetch)(input, {
      ...requestInit,
      ...(signal ? { signal } : {}),
    });
  };
  const initialSignals = [request?.signal, init?.signal].filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  if (initialSignals.length) AbortSignal.any(initialSignals).throwIfAborted();
  return perform(init).then(async (response) => {
    if (response.status !== 401 || !request?.refreshAccessToken) return response;

    const headers = requestHeaders(input, init);
    const authorization = headers.get("Authorization");
    const rejectedAccessToken = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim();
    if (!rejectedAccessToken) return response;
    const accessToken = await request.refreshAccessToken(rejectedAccessToken);
    if (!accessToken || accessToken === rejectedAccessToken) return response;

    headers.set("Authorization", `Bearer ${accessToken}`);
    return perform({ ...init, headers });
  });
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}
