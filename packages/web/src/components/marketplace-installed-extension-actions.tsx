import { Ellipsis } from "@spiritagent/icons/ellipsis";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DesktopExtensionAuthorization, DesktopMarketplaceCatalogEntry } from "@/types";

type MarketplaceInstalledExtensionActionsProps = {
  item: DesktopMarketplaceCatalogEntry;
  authorizationVariant: "default" | "outline";
  disabled?: boolean;
  onToggleEnabled: () => void;
  onRequestUninstall: () => void;
  onAuthorize?: (
    item: DesktopMarketplaceCatalogEntry,
    authorization: DesktopExtensionAuthorization,
  ) => void;
};

/** Installed-extension actions shared by Marketplace rows and the detail header. */
export function MarketplaceInstalledExtensionActions({
  item,
  authorizationVariant,
  disabled,
  onToggleEnabled,
  onRequestUninstall,
  onAuthorize,
}: MarketplaceInstalledExtensionActionsProps) {
  const { t } = useTranslation();
  const authorizations = onAuthorize ? (item.authorizations ?? []) : [];
  const pendingAuthorizations = authorizations.filter(
    (authorization) => authorization.configured !== true,
  );
  const configuredAuthorizations = authorizations.filter(
    (authorization) => authorization.configured === true,
  );

  return (
    <>
      {pendingAuthorizations.map((authorization) => (
        <Button
          key={authorization.id}
          type="button"
          variant={authorizationVariant}
          disabled={disabled || item.enabled === false}
          className="shrink-0 self-center"
          data-authorization-configured={authorization.configured}
          onClick={() => onAuthorize?.(item, authorization)}
        >
          <ShieldCheck className="size-4" aria-hidden strokeWidth={1.75} />
          {t("marketplace.authorize")}
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 self-center"
            title={t("marketplace.moreActions")}
          >
            <Ellipsis className="size-4" aria-hidden strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40 p-0">
          <div className="p-1">
            {configuredAuthorizations.map((authorization) => {
              const authorizationName = formatTitleFromId(authorization.id, {
                casingOverrides: WELL_KNOWN_CASING_OVERRIDES,
              });
              return (
                <DropdownMenuItem
                  key={authorization.id}
                  className="gap-2"
                  disabled={disabled || item.enabled === false}
                  onSelect={() => onAuthorize?.(item, authorization)}
                >
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
                  <span>
                    {configuredAuthorizations.length === 1
                      ? t("marketplace.authorizationOptions")
                      : t("marketplace.authorizationOptionsFor", {
                          name: authorizationName,
                        })}
                  </span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem className="gap-2" onSelect={onToggleEnabled}>
              <span>{item.enabled ? t("marketplace.disable") : t("marketplace.enable")}</span>
            </DropdownMenuItem>
          </div>
          <DropdownMenuSeparator />
          <div className="p-1">
            <DropdownMenuItem variant="destructive" className="gap-2" onSelect={onRequestUninstall}>
              <Trash2 className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
              <span>{t("marketplace.uninstall")}</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
