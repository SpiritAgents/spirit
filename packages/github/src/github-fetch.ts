let githubFetchImpl: typeof fetch | undefined;

/** Hosts such as Desktop can inject electron.net.fetch to use the system certificate store and proxy. */
export function setGitHubFetchImplementation(fetchImpl: typeof fetch | undefined): void {
  githubFetchImpl = fetchImpl;
}

export function githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (githubFetchImpl ?? globalThis.fetch)(input, init);
}
