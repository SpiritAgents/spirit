import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  invokeDesktopHostCommand,
  shutdownDesktopHostService,
  subscribeDesktopDreamUpdates,
} from "../src/host/service.js";
import {
  loadConfig,
  resolveConfiguredSpiritDataDir,
  setSpiritDataDirOverride,
} from "../src/host/storage.js";
import { setDesktopWebHostRuntimeStatus } from "../src/host/web-host-state.js";
import { createDesktopHttpHost, resolveDesktopWebHostFromEnv } from "./http-host.js";
import { resolveRendererDistPath } from "./renderer-dist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

setSpiritDataDirOverride(resolveConfiguredSpiritDataDir());

const { host, port } = resolveDesktopWebHostFromEnv();
const webHost = createDesktopHttpHost({
  host,
  port,
  invokeHostCommand: invokeDesktopHostCommand,
  subscribeHostUpdates: subscribeDesktopDreamUpdates,
  auth: {
    getDevices: async () => (await loadConfig()).webHost.devices,
  },
  static: {
    root: resolveRendererDistPath(__dirname),
    spaFallback: true,
  },
});

const state = await webHost.start();
setDesktopWebHostRuntimeStatus({
  state: "running",
  host: state.host,
  port: state.port,
  ...(state.url ? { url: state.url } : {}),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void Promise.all([webHost.stop(), shutdownDesktopHostService()]).finally(() => {
      setDesktopWebHostRuntimeStatus({
        state: "stopped",
        host,
        port,
      });
      process.exit(0);
    });
  });
}
