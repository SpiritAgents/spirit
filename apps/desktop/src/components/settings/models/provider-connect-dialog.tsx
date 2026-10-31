import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  connectTransportOptionSummary,
  connectTransportOptionsForProvider,
  defaultConnectTransportKind,
  providerShowsConnectTransportPicker,
  resolveConnectTransportKindForProvider,
} from "@/components/settings/models/connect-transport";
import { ModelCapabilitiesCombobox } from "@/components/settings/models/model-capabilities-combobox";
import {
  defaultCustomModelCapabilities,
  normalizeModelCapabilitySelection,
} from "@/components/settings/models/model-defaults";
import { providerPickerLabel } from "@/components/settings/models/provider-picker-rows";
import { providerLabelKey } from "@/lib/model-picker-groups";
import { joinWithCjkSpacing } from "@/lib/cjk";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hasBedrockIamCredentials,
  hasGoogleVertexServiceAccountCredentials,
} from "@/lib/provider-runtime-credentials";
import {
  CUSTOM_PROVIDER_PRESET_ID,
  findProviderPreset,
  type ProviderPresetCredentialKind,
} from "@spiritagent/agent-core/provider-presets";
import { DESKTOP_FORM_FIELD_TRIGGER_INNER, DESKTOP_FORM_INPUT_SHELL } from "@/lib/desktop-chrome";
import { DESKTOP_EDITOR_TAB_CLASS } from "@/lib/desktop-typography";
import { parseModelContextLength } from "@/lib/model-context-length";
import { cn } from "@/lib/utils";
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopModelCapability,
  DesktopProviderPickerPreset,
  DesktopTransportKind,
  PreviewModelsRequest,
  PreviewModelsResponse,
} from "@/types";
import { isValidAzureResourceName } from "@spiritagent/host-internal/azure-resource";
import {
  isValidCloudflareAccountId,
  isValidCloudflareGatewayId,
} from "@spiritagent/host-internal/cloudflare-ai-gateway-resource";

export type ProviderConnectDialogProps = {
  /** Provider preset id (or `custom`) to connect; the parent remounts this component with a new key on each connection attempt to reset the form. */
  provider: string;
  /** Preset picker rows from the host snapshot (fallback label for the dialog title). */
  providerPresets: readonly DesktopProviderPickerPreset[];
  /** True when the config already has this provider's entry: reconnecting re-materializes the wizard-owned keys (the helper line says so). */
  reconnect?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  previewBusy: boolean;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
};

/**
 * Provider connection dialog: shared by the settings page and the OOBE wizard.
 * Form state is owned by this component; the parent resets it by changing the key (on close, state
 * is kept until the exit animation finishes).
 */
export function ProviderConnectDialog({
  provider,
  providerPresets,
  reconnect = false,
  open,
  onOpenChange,
  busy,
  previewBusy,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
}: ProviderConnectDialogProps) {
  const { t } = useTranslation();
  const [connectApiKey, setConnectApiKey] = useState("");
  const [connectAwsRegion, setConnectAwsRegion] = useState("");
  const [connectAzureResourceName, setConnectAzureResourceName] = useState("");
  const [connectCloudflareAccountId, setConnectCloudflareAccountId] = useState("");
  const [connectCloudflareGatewayId, setConnectCloudflareGatewayId] = useState("");
  const [connectAccessKeyId, setConnectAccessKeyId] = useState("");
  const [connectSecretAccessKey, setConnectSecretAccessKey] = useState("");
  const [connectVertexProject, setConnectVertexProject] = useState("");
  const [connectVertexLocation, setConnectVertexLocation] = useState("");
  const [connectVertexClientEmail, setConnectVertexClientEmail] = useState("");
  const [connectVertexPrivateKey, setConnectVertexPrivateKey] = useState("");
  const [connectName, setConnectName] = useState("");
  const [connectApiBase, setConnectApiBase] = useState("");
  const [connectCapabilities, setConnectCapabilities] = useState<DesktopModelCapability[]>(
    defaultCustomModelCapabilities,
  );
  const [connectContextLength, setConnectContextLength] = useState("");
  const [connectTransportKind, setConnectTransportKind] = useState<DesktopTransportKind>(() =>
    defaultConnectTransportKind(provider),
  );
  const [connectProviderSite, setConnectProviderSite] = useState(() => {
    const preset =
      provider === CUSTOM_PROVIDER_PRESET_ID ? undefined : findProviderPreset(provider);
    return preset?.sites?.default ?? "";
  });
  const [connectAlibabaBillingMode, setConnectAlibabaBillingMode] = useState<
    "standard" | "token-plan"
  >("standard");
  const [connectStepfunBillingMode, setConnectStepfunBillingMode] = useState<
    "standard" | "step-plan"
  >("standard");
  const [connectGlmCodingPlanBillingMode, setConnectGlmCodingPlanBillingMode] = useState<
    "standard" | "glm-coding-plan"
  >("standard");
  const [connectAlibabaWorkspaceId, setConnectAlibabaWorkspaceId] = useState("");
  const [customConnectMode, setCustomConnectMode] = useState<"single" | "bulk">("single");
  const [bedrockConnectMode, setBedrockConnectMode] = useState<"bearer" | "iam">("bearer");
  const [vertexConnectMode, setVertexConnectMode] = useState<"adc" | "service-account" | "express">(
    "adc",
  );
  const [connectCustomGroupLabel, setConnectCustomGroupLabel] = useState("");

  const connectPreset =
    provider === CUSTOM_PROVIDER_PRESET_ID ? undefined : findProviderPreset(provider);
  /** The preset's declared credential shape drives which credential form the wizard collects. */
  const connectCredentialKind: ProviderPresetCredentialKind =
    connectPreset?.credentials.kind ?? "apiKey";
  /**
   * The credential form currently in view, as a materialization input: the plain apiKey form on a
   * non-apiKey preset (Vertex Express) selects the preset's `expressApiBase`.
   */
  const credentialKindForRequest: ProviderPresetCredentialKind =
    connectCredentialKind === "bedrock"
      ? bedrockConnectMode === "iam"
        ? "bedrock"
        : "apiKey"
      : connectCredentialKind === "vertex"
        ? vertexConnectMode === "express"
          ? "apiKey"
          : "vertex"
        : "apiKey";
  const connectSiteOptions = connectPreset?.sites?.items ?? [];
  const connectSiteRequiresWorkspaceId = (siteId: string): boolean =>
    connectSiteOptions.find((item) => item.id === siteId)?.requiresWorkspaceId === true;

  const selectedProviderLabel = providerPickerLabel(
    (key, options) => String(t(key, options)),
    provider,
    providerPresets,
  );
  const [connectionTitlePrefix = "", connectionTitleSuffix = ""] = t(
    "settings.connectNamedProviderTitle",
  ).split("{{provider}}");
  const connectionTitle =
    provider === CUSTOM_PROVIDER_PRESET_ID
      ? t("settings.customConnection")
      : joinWithCjkSpacing(connectionTitlePrefix, selectedProviderLabel, connectionTitleSuffix);

  const connectTransportKindForRequest = resolveConnectTransportKindForProvider(
    provider,
    connectTransportKind,
  );

  const connectAlibabaIsTokenPlan =
    provider === "alibaba" && connectAlibabaBillingMode === "token-plan";
  const connectBillingPlanIdForRequest =
    provider === "alibaba" && connectAlibabaIsTokenPlan
      ? "token-plan"
      : provider === "stepfun" && connectStepfunBillingMode === "step-plan"
        ? "step-plan"
        : (provider === "z-ai" || provider === "zhipu-ai") &&
            connectGlmCodingPlanBillingMode === "glm-coding-plan"
          ? "glm-coding-plan"
          : undefined;
  const connectProviderSiteForRequest = connectAlibabaIsTokenPlan
    ? undefined
    : connectProviderSite.trim() || undefined;
  const connectAlibabaWorkspaceIdForRequest = connectAlibabaIsTokenPlan
    ? undefined
    : connectAlibabaWorkspaceId.trim() || undefined;
  const connectAlibabaWorkspaceRequired =
    provider === "alibaba" &&
    !connectAlibabaIsTokenPlan &&
    connectProviderSiteForRequest !== undefined &&
    connectSiteRequiresWorkspaceId(connectProviderSiteForRequest);

  const hasBedrockCatalogCredentials = hasBedrockIamCredentials({
    accessKeyId: connectAccessKeyId,
    secretAccessKey: connectSecretAccessKey,
  });
  const hasVertexCatalogCredentials = hasGoogleVertexServiceAccountCredentials({
    clientEmail: connectVertexClientEmail,
    privateKey: connectVertexPrivateKey,
  });
  const vertexConnectFields = {
    ...(connectVertexProject.trim() ? { vertexProject: connectVertexProject.trim() } : {}),
    ...(connectVertexLocation.trim() ? { vertexLocation: connectVertexLocation.trim() } : {}),
    // ADC writes no credential slots: service-account secrets only leave the form in its own mode.
    ...(vertexConnectMode === "service-account" && connectVertexClientEmail.trim()
      ? { vertexClientEmail: connectVertexClientEmail.trim() }
      : {}),
    ...(vertexConnectMode === "service-account" && connectVertexPrivateKey.trim()
      ? { vertexPrivateKey: connectVertexPrivateKey.trim() }
      : {}),
  };

  const syncCatalogFromUpstream = async (forceRefresh: boolean) => {
    if (provider === "amazon-bedrock") {
      if (!connectAwsRegion.trim()) {
        throw new Error(t("settings.bedrockRegionRequired"));
      }
      if (!hasBedrockCatalogCredentials) {
        throw new Error(t("settings.bedrockCatalogIamRequired"));
      }
    } else if (provider === "google-vertex-ai") {
      if (!connectVertexProject.trim() || !connectVertexLocation.trim()) {
        throw new Error(t("settings.vertexProjectLocationRequired"));
      }
      if (vertexConnectMode === "service-account" && !hasVertexCatalogCredentials) {
        throw new Error(t("settings.vertexCatalogServiceAccountRequired"));
      }
    } else if (provider === "custom") {
      if (!connectApiBase.trim()) {
        throw new Error(t("settings.endpointRequired"));
      }
    } else if (!connectApiKey.trim()) {
      throw new Error(t("settings.apiKeyRequired"));
    }
    if (connectAlibabaWorkspaceRequired && !connectAlibabaWorkspaceIdForRequest) {
      throw new Error(t("settings.alibabaWorkspaceIdRequired"));
    }
    const res = await onPreviewModels({
      apiBase: provider === CUSTOM_PROVIDER_PRESET_ID ? connectApiBase.trim() : "",
      apiKey: connectApiKey,
      provider,
      credentialKind: credentialKindForRequest,
      ...(provider === "amazon-bedrock"
        ? {
            awsRegion: connectAwsRegion.trim(),
            accessKeyId: connectAccessKeyId.trim(),
            secretAccessKey: connectSecretAccessKey.trim(),
          }
        : {}),
      ...(provider === "google-vertex-ai" ? vertexConnectFields : {}),
      ...(provider === "azure" && connectAzureResourceName.trim()
        ? { azureResourceName: connectAzureResourceName.trim() }
        : {}),
      ...(provider === "cloudflare-ai-gateway"
        ? {
            cloudflareAccountId: connectCloudflareAccountId.trim(),
            cloudflareGatewayId: connectCloudflareGatewayId.trim(),
          }
        : {}),
      ...(connectTransportKindForRequest !== undefined
        ? { transportKind: connectTransportKindForRequest }
        : {}),
      ...(connectProviderSiteForRequest ? { siteId: connectProviderSiteForRequest } : {}),
      ...(connectAlibabaWorkspaceIdForRequest
        ? { workspaceId: connectAlibabaWorkspaceIdForRequest }
        : {}),
      ...(connectBillingPlanIdForRequest ? { billingPlanId: connectBillingPlanIdForRequest } : {}),
      forceRefresh,
    });
    if (res.modelIds.length === 0) {
      throw new Error(t("settings.noModelsReturned"));
    }
    const bulk: AddProviderModelsRequest = {
      apiBase: provider === CUSTOM_PROVIDER_PRESET_ID ? connectApiBase.trim() : "",
      apiKey: connectApiKey,
      modelIds: res.modelIds,
      ...(res.models ? { modelCatalog: res.models } : {}),
      provider,
      credentialKind: credentialKindForRequest,
      ...(provider === "amazon-bedrock"
        ? {
            awsRegion: connectAwsRegion.trim(),
            accessKeyId: connectAccessKeyId.trim(),
            secretAccessKey: connectSecretAccessKey.trim(),
          }
        : {}),
      ...(provider === "google-vertex-ai" ? vertexConnectFields : {}),
      ...(provider === "azure" && connectAzureResourceName.trim()
        ? { azureResourceName: connectAzureResourceName.trim() }
        : {}),
      ...(provider === "cloudflare-ai-gateway"
        ? {
            cloudflareAccountId: connectCloudflareAccountId.trim(),
            cloudflareGatewayId: connectCloudflareGatewayId.trim(),
          }
        : {}),
      ...(connectTransportKindForRequest !== undefined
        ? { transportKind: connectTransportKindForRequest }
        : {}),
      ...(connectProviderSiteForRequest ? { siteId: connectProviderSiteForRequest } : {}),
      ...(connectAlibabaWorkspaceIdForRequest
        ? { workspaceId: connectAlibabaWorkspaceIdForRequest }
        : {}),
      ...(connectBillingPlanIdForRequest ? { billingPlanId: connectBillingPlanIdForRequest } : {}),
      ...(provider === CUSTOM_PROVIDER_PRESET_ID && connectCustomGroupLabel.trim()
        ? { customProviderLabel: connectCustomGroupLabel.trim() }
        : {}),
    };
    await onAddProviderModels(bulk);
    onOpenChange(false);
  };

  const saveCustomSingle = async () => {
    if (provider !== CUSTOM_PROVIDER_PRESET_ID) {
      return;
    }
    const name = connectName.trim();
    const apiBase = connectApiBase.trim();
    if (!name) {
      throw new Error(t("settings.modelNameRequired"));
    }
    if (!apiBase) {
      throw new Error(t("settings.endpointRequired"));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t("settings.contextLengthInvalid"));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase,
      apiKey: connectApiKey,
      provider: CUSTOM_PROVIDER_PRESET_ID,
      transportKind: connectTransportKind,
      capabilities: normalizeModelCapabilitySelection(connectCapabilities),
      ...(connectCustomGroupLabel.trim()
        ? { customProviderLabel: connectCustomGroupLabel.trim() }
        : {}),
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

  /**
   * Vertex Express: the plain apiKey credential form on the vertex preset. The express endpoint
   * cannot list models, so this path adds one manually entered model instead of syncing the catalog.
   */
  const saveVertexExpressSingle = async () => {
    if (provider !== "google-vertex-ai" || vertexConnectMode !== "express") {
      return;
    }
    const name = connectName.trim();
    if (!name) {
      throw new Error(t("settings.modelNameRequired"));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t("settings.apiKeyRequired"));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t("settings.contextLengthInvalid"));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: "",
      apiKey: connectApiKey,
      provider: "google-vertex-ai",
      credentialKind: "apiKey",
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

  const saveBedrockBearerSingle = async () => {
    if (provider !== "amazon-bedrock") {
      return;
    }
    const awsRegion = connectAwsRegion.trim();
    const name = connectName.trim();
    if (!awsRegion) {
      throw new Error(t("settings.bedrockRegionRequired"));
    }
    if (!name) {
      throw new Error(t("settings.modelNameRequired"));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t("settings.apiKeyRequired"));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t("settings.contextLengthInvalid"));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: "",
      apiKey: connectApiKey,
      provider: "amazon-bedrock",
      transportKind: "bedrock",
      credentialKind: "apiKey",
      awsRegion,
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

  const saveAzureSingle = async () => {
    if (provider !== "azure") {
      return;
    }
    const azureResourceName = connectAzureResourceName.trim();
    const name = connectName.trim();
    if (!azureResourceName) {
      throw new Error(t("settings.azureResourceNameRequired"));
    }
    if (!isValidAzureResourceName(azureResourceName)) {
      throw new Error(t("settings.azureResourceNameInvalid"));
    }
    if (!name) {
      throw new Error(t("settings.azureDeploymentNameRequired"));
    }
    if (/\s/u.test(name)) {
      throw new Error(t("settings.azureDeploymentNameWhitespace"));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t("settings.apiKeyRequired"));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t("settings.contextLengthInvalid"));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: "",
      apiKey: connectApiKey,
      provider: "azure",
      transportKind: "open-responses",
      credentialKind: "apiKey",
      azureResourceName,
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

  const saveCloudflareSingle = async () => {
    if (provider !== "cloudflare-ai-gateway") {
      return;
    }
    const accountId = connectCloudflareAccountId.trim();
    const gatewayId = connectCloudflareGatewayId.trim();
    const name = connectName.trim();
    if (!accountId) {
      throw new Error(t("settings.cloudflareAccountIdRequired"));
    }
    if (!isValidCloudflareAccountId(accountId)) {
      throw new Error(t("settings.cloudflareAccountIdInvalid"));
    }
    if (!gatewayId) {
      throw new Error(t("settings.cloudflareGatewayIdRequired"));
    }
    if (!isValidCloudflareGatewayId(gatewayId)) {
      throw new Error(t("settings.cloudflareGatewayIdInvalid"));
    }
    if (!name) {
      throw new Error(t("settings.modelNameRequired"));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t("settings.cloudflareAiGatewayApiTokenRequired"));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t("settings.contextLengthInvalid"));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: "",
      apiKey: connectApiKey,
      provider: "cloudflare-ai-gateway",
      transportKind:
        connectTransportKindForRequest ?? defaultConnectTransportKind("cloudflare-ai-gateway"),
      credentialKind: "apiKey",
      cloudflareAccountId: accountId,
      cloudflareGatewayId: gatewayId,
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>{connectionTitle}</DialogTitle>
        </DialogHeader>

        {reconnect ? (
          <p className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {t("settings.providerReconnectHint")}
          </p>
        ) : null}

        <div className="grid gap-3 py-1">
          {provider === "alibaba" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-alibaba-billing-mode">
                {t("settings.alibabaBillingMode")}
              </Label>
              <div className={DESKTOP_FORM_INPUT_SHELL}>
                <Select
                  value={connectAlibabaBillingMode}
                  onValueChange={(value) =>
                    setConnectAlibabaBillingMode(value as "standard" | "token-plan")
                  }
                >
                  <SelectTrigger
                    id="connect-alibaba-billing-mode"
                    className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">
                      {t("settings.alibabaBillingModeStandard")}
                    </SelectItem>
                    <SelectItem value="token-plan">
                      {t("settings.alibabaBillingModeTokenPlan")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {provider === "stepfun" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-stepfun-billing-mode">
                {t("settings.stepfunBillingMode")}
              </Label>
              <div className={DESKTOP_FORM_INPUT_SHELL}>
                <Select
                  value={connectStepfunBillingMode}
                  onValueChange={(value) =>
                    setConnectStepfunBillingMode(value as "standard" | "step-plan")
                  }
                >
                  <SelectTrigger
                    id="connect-stepfun-billing-mode"
                    className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">
                      {t("settings.stepfunBillingModeStandard")}
                    </SelectItem>
                    <SelectItem value="step-plan">
                      {t("settings.stepfunBillingModeStepPlan")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {provider === "z-ai" || provider === "zhipu-ai" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-glm-coding-plan-billing-mode">
                {t("settings.glmCodingPlanBillingMode")}
              </Label>
              <div className={DESKTOP_FORM_INPUT_SHELL}>
                <Select
                  value={connectGlmCodingPlanBillingMode}
                  onValueChange={(value) =>
                    setConnectGlmCodingPlanBillingMode(value as "standard" | "glm-coding-plan")
                  }
                >
                  <SelectTrigger
                    id="connect-glm-coding-plan-billing-mode"
                    className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">
                      {t("settings.glmCodingPlanBillingModeStandard")}
                    </SelectItem>
                    <SelectItem value="glm-coding-plan">
                      {t("settings.glmCodingPlanBillingModeGlmCodingPlan")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {connectSiteOptions.length > 0 && !connectAlibabaIsTokenPlan ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-provider-site">{t("settings.site")}</Label>
              <div className={DESKTOP_FORM_INPUT_SHELL}>
                <Select value={connectProviderSite} onValueChange={setConnectProviderSite}>
                  <SelectTrigger
                    id="connect-provider-site"
                    className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connectSiteOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {t(`${providerLabelKey(provider)}Site.${option.id}`, {
                          defaultValue: option.label,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {connectAlibabaWorkspaceRequired ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-alibaba-workspace-id">
                {t("settings.alibabaWorkspaceId")}
              </Label>
              <DesktopFormInput
                id="connect-alibaba-workspace-id"
                value={connectAlibabaWorkspaceId}
                onChange={(e) => setConnectAlibabaWorkspaceId(e.target.value)}
                placeholder={t("settings.alibabaWorkspaceIdPlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {providerShowsConnectTransportPicker(provider) ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-api-transport">{t("settings.apiType")}</Label>
              <div className={DESKTOP_FORM_INPUT_SHELL}>
                <Select
                  value={connectTransportKind}
                  onValueChange={(value) => setConnectTransportKind(value as DesktopTransportKind)}
                >
                  <SelectTrigger
                    id="connect-api-transport"
                    className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connectTransportOptionsForProvider(provider).map((option) => (
                      <SelectItem key={`${option.value}-${option.label}`} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(() => {
                const transportSummary = connectTransportOptionsForProvider(provider)
                  .filter((option) => option.value === connectTransportKind)
                  .map((option) => connectTransportOptionSummary(option, provider))
                  .find(Boolean);
                return transportSummary ? (
                  <p className="text-xs leading-5 text-muted-foreground">{transportSummary}</p>
                ) : null;
              })()}
            </div>
          ) : null}
          {provider === "custom" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-custom-group-label">{t("settings.customGroupLabel")}</Label>
              <DesktopFormInput
                id="connect-custom-group-label"
                value={connectCustomGroupLabel}
                onChange={(e) => setConnectCustomGroupLabel(e.target.value)}
                placeholder={t("settings.customGroupLabelPlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "custom" ? (
            <div className="grid gap-2">
              <Label>{t("settings.modelAddMode")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.modelAddMode")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {(["single", "bulk"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={customConnectMode === value}
                    className={cn(
                      DESKTOP_EDITOR_TAB_CLASS,
                      customConnectMode === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-chrome-emphasis",
                    )}
                    disabled={busy || previewBusy}
                    onClick={() => setCustomConnectMode(value)}
                  >
                    {value === "single" ? t("settings.addSingle") : t("settings.addAll")}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {provider === "custom" && customConnectMode === "single" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-model-name">{t("settings.modelName")}</Label>
              <DesktopFormInput
                id="connect-model-name"
                value={connectName}
                onChange={(e) => setConnectName(e.target.value)}
                placeholder={t("settings.modelNameExample")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "custom" && customConnectMode === "single" ? (
            <div className="grid gap-2">
              <Label>{t("settings.modelCapabilities")}</Label>
              <ModelCapabilitiesCombobox
                value={connectCapabilities}
                disabled={busy || previewBusy}
                onChange={setConnectCapabilities}
              />
            </div>
          ) : null}
          {provider === "custom" && customConnectMode === "single" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-context-length">{t("settings.contextLength")}</Label>
              <DesktopFormInput
                id="connect-context-length"
                type="number"
                min={1}
                step={1}
                value={connectContextLength}
                onChange={(e) => setConnectContextLength(e.target.value)}
                placeholder={t("settings.optional")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "custom" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-api-base">{t("settings.endpoint")}</Label>
              <DesktopFormInput
                id="connect-api-base"
                value={connectApiBase}
                onChange={(e) => setConnectApiBase(e.target.value)}
                placeholder={t("settings.endpointPlaceholder")}
                autoComplete="off"
                required
              />
            </div>
          ) : null}
          {connectCredentialKind === "bedrock" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-aws-region">{t("settings.bedrockRegion")}</Label>
              <DesktopFormInput
                id="connect-aws-region"
                value={connectAwsRegion}
                onChange={(e) => setConnectAwsRegion(e.target.value)}
                placeholder={t("settings.bedrockRegionPlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {connectCredentialKind === "bedrock" ? (
            <div className="grid gap-2">
              <Label>{t("settings.bedrockAuthMode")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.bedrockAuthMode")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {(["bearer", "iam"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={bedrockConnectMode === value}
                    className={cn(
                      DESKTOP_EDITOR_TAB_CLASS,
                      bedrockConnectMode === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-chrome-emphasis",
                    )}
                    disabled={busy || previewBusy}
                    onClick={() => setBedrockConnectMode(value)}
                  >
                    {value === "bearer"
                      ? t("settings.bedrockAuthBearer")
                      : t("settings.bedrockAuthIam")}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {connectCredentialKind === "bedrock" && bedrockConnectMode === "bearer" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-bedrock-model-name">{t("settings.modelName")}</Label>
              <DesktopFormInput
                id="connect-bedrock-model-name"
                value={connectName}
                onChange={(e) => setConnectName(e.target.value)}
                placeholder={t("settings.bedrockModelNamePlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {connectCredentialKind === "bedrock" && bedrockConnectMode === "bearer" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-context-length-bedrock">{t("settings.contextLength")}</Label>
              <DesktopFormInput
                id="connect-context-length-bedrock"
                type="number"
                min={1}
                step={1}
                value={connectContextLength}
                onChange={(e) => setConnectContextLength(e.target.value)}
                placeholder={t("settings.optional")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "azure" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-azure-resource-name">{t("settings.azureResourceName")}</Label>
              <DesktopFormInput
                id="connect-azure-resource-name"
                value={connectAzureResourceName}
                onChange={(e) => setConnectAzureResourceName(e.target.value)}
                placeholder={t("settings.azureResourceNamePlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "azure" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-azure-deployment-name">
                {t("settings.azureDeploymentName")}
              </Label>
              <DesktopFormInput
                id="connect-azure-deployment-name"
                value={connectName}
                onChange={(e) => setConnectName(e.target.value)}
                placeholder={t("settings.azureDeploymentNamePlaceholder")}
                autoComplete="off"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {t("settings.azureSingleHint")}
              </p>
            </div>
          ) : null}
          {provider === "azure" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-context-length-azure">{t("settings.contextLength")}</Label>
              <DesktopFormInput
                id="connect-context-length-azure"
                type="number"
                min={1}
                step={1}
                value={connectContextLength}
                onChange={(e) => setConnectContextLength(e.target.value)}
                placeholder={t("settings.optional")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "cloudflare-ai-gateway" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="connect-cloudflare-account-id">
                  {t("settings.cloudflareAccountId")}
                </Label>
                <DesktopFormInput
                  id="connect-cloudflare-account-id"
                  value={connectCloudflareAccountId}
                  onChange={(e) => setConnectCloudflareAccountId(e.target.value)}
                  placeholder={t("settings.cloudflareAccountIdPlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connect-cloudflare-gateway-id">
                  {t("settings.cloudflareGatewayId")}
                </Label>
                <DesktopFormInput
                  id="connect-cloudflare-gateway-id"
                  value={connectCloudflareGatewayId}
                  onChange={(e) => setConnectCloudflareGatewayId(e.target.value)}
                  placeholder={t("settings.cloudflareGatewayIdPlaceholder")}
                  autoComplete="off"
                />
              </div>
            </>
          ) : null}
          {provider === "cloudflare-ai-gateway" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-cloudflare-model-name">{t("settings.modelName")}</Label>
              <DesktopFormInput
                id="connect-cloudflare-model-name"
                value={connectName}
                onChange={(e) => setConnectName(e.target.value)}
                placeholder={t("settings.cloudflareModelNamePlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {provider === "cloudflare-ai-gateway" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-context-length-cloudflare">
                {t("settings.contextLength")}
              </Label>
              <DesktopFormInput
                id="connect-context-length-cloudflare"
                type="number"
                min={1}
                step={1}
                value={connectContextLength}
                onChange={(e) => setConnectContextLength(e.target.value)}
                placeholder={t("settings.optional")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {connectCredentialKind === "apiKey" ||
          (connectCredentialKind === "bedrock" && bedrockConnectMode === "bearer") ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-api-key">
                {connectCredentialKind === "bedrock"
                  ? t("settings.bedrockApiKeyLabel")
                  : provider === "cloudflare-ai-gateway"
                    ? t("settings.cloudflareAiGatewayApiToken")
                    : "API Key"}
              </Label>
              <DesktopFormInput
                id="connect-api-key"
                type="password"
                value={connectApiKey}
                onChange={(e) => setConnectApiKey(e.target.value)}
                placeholder={
                  provider === "cloudflare-ai-gateway"
                    ? t("settings.cloudflareAiGatewayApiTokenPlaceholder")
                    : t("settings.enterApiKey")
                }
                autoComplete="off"
              />
              {connectCredentialKind === "bedrock" ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("settings.bedrockBearerHint")}
                </p>
              ) : null}
            </div>
          ) : null}
          {connectCredentialKind === "bedrock" && bedrockConnectMode === "iam" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="connect-access-key-id">{t("settings.bedrockAccessKeyId")}</Label>
                <DesktopFormInput
                  id="connect-access-key-id"
                  value={connectAccessKeyId}
                  onChange={(e) => setConnectAccessKeyId(e.target.value)}
                  placeholder={t("settings.enterApiKey")}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connect-secret-access-key">
                  {t("settings.bedrockSecretAccessKey")}
                </Label>
                <DesktopFormInput
                  id="connect-secret-access-key"
                  type="password"
                  value={connectSecretAccessKey}
                  onChange={(e) => setConnectSecretAccessKey(e.target.value)}
                  placeholder={t("settings.enterApiKey")}
                  autoComplete="off"
                />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("settings.bedrockIamHint")}
              </p>
            </>
          ) : null}
          {connectCredentialKind === "vertex" ? (
            <div className="grid gap-2">
              <Label>{t("settings.vertexAuthMode")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.vertexAuthMode")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {(["adc", "service-account", "express"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={vertexConnectMode === value}
                    className={cn(
                      DESKTOP_EDITOR_TAB_CLASS,
                      vertexConnectMode === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-chrome-emphasis",
                    )}
                    disabled={busy || previewBusy}
                    onClick={() => setVertexConnectMode(value)}
                  >
                    {value === "adc"
                      ? t("settings.vertexAuthAdc")
                      : value === "service-account"
                        ? t("settings.vertexAuthServiceAccount")
                        : t("settings.vertexAuthExpress")}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {connectCredentialKind === "vertex" && vertexConnectMode === "express" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-vertex-api-key">API Key</Label>
              <DesktopFormInput
                id="connect-vertex-api-key"
                type="password"
                value={connectApiKey}
                onChange={(e) => setConnectApiKey(e.target.value)}
                placeholder={t("settings.enterApiKey")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {connectCredentialKind === "vertex" && vertexConnectMode !== "express" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="connect-vertex-project">{t("settings.vertexProject")}</Label>
                <DesktopFormInput
                  id="connect-vertex-project"
                  value={connectVertexProject}
                  onChange={(e) => setConnectVertexProject(e.target.value)}
                  placeholder={t("settings.vertexProjectPlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connect-vertex-location">{t("settings.vertexLocation")}</Label>
                <DesktopFormInput
                  id="connect-vertex-location"
                  value={connectVertexLocation}
                  onChange={(e) => setConnectVertexLocation(e.target.value)}
                  placeholder={t("settings.vertexLocationPlaceholder")}
                  autoComplete="off"
                />
              </div>
            </>
          ) : null}
          {connectCredentialKind === "vertex" && vertexConnectMode === "adc" ? (
            <p className="text-xs leading-5 text-muted-foreground">{t("settings.vertexAdcHint")}</p>
          ) : null}
          {connectCredentialKind === "vertex" && vertexConnectMode === "express" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-vertex-model-name">{t("settings.modelName")}</Label>
              <DesktopFormInput
                id="connect-vertex-model-name"
                value={connectName}
                onChange={(e) => setConnectName(e.target.value)}
                placeholder={t("settings.vertexModelNamePlaceholder")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {connectCredentialKind === "vertex" && vertexConnectMode === "express" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-context-length-vertex">{t("settings.contextLength")}</Label>
              <DesktopFormInput
                id="connect-context-length-vertex"
                type="number"
                min={1}
                step={1}
                value={connectContextLength}
                onChange={(e) => setConnectContextLength(e.target.value)}
                placeholder={t("settings.optional")}
                autoComplete="off"
              />
            </div>
          ) : null}
          {connectCredentialKind === "vertex" && vertexConnectMode === "service-account" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="connect-vertex-client-email">
                  {t("settings.vertexClientEmail")}
                </Label>
                <DesktopFormInput
                  id="connect-vertex-client-email"
                  value={connectVertexClientEmail}
                  onChange={(e) => setConnectVertexClientEmail(e.target.value)}
                  placeholder={t("settings.vertexClientEmailPlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connect-vertex-private-key">{t("settings.vertexPrivateKey")}</Label>
                <DesktopFormInput
                  id="connect-vertex-private-key"
                  type="password"
                  value={connectVertexPrivateKey}
                  onChange={(e) => setConnectVertexPrivateKey(e.target.value)}
                  placeholder={t("settings.enterApiKey")}
                  autoComplete="off"
                />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("settings.vertexServiceAccountHint")}
              </p>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <DialogFooterActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy || previewBusy}
            >
              {t("common.cancel")}
            </Button>
            {provider === "custom" && customConnectMode === "single" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || previewBusy || !connectName.trim() || !connectApiBase.trim()}
                onClick={() => {
                  void (async () => {
                    try {
                      await saveCustomSingle();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {provider === "custom" && customConnectMode === "bulk" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || previewBusy || !connectApiBase.trim()}
                onClick={() => {
                  void (async () => {
                    try {
                      await syncCatalogFromUpstream(true);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy || previewBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {connectCredentialKind === "bedrock" && bedrockConnectMode === "bearer" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  previewBusy ||
                  !connectAwsRegion.trim() ||
                  !connectName.trim() ||
                  !connectApiKey.trim()
                }
                onClick={() => {
                  void (async () => {
                    try {
                      await saveBedrockBearerSingle();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {connectCredentialKind === "bedrock" && bedrockConnectMode === "iam" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy || previewBusy || !connectAwsRegion.trim() || !hasBedrockCatalogCredentials
                }
                onClick={() => {
                  void (async () => {
                    try {
                      await syncCatalogFromUpstream(false);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy || previewBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {connectCredentialKind === "vertex" && vertexConnectMode === "adc" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  previewBusy ||
                  !connectVertexProject.trim() ||
                  !connectVertexLocation.trim()
                }
                onClick={() => {
                  void (async () => {
                    try {
                      await syncCatalogFromUpstream(false);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy || previewBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {connectCredentialKind === "vertex" && vertexConnectMode === "service-account" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  previewBusy ||
                  !connectVertexProject.trim() ||
                  !connectVertexLocation.trim() ||
                  !hasVertexCatalogCredentials
                }
                onClick={() => {
                  void (async () => {
                    try {
                      await syncCatalogFromUpstream(false);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy || previewBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {connectCredentialKind === "vertex" && vertexConnectMode === "express" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || previewBusy || !connectName.trim() || !connectApiKey.trim()}
                onClick={() => {
                  void (async () => {
                    try {
                      await saveVertexExpressSingle();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {provider === "azure" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  previewBusy ||
                  !connectAzureResourceName.trim() ||
                  !connectName.trim() ||
                  !connectApiKey.trim()
                }
                onClick={() => {
                  void (async () => {
                    try {
                      await saveAzureSingle();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {provider === "cloudflare-ai-gateway" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  previewBusy ||
                  !connectCloudflareAccountId.trim() ||
                  !connectCloudflareGatewayId.trim() ||
                  !connectName.trim() ||
                  !connectApiKey.trim()
                }
                onClick={() => {
                  void (async () => {
                    try {
                      await saveCloudflareSingle();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
            {provider !== "custom" &&
            connectCredentialKind === "apiKey" &&
            provider !== "azure" &&
            provider !== "cloudflare-ai-gateway" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || previewBusy || !connectApiKey.trim()}
                onClick={() => {
                  void (async () => {
                    try {
                      await syncCatalogFromUpstream(false);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {busy || previewBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("settings.connectProvider")}
              </Button>
            ) : null}
          </DialogFooterActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
