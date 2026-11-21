import { InvalidCloudflareCredentialsError, type CloudflareCredentials } from "./credentials.js";
import { CloudflareOAuthError } from "./oauth.js";

const INITIAL_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const MIN_REFRESH_DELAY_MS = 1_000;

/**
 * Keeps the MCP access token fresh. The MCP contribution reads the token from the Secret slot, so
 * a refresh only has to commit the updated credential; the host propagates the new header.
 */
export function createCloudflareRefreshScheduler(options: {
  signal: AbortSignal;
  read: () => Promise<CloudflareCredentials | undefined>;
  now?: () => number;
  log?: (message: string) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let retryDelay = INITIAL_RETRY_DELAY_MS;
  const now = () => options.now?.() ?? Date.now();

  function clear() {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function arm(delay: number, run: () => void | Promise<void>) {
    const currentGeneration = generation;
    timer = setTimeout(
      () => {
        timer = undefined;
        if (options.signal.aborted || currentGeneration !== generation) return;
        void run();
      },
      Math.max(0, delay),
    );
    timer.unref();
  }

  async function read() {
    const readGeneration = generation;
    try {
      const credentials = await options.read();
      if (readGeneration !== generation || options.signal.aborted) return;
      retryDelay = INITIAL_RETRY_DELAY_MS;
      if (!credentials) {
        // A peer may authorize later. Only local Secret reads occur while disconnected.
        arm(retryDelay, read);
        return;
      }
      arm(Math.max(MIN_REFRESH_DELAY_MS, credentials.accessTokenRefreshAt - now()), read);
    } catch (error) {
      if (
        readGeneration !== generation ||
        options.signal.aborted ||
        error instanceof InvalidCloudflareCredentialsError
      ) {
        return;
      }
      if (error instanceof CloudflareOAuthError && error.status === 401) {
        // The credential was retired; peer reauthorization must still be able to wake this host.
        retryDelay = INITIAL_RETRY_DELAY_MS;
        arm(retryDelay, read);
        return;
      }
      options.log?.("Cloudflare access token refresh failed; retrying in the background.");
      arm(retryDelay, read);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    }
  }

  return {
    start() {
      clear();
      if (!options.signal.aborted) arm(0, read);
    },
    clear,
    dispose: clear,
  };
}
