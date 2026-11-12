import type { HostApi } from "@spiritagent/api/host-api";
import { createElectronHostApi } from "./adapters/electron";
import { createWebHostApi } from "./adapters/web";

export type { HostApi } from "@spiritagent/api/host-api";

export async function createHostApi(): Promise<HostApi> {
  if (typeof window !== "undefined" && window.spiritDesktop) {
    return createElectronHostApi();
  }

  return createWebHostApi();
}
