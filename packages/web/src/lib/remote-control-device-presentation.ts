import { joinWithCjkSpacing } from "@/lib/cjk";
import { inferRemoteControlDevicePresentation } from "@spiritagent/remote-control/presentation";
import type { RemoteControlDeviceSnapshot } from "@spiritagent/remote-control";

export function formatRemoteControlDeviceName(
  device: Pick<RemoteControlDeviceSnapshot, "name" | "lastUserAgent" | "customName">,
  locale: string,
): string {
  if (device.customName) return device.name;
  const presentation = inferRemoteControlDevicePresentation(device.lastUserAgent);
  const platform = presentation.mobile ?? presentation.system;
  if (platform && presentation.browser) {
    return locale.toLowerCase().startsWith("zh")
      ? joinWithCjkSpacing(platform, "上的", presentation.browser)
      : `${presentation.browser} on ${platform}`;
  }
  return platform ?? presentation.browser ?? device.name;
}
