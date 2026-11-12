import { DesktopHostService } from "./host/service.js";

export * from "./host/service.js";

export function createWorkbenchHost(): DesktopHostService {
  return new DesktopHostService();
}
