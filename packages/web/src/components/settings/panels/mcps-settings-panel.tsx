import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { product } from "@spiritagent/product";
import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";

import { SettingsListItemHeading } from "@/components/settings/settings-list-item-heading";
import type { SettingsViewProps } from "@/components/settings/types";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput, DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { formatMcpCapabilityCounts } from "@/lib/mcp-capability-counts";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import { DESKTOP_EDITOR_TAB_CLASS, DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import type { DeleteMcpServerRequest, DesktopMcpScope, DesktopMcpTransportType } from "@/types";

function mcpTransportTypeLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "HTTP" : "Stdio";
}

function mcpMetadataLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "Headers" : i18n.t("settings.envVars");
}

function mcpEndpointLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "URL" : i18n.t("settings.command");
}

function mcpEndpointPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http" ? i18n.t("settings.mcpUrlExample") : i18n.t("settings.mcpCommandExample");
}

function mcpMetadataPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http"
    ? "Authorization: Bearer ${env:GITHUB_TOKEN}; X-Client: spirit"
    : "PATH=C:/Tools; NODE_ENV=production";
}

type McpServerRuntimeState = "connecting" | "connected" | "failed";

type McpServerRuntimeInfo = {
  state: McpServerRuntimeState;
  counts?: {
    tools: number;
    resources: number;
    prompts: number;
  };
  errorMessage?: string;
};

function mcpCountsSummary(runtime?: McpServerRuntimeInfo): string | null {
  if (runtime?.state !== "connected") {
    return null;
  }
  return formatMcpCapabilityCounts(
    runtime.counts ?? {
      tools: 0,
      resources: 0,
      prompts: 0,
    },
  );
}

const mcpCreateScopeOptions: Array<{
  scope: DesktopMcpScope;
  labelKey: string;
  hintKey: string;
}> = [
  { scope: "user", labelKey: "settings.skillUserDirShort", hintKey: "settings.mcpUserDirHint" },
  {
    scope: "workspace",
    labelKey: "settings.mcpScopeWorkspace",
    hintKey: "settings.mcpWorkspaceSpiritHint",
  },
];

export function McpsSettingsPanel({
  snapshot,
  mcpsBusy,
  onAddMcpServer,
  onDeleteMcpServer,
  onInspectMcpServer,
}: Pick<
  SettingsViewProps,
  "snapshot" | "mcpsBusy" | "onAddMcpServer" | "onDeleteMcpServer" | "onInspectMcpServer"
>) {
  const { t } = useTranslation();
  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteMcpServerRequest | null>(null);
  const [createScope, setCreateScope] = useState<DesktopMcpScope>(
    workspaceBindingDisabled ? "user" : "workspace",
  );
  const [transportType, setTransportType] = useState<DesktopMcpTransportType>("stdio");
  const [newName, setNewName] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newMetadata, setNewMetadata] = useState("");
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, McpServerRuntimeInfo>>({});
  const runtimeInfoRef = useRef(runtimeInfo);
  runtimeInfoRef.current = runtimeInfo;

  const items = snapshot?.mcpServers ?? [];
  const itemsSig = useMemo(
    () => items.map((item) => `${item.scope}:${item.name}:${item.enabled}`).join("|"),
    [items],
  );
  const availableMcpCreateScopeOptions = workspaceBindingDisabled
    ? mcpCreateScopeOptions.filter((option) => option.scope === "user")
    : mcpCreateScopeOptions;
  const localizedMcpCreateScopeOptions = availableMcpCreateScopeOptions.map((option) => ({
    ...option,
    label: t(option.labelKey),
    hint: t(option.hintKey),
  }));

  useEffect(() => {
    let cancelled = false;

    const keysToInspect: string[] = [];
    for (const item of items) {
      if (!item.enabled) {
        continue;
      }
      const key = `${item.scope}:${item.name}`;
      const existing = runtimeInfoRef.current[key];
      if (existing?.state !== "connected" && existing?.state !== "failed") {
        keysToInspect.push(key);
      }
    }

    setRuntimeInfo((current) => {
      const next: Record<string, McpServerRuntimeInfo> = {};
      for (const item of items) {
        if (!item.enabled) {
          continue;
        }
        const key = `${item.scope}:${item.name}`;
        const existing = current[key];
        if (existing?.state === "connected" || existing?.state === "failed") {
          next[key] = existing;
          continue;
        }
        next[key] = { state: "connecting" };
      }
      return next;
    });

    void Promise.all(
      items.map(async (item) => {
        if (!item.enabled) {
          return;
        }
        const key = `${item.scope}:${item.name}`;
        if (!keysToInspect.includes(key)) {
          return;
        }

        try {
          const inspection = await onInspectMcpServer(item.name);
          if (cancelled) {
            return;
          }
          setRuntimeInfo((current) => ({
            ...current,
            [key]: {
              state: "connected",
              counts: {
                tools: inspection.toolsCount,
                resources: inspection.resourcesCount,
                prompts: inspection.promptsCount,
              },
            },
          }));
        } catch (error) {
          if (cancelled) {
            return;
          }
          const errorMessage =
            error instanceof Error && error.message.trim() ? error.message.trim() : undefined;
          setRuntimeInfo((current) => ({
            ...current,
            [key]: {
              state: "failed",
              ...(errorMessage ? { errorMessage } : {}),
            },
          }));
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [itemsSig, onInspectMcpServer]);

  const resetForm = () => {
    setCreateScope(workspaceBindingDisabled ? "user" : "workspace");
    setTransportType("stdio");
    setNewName("");
    setNewEndpoint("");
    setNewMetadata("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("settings.mcps")}</h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t("app.noWorkspaceBindingHint")}</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => {
            resetForm();
            setAddDialogOpen(true);
          }}
          disabled={mcpsBusy}
        >
          {t("settings.addMcp")}
        </Button>
      </div>

      <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35")}>
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("settings.noMcpsConfigured")}
          </p>
        ) : (
          items.map((item) => {
            const runtimeKey = `${item.scope}:${item.name}`;
            const runtime = runtimeInfo[runtimeKey];
            const countsSummary = mcpCountsSummary(runtime);
            const failureMessage =
              runtime?.state === "failed"
                ? runtime.errorMessage?.trim() || t("settings.mcpConnectionFailed")
                : null;
            return (
              <div
                key={runtimeKey}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div
                  className={cn(
                    "min-w-0 flex-1 space-y-1.5",
                    (!item.enabled || runtime?.state === "failed") && "opacity-50",
                  )}
                >
                  <SettingsListItemHeading
                    title={formatTitleFromId(item.name, {
                      casingOverrides: WELL_KNOWN_CASING_OVERRIDES,
                    })}
                    path={
                      item.scope === "user"
                        ? "mcp.json"
                        : `${product.workspaceDataFolderName}/mcp.json`
                    }
                    leading={
                      runtime?.state === "connecting" ? (
                        <Spinner
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-label={t("settings.mcpConnecting")}
                        />
                      ) : undefined
                    }
                  />
                  {countsSummary ? (
                    <p className="text-xs text-muted-foreground">{countsSummary}</p>
                  ) : null}
                  {failureMessage ? (
                    <p className="text-xs text-muted-foreground">{failureMessage}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 self-start sm:self-center"
                  disabled={mcpsBusy}
                  onClick={() => setDeleteTarget({ name: item.name, scope: item.scope })}
                >
                  {t("common.delete")}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title={t("settings.deleteMcpConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("settings.deleteMcpConfirmDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={mcpsBusy}
        onConfirm={async () => {
          const target = deleteTarget;
          if (!target) {
            return;
          }
          try {
            await onDeleteMcpServer(target);
            setDeleteTarget(null);
          } catch {
            /* runtimeError */
          }
        }}
      />

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.addMcp")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t("settings.saveLocation")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.saveLocation")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedMcpCreateScopeOptions.map((opt) => (
                  <button
                    key={opt.scope}
                    type="button"
                    role="tab"
                    aria-selected={createScope === opt.scope}
                    className={cn(
                      DESKTOP_EDITOR_TAB_CLASS,
                      createScope === opt.scope
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-chrome-emphasis",
                    )}
                    disabled={mcpsBusy}
                    title={opt.hint}
                    onClick={() => setCreateScope(opt.scope)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedMcpCreateScopeOptions.find((o) => o.scope === createScope)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.transportType")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.transportType")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {(["stdio", "http"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={transportType === value}
                    className={cn(
                      DESKTOP_EDITOR_TAB_CLASS,
                      transportType === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-chrome-emphasis",
                    )}
                    disabled={mcpsBusy}
                    onClick={() => setTransportType(value)}
                  >
                    {mcpTransportTypeLabel(value)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-name">{t("settings.name")}</Label>
              <DesktopFormInput
                id="new-mcp-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={t("settings.mcpNamePlaceholder")}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-endpoint">{mcpEndpointLabel(transportType)}</Label>
              <DesktopFormInput
                id="new-mcp-endpoint"
                value={newEndpoint}
                onChange={(event) => setNewEndpoint(event.target.value)}
                placeholder={mcpEndpointPlaceholder(transportType)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-metadata">{mcpMetadataLabel(transportType)}</Label>
              <DesktopFormTextarea
                id="new-mcp-metadata"
                value={newMetadata}
                onChange={(event) => setNewMetadata(event.target.value)}
                placeholder={mcpMetadataPlaceholder(transportType)}
                className="min-h-24"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddDialogOpen(false)}
                disabled={mcpsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={mcpsBusy || !newName.trim() || !newEndpoint.trim()}
                onClick={() => {
                  void (async () => {
                    try {
                      await onAddMcpServer({
                        name: newName,
                        scope: createScope,
                        transportType,
                        endpoint: newEndpoint,
                        metadata: newMetadata,
                      });
                      setAddDialogOpen(false);
                      resetForm();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {mcpsBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("common.create")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
