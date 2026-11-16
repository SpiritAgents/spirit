import { AsyncLocalStorage } from "node:async_hooks";
const requests = new AsyncLocalStorage<{ fetch?: typeof fetch; signal?: AbortSignal }>();
export function withGitHubRequest<T>(
  options: { fetch?: typeof fetch; signal?: AbortSignal },
  run: () => T,
): T {
  return requests.run(options, run);
}
let githubFetchImpl: typeof fetch | undefined;

/** Hosts such as Desktop can inject electron.net.fetch to use the system certificate store and proxy. */
export function setGitHubFetchImplementation(fetchImpl: typeof fetch | undefined): void {
  githubFetchImpl = fetchImpl;
}

export function githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = requests.getStore();
  const signals = [request?.signal, init?.signal].filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  signal?.throwIfAborted();
  return (request?.fetch ?? githubFetchImpl ?? globalThis.fetch)(input, {
    ...init,
    ...(signal ? { signal } : {}),
  });
}
