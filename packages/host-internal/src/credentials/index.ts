export { resolveAgentsWebToolExposure, type AgentsWebToolExposure } from "./agents-config.js";
export {
  hasResolvableCredentials,
  loadActiveModelProfile,
  loadModelProfile,
  loadSpiritConfig,
  readBedrockCredentials,
  readGoogleVertexCredentials,
  resolveStoredApiKeyForProfile,
  saveProviderSetup,
  saveSpiritConfig,
} from "./credentials.js";
export { configFilePath, resolveSpiritDataDir } from "./spirit-config.js";
export { setKeyringStoreForTests, type KeyringStore } from "./keyring-store.js";
export {
  KEYRING_GLOBAL_ACCOUNT,
  KEYRING_SERVICE,
  groupAccessKeyIdAccount,
  groupKeyAccount,
  groupSecretAccessKeyAccount,
  groupVertexClientEmailAccount,
  groupVertexPrivateKeyAccount,
  modelKeyAccount,
  modelProviderKeyScope,
  providerAccessKeyIdAccount,
  providerKeyAccount,
  providerSecretAccessKeyAccount,
  providerVertexClientEmailAccount,
  providerVertexPrivateKeyAccount,
} from "./provider-accounts.js";
export type {
  BedrockSetupCredentials,
  GoogleVertexSetupCredentials,
  PermissionConfig,
  PermissionDomainRules,
  PermissionRuleAction,
  ProviderSetupResult,
  SpiritConfigFile,
  SpiritModelCapability,
  SpiritModelProfile,
  SpiritModelReasoningEffort,
} from "./types.js";
