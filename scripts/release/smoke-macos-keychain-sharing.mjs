#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.env.SPIRIT_KEYRING_CONFIG_ENTRY;
if (!entry) throw new Error('SPIRIT_KEYRING_CONFIG_ENTRY is required');
const entryUrl = pathToFileURL(path.resolve(entry));
const { sharedMacKeychainAccessGroup } = await import(new URL('./macos-keychain.js', entryUrl));
if (!sharedMacKeychainAccessGroup()) {
  throw new Error('The signed runtime did not resolve its Spirit keychain access group');
}
const { KEYRING_SERVICE, deleteKeyringPassword, getKeyringPassword, setKeyringPassword } =
  await import(entryUrl);
const account = `ci::keychain-sharing::${randomUUID()}`;
const password = randomUUID();
try {
  setKeyringPassword(KEYRING_SERVICE, account, password);
  if (getKeyringPassword(KEYRING_SERVICE, account) !== password) {
    throw new Error('Shared keychain round-trip failed');
  }
} finally {
  deleteKeyringPassword(KEYRING_SERVICE, account);
}
