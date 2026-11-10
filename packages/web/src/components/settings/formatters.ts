export function formatSettingsTime(unixMs?: number): string {
  if (typeof unixMs !== "number") {
    return "—";
  }
  return new Date(unixMs).toLocaleString("zh-CN", { hour12: false });
}
