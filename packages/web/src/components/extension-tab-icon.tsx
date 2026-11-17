import { getSpiritIconComponent } from "@spiritagent/icons";
import { Globe } from "@spiritagent/icons/globe";

import { extensionTabPackagedIconUrl } from "@/lib/extension-tab-frame";
import { cn } from "@/lib/utils";
import type { DesktopExtensionDesktopTabRuntimeIcon } from "@/types";

export function ExtensionTabIcon({
  extensionId,
  icon,
  className,
}: {
  extensionId: string;
  icon: DesktopExtensionDesktopTabRuntimeIcon;
  className?: string;
}) {
  if (icon.type !== "spirit" && icon.monochrome) {
    const url =
      icon.type === "file" ? extensionTabPackagedIconUrl(extensionId, icon.path) : icon.dataUrl;
    return (
      <span
        aria-hidden
        className={cn("inline-block shrink-0", className)}
        style={{
          backgroundColor: "currentColor",
          maskImage: `url(${JSON.stringify(url)})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
        }}
      />
    );
  }
  if (icon.type === "file") {
    return (
      <img
        aria-hidden
        src={extensionTabPackagedIconUrl(extensionId, icon.path)}
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }
  if (icon.type === "image") {
    return (
      <img aria-hidden src={icon.dataUrl} className={cn("shrink-0 object-contain", className)} />
    );
  }
  const Icon = getSpiritIconComponent(icon.name) ?? Globe;
  return <Icon className={cn("shrink-0", className)} aria-hidden strokeWidth={1.75} />;
}
