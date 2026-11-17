import { AsyncLocalStorage } from "node:async_hooks";
const requests = new AsyncLocalStorage<{ fetch?: typeof fetch; signal?: AbortSignal }>();
export function withGitHubRequest<T>(
  options: { fetch?: typeof fetch; signal?: AbortSignal },
  run: () => T,
): T {
  return requests.run(options, run);
}
export function githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = requests.getStore();
  const signals = [request?.signal, init?.signal].filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  signal?.throwIfAborted();
  return (request?.fetch ?? globalThis.fetch)(input, {
    ...init,
    ...(signal ? { signal } : {}),
  });
}
