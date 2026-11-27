import { InvalidParallelCredentialsError, type ParallelCredentials } from "./credentials.js";
import { ParallelOAuthError } from "./oauth.js";

const INITIAL_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

/**
 * Keeps the MCP access token fresh. The MCP contribution reads the token from the Secret slot, so
 * a refresh only has to commit the refreshed credential; the host propagates the new header.
 */
export function createParallelRefreshScheduler(options: {
  signal: AbortSignal;
  read: () => Promise<ParallelCredentials | undefined>;
  readAccessTokenExpiresAt?: () => Promise<number | undefined>;
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
      arm(credentials.accessTokenRefreshAt - now(), read);
    } catch (error) {
      if (
        readGeneration !== generation ||
        options.signal.aborted ||
        error instanceof InvalidParallelCredentialsError
      ) {
        return;
      }
      if (error instanceof ParallelOAuthError && error.status === 401) {
        // The credential was retired; peer reauthorization must still be able to wake this host.
        retryDelay = INITIAL_RETRY_DELAY_MS;
        arm(retryDelay, read);
        return;
      }
      let delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
      let expiresAt: number | undefined;
      if (options.readAccessTokenExpiresAt) {
        try {
          expiresAt = await options.readAccessTokenExpiresAt();
        } catch {
          if (readGeneration !== generation || options.signal.aborted) return;
        }
      }
      if (readGeneration !== generation || options.signal.aborted) return;
      if (expiresAt !== undefined) {
        const remaining = expiresAt - now();
        if (remaining < delay) {
          delay = Math.max(0, remaining);
        }
      }
      options.log?.("Parallel access token refresh failed; retrying in the background.");
      arm(delay, read);
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
