import type { ProviderCredentialSlot, ProviderKeyringReference } from "../config.js";

import { keyringStore } from "./keyring-store.js";

export const KEYRING_SERVICE = "Spirit";

/**
 * The credential channel declarations key resolution needs: structurally satisfied by
 * `ProviderEntry`, and rebuilt from a `SpiritModelProfile` at the transport boundary.
 */
export interface ProviderKeyChannels {
  id: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyKeyring?: ProviderKeyringReference;
  credentials?: Record<string, ProviderCredentialSlot>;
}

export type ProviderKeyChannelSource = "value" | "env" | "keyring" | "internalKeyring";

/** One channel that was declared (or implicitly checked) but yielded no usable secret. */
export interface ProviderKeyChannelMiss {
  source: ProviderKeyChannelSource;
  /** Env var name, for `env` misses. */
  env?: string;
  /** External keyring entry, for `keyring` misses. */
  keyring?: ProviderKeyringReference;
  /** Internal keyring account, for `internalKeyring` misses. */
  account?: string;
}

export interface ProviderKeyResolution {
  value?: string;
  source?: ProviderKeyChannelSource;
  /** Declared channels that missed before the resolution ended (empty value or nothing found). */
  misses: ProviderKeyChannelMiss[];
}

export interface ResolveProviderKeyOptions {
  /** Env map to read `env` channels from; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Internal keyring account written by the connect wizard: `provider::{id}`. */
export function providerInternalKeyAccount(providerId: string): string {
  return `provider::${providerId}`;
}

/** Internal keyring account for a `credentials` slot: `provider::{id}::{slot}` (`apiKey` = `provider::{id}`). */
export function providerInternalSlotAccount(providerId: string, slot: string): string {
  return slot === "apiKey"
    ? providerInternalKeyAccount(providerId)
    : `provider::${providerId}::${slot}`;
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

interface ChannelAttempt {
  source: ProviderKeyChannelSource;
  read: () => string | undefined;
  miss: ProviderKeyChannelMiss;
}

function resolveAttempts(attempts: readonly ChannelAttempt[]): ProviderKeyResolution {
  const misses: ProviderKeyChannelMiss[] = [];
  for (const attempt of attempts) {
    const value = attempt.read();
    if (value !== undefined) {
      return { value, source: attempt.source, misses };
    }
    misses.push(attempt.miss);
  }
  return { misses };
}

function pushSlotAttempts(
  attempts: ChannelAttempt[],
  slot: ProviderCredentialSlot,
  env: NodeJS.ProcessEnv,
): void {
  if (slot.value !== undefined) {
    const declared = slot.value;
    attempts.push({
      source: "value",
      read: () => nonBlank(declared),
      miss: { source: "value" },
    });
  }
  if (slot.env !== undefined) {
    const name = slot.env;
    attempts.push({
      source: "env",
      read: () => nonBlank(env[name]),
      miss: { source: "env", env: name },
    });
  }
  if (slot.keyring !== undefined) {
    const reference = slot.keyring;
    attempts.push({
      source: "keyring",
      read: () => nonBlank(keyringStore().getPassword(reference.service, reference.account)),
      miss: { source: "keyring", keyring: reference },
    });
  }
}

/**
 * Flat single-key resolution: `apiKey` → `apiKeyEnv` → `apiKeyKeyring` → `credentials.apiKey`
 * slot channels → internal keyring `provider::{id}`. Empty strings fall through; nothing
 * resolving yields undefined (callers render the error).
 */
export function resolveProviderApiKeyResolution(
  provider: ProviderKeyChannels,
  options: ResolveProviderKeyOptions = {},
): ProviderKeyResolution {
  const env = options.env ?? process.env;
  const attempts: ChannelAttempt[] = [];
  if (provider.apiKey !== undefined) {
    const declared = provider.apiKey;
    attempts.push({
      source: "value",
      read: () => nonBlank(declared),
      miss: { source: "value" },
    });
  }
  if (provider.apiKeyEnv !== undefined) {
    const name = provider.apiKeyEnv;
    attempts.push({
      source: "env",
      read: () => nonBlank(env[name]),
      miss: { source: "env", env: name },
    });
  }
  if (provider.apiKeyKeyring !== undefined) {
    const reference = provider.apiKeyKeyring;
    attempts.push({
      source: "keyring",
      read: () => nonBlank(keyringStore().getPassword(reference.service, reference.account)),
      miss: { source: "keyring", keyring: reference },
    });
  }
  const apiKeySlot = provider.credentials?.["apiKey"];
  if (apiKeySlot !== undefined) {
    pushSlotAttempts(attempts, apiKeySlot, env);
  }
  const account = providerInternalKeyAccount(provider.id);
  attempts.push({
    source: "internalKeyring",
    read: () => nonBlank(keyringStore().getPassword(KEYRING_SERVICE, account)),
    miss: { source: "internalKeyring", account },
  });
  return resolveAttempts(attempts);
}

/** `credentials` slot resolution: `value` → `env` → `keyring` → internal keyring `provider::{id}::{slot}`. */
export function resolveProviderCredentialSlotResolution(
  provider: ProviderKeyChannels,
  slot: string,
  options: ResolveProviderKeyOptions = {},
): ProviderKeyResolution {
  const env = options.env ?? process.env;
  const attempts: ChannelAttempt[] = [];
  const declared = provider.credentials?.[slot];
  if (declared !== undefined) {
    pushSlotAttempts(attempts, declared, env);
  }
  const account = providerInternalSlotAccount(provider.id, slot);
  attempts.push({
    source: "internalKeyring",
    read: () => nonBlank(keyringStore().getPassword(KEYRING_SERVICE, account)),
    miss: { source: "internalKeyring", account },
  });
  return resolveAttempts(attempts);
}

export function resolveProviderApiKey(
  provider: ProviderKeyChannels,
  options: ResolveProviderKeyOptions = {},
): string | undefined {
  return resolveProviderApiKeyResolution(provider, options).value;
}

export function resolveProviderCredentialSlot(
  provider: ProviderKeyChannels,
  slot: string,
  options: ResolveProviderKeyOptions = {},
): string | undefined {
  return resolveProviderCredentialSlotResolution(provider, slot, options).value;
}
