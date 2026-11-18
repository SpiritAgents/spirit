import { GitHubOAuthError } from "./oauth.js";
import {
  GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  InvalidGitHubCredentialsError,
  type GitHubCredentials,
} from "./credentials.js";

const INITIAL_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export function createGitHubRefreshScheduler(options: {
  signal: AbortSignal;
  read: () => Promise<GitHubCredentials | undefined>;
  runInBackground: <T>(run: () => Promise<T>) => Promise<T>;
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

  function scheduleRead() {
    if (options.signal.aborted) return;
    const readGeneration = generation;
    arm(0, async () => {
      try {
        const credentials = await options.runInBackground(options.read);
        if (readGeneration !== generation || options.signal.aborted) return;
        if (!credentials) {
          // A peer may authorize later. Only local Secret reads occur while disconnected.
          retryDelay = INITIAL_RETRY_DELAY_MS;
          arm(retryDelay, scheduleRead);
          return;
        }
        retryDelay = INITIAL_RETRY_DELAY_MS;
        arm(
          credentials.accessTokenExpiresAt - GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS - now(),
          scheduleRead,
        );
      } catch (error) {
        if (
          readGeneration !== generation ||
          options.signal.aborted ||
          error instanceof InvalidGitHubCredentialsError
        ) {
          return;
        }
        if (error instanceof GitHubOAuthError && error.status === 401) {
          // Peer reauthorization must be able to wake a host that retired its credential.
          retryDelay = INITIAL_RETRY_DELAY_MS;
          arm(retryDelay, scheduleRead);
          return;
        }
        options.log?.("GitHub access token refresh failed; retrying in the background.");
        arm(retryDelay, scheduleRead);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
      }
    });
  }

  return {
    start() {
      clear();
      scheduleRead();
    },
    clear,
    dispose: clear,
  };
}
