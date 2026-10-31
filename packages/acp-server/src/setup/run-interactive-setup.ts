import { readFileSync } from "node:fs";

import { confirm, input, password, select } from "@inquirer/prompts";
import { listProviderModels } from "@spiritagent/agent-core/model-catalog";
import {
  CUSTOM_PROVIDER_PRESET_ID,
  listProviderPresets,
} from "@spiritagent/agent-core/provider-presets";

import type { ProviderSetupResult } from "@spiritagent/host-internal";
import {
  buildProviderSetupResult,
  listSiteOptions,
  providerNeedsSiteSelection,
  resolveSetupTransportKind,
  resolveWizardApiBase,
  siteNeedsWorkspaceId,
  validateApiKeyRequired,
  validateAzureSetup,
  validateBedrockCredentials,
  validateCustomSetup,
  validateModelName,
  validateVertexCredentials,
  type WizardSetupInput,
} from "./provider-wizard.js";

async function promptModelId(
  provider: string,
  apiKey: string,
  wizardInput: WizardSetupInput,
  extras?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    vertexClientEmail?: string;
    vertexPrivateKey?: string;
  },
): Promise<string> {
  const transportKind = resolveSetupTransportKind(provider);
  const baseUrl = resolveWizardApiBase(wizardInput);

  let catalog: Array<{ id: string; displayName?: string }> = [];
  if (provider !== CUSTOM_PROVIDER_PRESET_ID) {
    try {
      const listed = await listProviderModels({
        provider,
        transportKind,
        apiKey: apiKey.trim(),
        baseUrl,
        ...(wizardInput.awsRegion ? { awsRegion: wizardInput.awsRegion } : {}),
        ...(wizardInput.vertexProject ? { vertexProject: wizardInput.vertexProject } : {}),
        ...(wizardInput.vertexLocation ? { vertexLocation: wizardInput.vertexLocation } : {}),
        ...(extras?.accessKeyId ? { accessKeyId: extras.accessKeyId } : {}),
        ...(extras?.secretAccessKey ? { secretAccessKey: extras.secretAccessKey } : {}),
        ...(extras?.vertexClientEmail ? { vertexClientEmail: extras.vertexClientEmail } : {}),
        ...(extras?.vertexPrivateKey ? { vertexPrivateKey: extras.vertexPrivateKey } : {}),
      });
      catalog = listed.map((entry) => ({
        id: entry.id,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[acp-server] Could not fetch model catalog: ${message}`);
    }
  }

  if (catalog.length > 0) {
    const choice = await select({
      message: "Select a model",
      choices: [
        ...catalog.slice(0, 40).map((entry) => ({
          name: entry.displayName ? `${entry.id} — ${entry.displayName}` : entry.id,
          value: entry.id,
        })),
        { name: "Enter model ID manually", value: "__manual__" },
      ],
    });
    if (choice !== "__manual__") {
      return choice;
    }
  }

  const modelName = await input({
    message: provider === "azure" ? "Azure deployment name" : "Model ID",
    validate: (value) => validateModelName(value) ?? true,
  });
  return modelName.trim();
}

async function collectBedrockCredentials(): Promise<{
  credentials: Record<string, string>;
  awsRegion: string;
}> {
  const awsRegion = await input({
    message: "AWS region (e.g. us-east-1)",
    validate: (value) => (value.trim() ? true : "Region is required."),
  });
  const authMode = await select({
    message: "Bedrock authentication",
    choices: [
      { name: "API key (Bearer)", value: "api_key" as const },
      { name: "IAM access key", value: "iam" as const },
    ],
  });

  if (authMode === "api_key") {
    const apiKey = await password({
      message: "Bedrock API key",
      mask: "*",
      validate: (value) => (value.trim() ? true : "API key is required."),
    });
    const credentials = { apiKey: apiKey.trim() };
    const error = validateBedrockCredentials({ ...credentials, awsRegion: awsRegion.trim() });
    if (error) {
      throw new Error(error);
    }
    return { credentials, awsRegion: awsRegion.trim() };
  }

  const accessKeyId = await input({
    message: "AWS access key ID",
    validate: (value) => (value.trim() ? true : "Access key ID is required."),
  });
  const secretAccessKey = await password({
    message: "AWS secret access key",
    mask: "*",
    validate: (value) => (value.trim() ? true : "Secret access key is required."),
  });
  const credentials = {
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
  };
  const error = validateBedrockCredentials({ ...credentials, awsRegion: awsRegion.trim() });
  if (error) {
    throw new Error(error);
  }
  return { credentials, awsRegion: awsRegion.trim() };
}

async function collectVertexCredentials(): Promise<{
  credentials: Record<string, string>;
  vertexProject: string;
  vertexLocation: string;
}> {
  const vertexProject = await input({
    message: "GCP project ID",
    validate: (value) => (value.trim() ? true : "Project ID is required."),
  });
  const vertexLocation = await input({
    message: "GCP location (e.g. us-central1)",
    validate: (value) => (value.trim() ? true : "Location is required."),
  });
  const authMode = await select({
    message: "Vertex authentication",
    choices: [
      { name: "API key", value: "api_key" as const },
      { name: "Service account", value: "service_account" as const },
    ],
  });

  if (authMode === "api_key") {
    const apiKey = await password({
      message: "Vertex API key",
      mask: "*",
      validate: (value) => (value.trim() ? true : "API key is required."),
    });
    const credentials = { apiKey: apiKey.trim() };
    const error = validateVertexCredentials({
      ...credentials,
      vertexProject: vertexProject.trim(),
      vertexLocation: vertexLocation.trim(),
    });
    if (error) {
      throw new Error(error);
    }
    return {
      credentials,
      vertexProject: vertexProject.trim(),
      vertexLocation: vertexLocation.trim(),
    };
  }

  const clientEmail = await input({
    message: "Service account client email",
    validate: (value) => (value.trim() ? true : "Client email is required."),
  });
  const keySource = await select({
    message: "Private key input",
    choices: [
      { name: "Paste PEM private key", value: "paste" as const },
      { name: "Path to service account JSON", value: "file" as const },
    ],
  });
  let privateKey = "";
  if (keySource === "file") {
    const jsonPath = await input({
      message: "Path to service account JSON file",
      validate: (value) => (value.trim() ? true : "Path is required."),
    });
    const raw = readFileSync(jsonPath.trim(), "utf8");
    const parsed = JSON.parse(raw) as { private_key?: string; client_email?: string };
    privateKey = parsed.private_key?.trim() ?? "";
    if (!privateKey) {
      throw new Error("Service account JSON is missing private_key.");
    }
  } else {
    privateKey = await input({
      message: "Paste private key (PEM)",
      validate: (value) => (value.trim() ? true : "Private key is required."),
    });
  }

  const credentials = {
    clientEmail: clientEmail.trim(),
    privateKey: privateKey.trim(),
  };
  const error = validateVertexCredentials({
    ...credentials,
    vertexProject: vertexProject.trim(),
    vertexLocation: vertexLocation.trim(),
  });
  if (error) {
    throw new Error(error);
  }
  return {
    credentials,
    vertexProject: vertexProject.trim(),
    vertexLocation: vertexLocation.trim(),
  };
}

export async function runProviderWizard(): Promise<ProviderSetupResult> {
  const provider = await select({
    message: "LLM provider",
    choices: [
      ...listProviderPresets().map((preset) => ({
        name: preset.label,
        value: preset.id,
      })),
      { name: "Custom", value: CUSTOM_PROVIDER_PRESET_ID },
    ],
  });

  let siteId: string | undefined;
  if (providerNeedsSiteSelection(provider)) {
    siteId = await select({
      message: "Provider region / site",
      choices: listSiteOptions(provider),
    });
  }

  let workspaceId: string | undefined;
  if (provider === "alibaba" && siteId && siteNeedsWorkspaceId(provider, siteId)) {
    workspaceId = await input({
      message: "Alibaba workspace ID",
      validate: (value) => (value.trim() ? true : "Workspace ID is required for this region."),
    });
  }

  let credentials: Record<string, string> = {};
  let awsRegion: string | undefined;
  let azureResourceName: string | undefined;
  let vertexProject: string | undefined;
  let vertexLocation: string | undefined;
  let apiBaseOverride: string | undefined;

  if (provider === "amazon-bedrock") {
    const collected = await collectBedrockCredentials();
    credentials = collected.credentials;
    awsRegion = collected.awsRegion;
  } else if (provider === "google-vertex-ai") {
    const collected = await collectVertexCredentials();
    credentials = collected.credentials;
    vertexProject = collected.vertexProject;
    vertexLocation = collected.vertexLocation;
  } else if (provider === "azure") {
    azureResourceName = await input({
      message: "Azure OpenAI resource name",
      validate: (value) => (value.trim() ? true : "Resource name is required."),
    });
    const apiKey = await password({
      message: "Azure API key",
      mask: "*",
      validate: (value) => (value.trim() ? true : "API key is required."),
    });
    credentials = { apiKey: apiKey.trim() };
  } else if (provider === CUSTOM_PROVIDER_PRESET_ID) {
    apiBaseOverride = await input({
      message: "API base URL",
      validate: (value) => (value.trim() ? true : "API base URL is required."),
    });
    const apiKey = await password({
      message: "API key",
      mask: "*",
      validate: (value) => (value.trim() ? true : "API key is required."),
    });
    credentials = { apiKey: apiKey.trim() };
  } else {
    const apiKey = await password({
      message: "API key",
      mask: "*",
      validate: (value) => validateApiKeyRequired(provider, value) ?? true,
    });
    credentials = apiKey.trim() ? { apiKey: apiKey.trim() } : {};
  }

  const wizardInput: WizardSetupInput = {
    provider,
    modelName: "placeholder",
    ...(siteId ? { siteId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(awsRegion ? { awsRegion } : {}),
    ...(azureResourceName ? { azureResourceName } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(apiBaseOverride ? { apiBaseOverride } : {}),
  };

  const modelName = await promptModelId(provider, credentials["apiKey"] ?? "", wizardInput, {
    ...(credentials["accessKeyId"] ? { accessKeyId: credentials["accessKeyId"] } : {}),
    ...(credentials["secretAccessKey"] ? { secretAccessKey: credentials["secretAccessKey"] } : {}),
    ...(credentials["clientEmail"] ? { vertexClientEmail: credentials["clientEmail"] } : {}),
    ...(credentials["privateKey"] ? { vertexPrivateKey: credentials["privateKey"] } : {}),
  });

  if (provider === "azure") {
    const azureError = validateAzureSetup({
      ...(azureResourceName ? { azureResourceName } : {}),
      apiKey: credentials["apiKey"] ?? "",
      modelName,
    });
    if (azureError) {
      throw new Error(azureError);
    }
  }
  if (provider === CUSTOM_PROVIDER_PRESET_ID) {
    const customError = validateCustomSetup({
      ...(apiBaseOverride ? { apiBase: apiBaseOverride } : {}),
      apiKey: credentials["apiKey"] ?? "",
      modelName,
    });
    if (customError) {
      throw new Error(customError);
    }
  }

  const result = buildProviderSetupResult({ ...wizardInput, modelName });

  const activeModelName = result.activeModel?.name ?? modelName;
  const confirmed = await confirm({
    message: `Save ${activeModelName} (${provider}) as the active model?`,
    default: true,
  });
  if (!confirmed) {
    throw new Error("Setup cancelled.");
  }

  return Object.keys(credentials).length > 0 ? { ...result, credentials } : result;
}
