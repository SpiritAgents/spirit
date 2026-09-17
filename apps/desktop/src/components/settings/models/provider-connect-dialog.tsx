import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, RefreshCw } from "lucide-react";

import {
  connectTransportOptionSummary,
  connectTransportOptionsForProvider,
  defaultConnectTransportKind,
  providerShowsConnectTransportPicker,
  resolveConnectTransportKindForProvider,
  resolveCustomConnectApiBase,
} from "@/components/settings/models/connect-transport";
import { ModelCapabilitiesCombobox } from "@/components/settings/models/model-capabilities-combobox";
import {
  defaultCustomModelCapabilities,
  normalizeModelCapabilitySelection,
} from "@/components/settings/models/model-defaults";
import { providerPickerLabel } from "@/components/settings/models/provider-picker-rows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  defaultProviderConnectSite,
  listProviderConnectSiteOptions,
  providerConnectSiteRequiresWorkspaceId,
  providerSupportsSiteSelection,
  resolveProviderConnectApiBase,
} from "@spiritagent/host-internal/model-provider-presets";
import { DESKTOP_FORM_FIELD_TRIGGER_INNER, DESKTOP_FORM_INPUT_SHELL } from "@/lib/desktop-chrome";
import { DESKTOP_EDITOR_TAB_CLASS } from "@/lib/desktop-typography";
import { parseModelContextLength } from "@/lib/model-context-length";
import { cn } from "@/lib/utils";
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopTransportKind,
  PreviewModelsRequest,
  PreviewModelsResponse,
} from "@/types";
import { bedrockApiBaseFromRegion } from "@spiritagent/host-internal/bedrock-region";
import {
  defaultPresetProviderGroupId,
  slugifyProviderGroupLabel,
} from "@spiritagent/host-internal/config-v2";
import {
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
} from "@spiritagent/host-internal/bedrock-mantle";
import {
  azureApiBaseFromResourceName,
  isValidAzureResourceName,
} from "@spiritagent/host-internal/azure-resource";
import {
  cloudflareAiGatewayApiBaseFromAccountId,
  isValidCloudflareAccountId,
  isValidCloudflareGatewayId,
} from "@spiritagent/host-internal/cloudflare-ai-gateway-resource";
import { vertexApiBaseFromProjectAndLocation } from "@spiritagent/host-internal/google-vertex-endpoints";

export type ProviderConnectDialogProps = {
  /** Provider to connect; the parent remounts this component with a new key on each connection attempt to reset the form. */
  provider: DesktopModelProvider;
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
  const [connectProviderSite, setConnectProviderSite] = useState(
    () => defaultProviderConnectSite(provider) ?? "",
  );
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

  function resolveConnectGroupId(target: DesktopModelProvider): string {
    if (target === "custom") {
      const label = connectCustomGroupLabel.trim();
      return label ? slugifyProviderGroupLabel(label) : defaultPresetProviderGroupId("custom");
    }
    return defaultPresetProviderGroupId(target);
  }

  const selectedProviderLabel = providerPickerLabel(
    (key, options) => String(t(key, options)),
    provider,
  );

  const connectTransportKindForRequest = resolveConnectTransportKindForProvider(
    provider,
    connectTransportKind,
  );

  const connectAlibabaIsTokenPlan =
    provider === "alibaba" && connectAlibabaBillingMode === "token-plan";
  const connectAlibabaBillingModeForRequest = connectAlibabaIsTokenPlan
    ? ("token-plan" as const)
    : undefined;
  const connectStepfunIsStepPlan =
    provider === "stepfun" && connectStepfunBillingMode === "step-plan";
  const connectStepfunBillingModeForRequest = connectStepfunIsStepPlan
    ? ("step-plan" as const)
    : undefined;
  const connectGlmCodingPlanIsActive =
    (provider === "z-ai" || provider === "zhipu-ai") &&
    connectGlmCodingPlanBillingMode === "glm-coding-plan";
  const connectZAiBillingModeForRequest =
    provider === "z-ai" && connectGlmCodingPlanIsActive ? ("glm-coding-plan" as const) : undefined;
  const connectZhipuBillingModeForRequest =
    provider === "zhipu-ai" && connectGlmCodingPlanIsActive
      ? ("glm-coding-plan" as const)
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
    providerConnectSiteRequiresWorkspaceId("alibaba", connectProviderSiteForRequest);
  const connectProviderSiteForApiBase =
    connectProviderSiteForRequest &&
    providerConnectSiteRequiresWorkspaceId(provider, connectProviderSiteForRequest) &&
    !connectAlibabaWorkspaceIdForRequest
      ? undefined
      : connectProviderSiteForRequest;

  const effectiveApiBase =
    provider === "amazon-bedrock"
      ? bedrockApiBaseFromRegion(connectAwsRegion)
      : provider === "azure"
        ? azureApiBaseFromResourceName(connectAzureResourceName)
        : provider === "cloudflare-ai-gateway"
          ? cloudflareAiGatewayApiBaseFromAccountId(connectCloudflareAccountId)
          : provider === "google-vertex-ai" && vertexConnectMode !== "express"
            ? vertexApiBaseFromProjectAndLocation(connectVertexProject, connectVertexLocation)
            : provider === "custom"
              ? resolveCustomConnectApiBase(connectApiBase)
              : resolveProviderConnectApiBase(
                  provider,
                  connectTransportKindForRequest ?? defaultConnectTransportKind(provider),
                  {
                    ...(connectAlibabaBillingModeForRequest
                      ? { billingMode: connectAlibabaBillingModeForRequest }
                      : {}),
                    ...(connectStepfunBillingModeForRequest
                      ? { stepfunBillingMode: connectStepfunBillingModeForRequest }
                      : {}),
                    ...(connectZAiBillingModeForRequest
                      ? { zAiBillingMode: connectZAiBillingModeForRequest }
                      : {}),
                    ...(connectZhipuBillingModeForRequest
                      ? { zhipuBillingMode: connectZhipuBillingModeForRequest }
                      : {}),
                    ...(connectProviderSiteForApiBase
                      ? { site: connectProviderSiteForApiBase }
                      : {}),
                    ...(connectAlibabaWorkspaceIdForRequest
                      ? { workspaceId: connectAlibabaWorkspaceIdForRequest }
                      : {}),
                  },
                );

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
    ...(connectVertexClientEmail.trim()
      ? { vertexClientEmail: connectVertexClientEmail.trim() }
      : {}),
    ...(connectVertexPrivateKey.trim() ? { vertexPrivateKey: connectVertexPrivateKey.trim() } : {}),
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
      if (vertexConnectMode === "express") {
        throw new Error(t("settings.vertexExpressCatalogUnsupported"));
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
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      provider,
      ...(provider === "amazon-bedrock"
        ? {
            awsRegion: connectAwsRegion.trim(),
            accessKeyId: connectAccessKeyId.trim(),
            secretAccessKey: connectSecretAccessKey.trim(),
          }
        : {}),
      ...(provider === "google-vertex-ai" ? vertexConnectFields : {}),
      ...(connectTransportKindForRequest !== undefined
        ? { transportKind: connectTransportKindForRequest }
        : {}),
      ...(connectProviderSiteForRequest ? { providerSite: connectProviderSiteForRequest } : {}),
      ...(connectAlibabaWorkspaceIdForRequest
        ? { alibabaWorkspaceId: connectAlibabaWorkspaceIdForRequest }
        : {}),
      ...(connectAlibabaBillingModeForRequest
        ? { alibabaBillingMode: connectAlibabaBillingModeForRequest }
        : {}),
      ...(connectStepfunBillingModeForRequest
        ? { stepfunBillingMode: connectStepfunBillingModeForRequest }
        : {}),
      ...(connectZAiBillingModeForRequest
        ? { zAiBillingMode: connectZAiBillingModeForRequest }
        : {}),
      ...(connectZhipuBillingModeForRequest
        ? { zhipuBillingMode: connectZhipuBillingModeForRequest }
        : {}),
      forceRefresh,
    });
    if (res.modelIds.length === 0) {
      throw new Error(t("settings.noModelsReturned"));
    }
    const bulk: AddProviderModelsRequest = {
      groupId: resolveConnectGroupId(provider),
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      modelIds: res.modelIds,
      ...(res.models ? { modelCatalog: res.models } : {}),
      provider,
      ...(provider === "amazon-bedrock"
        ? {
            awsRegion: connectAwsRegion.trim(),
            accessKeyId: connectAccessKeyId.trim(),
            secretAccessKey: connectSecretAccessKey.trim(),
          }
        : {}),
      ...(provider === "google-vertex-ai" ? vertexConnectFields : {}),
      ...(connectTransportKindForRequest !== undefined
        ? { transportKind: connectTransportKindForRequest }
        : {}),
      ...(connectProviderSiteForRequest ? { providerSite: connectProviderSiteForRequest } : {}),
      ...(connectAlibabaWorkspaceIdForRequest
        ? { alibabaWorkspaceId: connectAlibabaWorkspaceIdForRequest }
        : {}),
      ...(connectAlibabaBillingModeForRequest
        ? { alibabaBillingMode: connectAlibabaBillingModeForRequest }
        : {}),
      ...(connectStepfunBillingModeForRequest
        ? { stepfunBillingMode: connectStepfunBillingModeForRequest }
        : {}),
      ...(connectZAiBillingModeForRequest
        ? { zAiBillingMode: connectZAiBillingModeForRequest }
        : {}),
      ...(connectZhipuBillingModeForRequest
        ? { zhipuBillingMode: connectZhipuBillingModeForRequest }
        : {}),
      ...(provider === "custom" && connectCustomGroupLabel.trim()
        ? { customGroupLabel: connectCustomGroupLabel.trim() }
        : {}),
    };
    await onAddProviderModels(bulk);
    onOpenChange(false);
  };

  const saveCustomSingle = async () => {
    if (provider !== "custom") {
      return;
    }
    const name = connectName.trim();
    const apiBase = effectiveApiBase;
    if (!name) {
      throw new Error(t("settings.modelNameRequired"));
    }
    if (!connectApiBase.trim()) {
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
      groupId: resolveConnectGroupId("custom"),
      name,
      apiBase,
      apiKey: connectApiKey,
      provider: "custom",
      transportKind: connectTransportKind,
      capabilities: normalizeModelCapabilitySelection(connectCapabilities),
      ...(connectCustomGroupLabel.trim()
        ? { customGroupLabel: connectCustomGroupLabel.trim() }
        : {}),
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
      groupId: defaultPresetProviderGroupId("amazon-bedrock"),
      name,
      apiBase: isBedrockMantleOpenAiModel(name)
        ? bedrockMantleApiBaseFromRegion(awsRegion)
        : bedrockApiBaseFromRegion(awsRegion),
      apiKey: connectApiKey,
      provider: "amazon-bedrock",
      transportKind: "bedrock",
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
      groupId: defaultPresetProviderGroupId("azure"),
      name,
      apiBase: azureApiBaseFromResourceName(azureResourceName),
      apiKey: connectApiKey,
      provider: "azure",
      transportKind: "open-responses",
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
      groupId: defaultPresetProviderGroupId("cloudflare-ai-gateway"),
      name,
      apiBase: cloudflareAiGatewayApiBaseFromAccountId(accountId),
      apiKey: connectApiKey,
      provider: "cloudflare-ai-gateway",
      transportKind:
        connectTransportKindForRequest ?? defaultConnectTransportKind("cloudflare-ai-gateway"),
      cloudflareAccountId: accountId,
      cloudflareGatewayId: gatewayId,
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

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
      groupId: defaultPresetProviderGroupId("google-vertex-ai"),
      name,
      apiBase: "",
      apiKey: connectApiKey,
      provider: "google-vertex-ai",
      transportKind: "openai-compatible",
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {provider === "custom" ? t("settings.customConnection") : selectedProviderLabel}
          </DialogTitle>
          <DialogDescription>
            {provider === "custom"
              ? t("settings.customConnectionDescription")
              : provider === "volcengine"
                ? t("settings.volcengineConnectionDescription")
                : provider === "byteplus"
                  ? t("settings.byteplusConnectionDescription")
                  : provider === "siliconflow"
                    ? t("settings.siliconflowConnectionDescription")
                    : provider === "moonshot-ai"
                      ? t("settings.moonshotConnectionDescription")
                      : provider === "minimax"
                        ? t("settings.minimaxConnectionDescription")
                        : provider === "alibaba"
                          ? t("settings.alibabaConnectionDescription")
                          : providerShowsConnectTransportPicker(provider)
                            ? t("settings.providerConnectionDescription")
                            : t("settings.providerSimpleDescription")}
          </DialogDescription>
        </DialogHeader>

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
          {providerSupportsSiteSelection(provider) && !connectAlibabaIsTokenPlan ? (
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
                    {listProviderConnectSiteOptions(provider).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {t(option.labelKey, { defaultValue: option.fallbackLabel })}
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
          {provider === "amazon-bedrock" ? (
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
          {provider === "amazon-bedrock" ? (
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
          {provider === "amazon-bedrock" && bedrockConnectMode === "bearer" ? (
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
          {provider === "amazon-bedrock" && bedrockConnectMode === "bearer" ? (
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
          {(provider !== "amazon-bedrock" || bedrockConnectMode === "bearer") &&
          provider !== "google-vertex-ai" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-api-key">
                {provider === "amazon-bedrock"
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
              {provider === "amazon-bedrock" ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("settings.bedrockBearerHint")}
                </p>
              ) : null}
            </div>
          ) : null}
          {provider === "amazon-bedrock" && bedrockConnectMode === "iam" ? (
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
          {provider === "google-vertex-ai" ? (
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
          {provider === "google-vertex-ai" && vertexConnectMode === "express" ? (
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
          {provider === "google-vertex-ai" && vertexConnectMode !== "express" ? (
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
          {provider === "google-vertex-ai" && vertexConnectMode === "adc" ? (
            <p className="text-xs leading-5 text-muted-foreground">{t("settings.vertexAdcHint")}</p>
          ) : null}
          {provider === "google-vertex-ai" && vertexConnectMode === "express" ? (
            <>
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
            </>
          ) : null}
          {provider === "google-vertex-ai" && vertexConnectMode === "service-account" ? (
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
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addThisModel")}
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
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t("settings.addProvider")}
              </Button>
            ) : null}
            {provider === "amazon-bedrock" && bedrockConnectMode === "bearer" ? (
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
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addThisModel")}
              </Button>
            ) : null}
            {provider === "amazon-bedrock" && bedrockConnectMode === "iam" ? (
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
                {busy || previewBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addProvider")}
              </Button>
            ) : null}
            {provider === "google-vertex-ai" && vertexConnectMode === "express" ? (
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
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addThisModel")}
              </Button>
            ) : null}
            {provider === "google-vertex-ai" && vertexConnectMode !== "express" ? (
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  previewBusy ||
                  !connectVertexProject.trim() ||
                  !connectVertexLocation.trim() ||
                  (vertexConnectMode === "service-account" && !hasVertexCatalogCredentials)
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
                {busy || previewBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addProvider")}
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
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addThisModel")}
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
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addThisModel")}
              </Button>
            ) : null}
            {provider !== "custom" &&
            provider !== "amazon-bedrock" &&
            provider !== "azure" &&
            provider !== "google-vertex-ai" &&
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
                {busy || previewBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.addProvider")}
              </Button>
            ) : null}
          </DialogFooterActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
