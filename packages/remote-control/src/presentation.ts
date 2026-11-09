export type RemoteControlClientKind = "browser" | "unknown";

export function inferRemoteControlClientKind(userAgent?: string): RemoteControlClientKind {
  return userAgent?.trim() ? "browser" : "unknown";
}

export interface RemoteControlDevicePresentation {
  mobile?: "iPhone" | "iPad" | "Android";
  system?: "Mac" | "Windows" | "Linux";
  browser?: "Edge" | "Chrome" | "Safari" | "Firefox";
}

export function inferRemoteControlDevicePresentation(
  userAgent?: string,
): RemoteControlDevicePresentation {
  const ua = userAgent ?? "";
  const presentation: RemoteControlDevicePresentation = {};
  if (/iPhone/i.test(ua)) presentation.mobile = "iPhone";
  else if (/iPad/i.test(ua)) presentation.mobile = "iPad";
  else if (/Android/i.test(ua)) presentation.mobile = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) presentation.system = "Mac";
  else if (/Windows/i.test(ua)) presentation.system = "Windows";
  else if (/Linux/i.test(ua)) presentation.system = "Linux";

  if (/Edg\//i.test(ua)) presentation.browser = "Edge";
  else if (/Firefox\//i.test(ua)) presentation.browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium|OPR\//i.test(ua)) presentation.browser = "Chrome";
  else if (/Version\//i.test(ua) && /Safari\//i.test(ua)) presentation.browser = "Safari";
  return presentation;
}
