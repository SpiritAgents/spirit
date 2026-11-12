import {
  deleteKeyringPassword,
  getKeyringPassword,
  setKeyringPassword,
} from "../keyring-secret.js";

/** Test-only override for keyring operations. */
export interface KeyringStore {
  getPassword(service: string, account: string): string | undefined;
  setPassword(service: string, account: string, password: string): void;
  deletePassword(service: string, account: string): void;
}

export const defaultKeyringStore: KeyringStore = {
  getPassword: getKeyringPassword,
  setPassword: setKeyringPassword,
  deletePassword: deleteKeyringPassword,
};

let keyringStoreOverride: KeyringStore | undefined;

export function setKeyringStoreForTests(store: KeyringStore | undefined): void {
  keyringStoreOverride = store;
}

export function keyringStore(): KeyringStore {
  return keyringStoreOverride ?? defaultKeyringStore;
}
