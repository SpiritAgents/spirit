import path from "node:path";
import { product } from "@spiritagent/product";
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
  type DesktopWebHostConfigFile,
} from "../src/host/storage.js";
import { setDesktopWebHostRuntimeStatus } from "../src/host/web-host-state.js";
import {
  createDesktopHttpHost,
  createDesktopWebPairingCode,
  resolveDesktopWebHostFromEnv,
} from "./http-host.js";
import { resolveRendererDistPath } from "./renderer-dist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

setSpiritDataDirOverride(resolveConfiguredSpiritDataDir());

const { host, port } = resolveDesktopWebHostFromEnv();
let webHostConfig: DesktopWebHostConfigFile = (await loadConfig()).webHost;
let pairingCode = webHostConfig.authTokenHash ? "" : createDesktopWebPairingCode();
const webHost = createDesktopHttpHost({
  host,
  port,
  invokeHostCommand: invokeDesktopHostCommand,
  subscribeHostUpdates: subscribeDesktopDreamUpdates,
  auth: {
    getTokenHash: () => webHostConfig.authTokenHash,
    getPairingCode: () => pairingCode,
    // Pairing failure limit reached: void the pairing code; the web-host process must be
    // restarted to generate a new one.
    onPairingLockout: () => {
      console.warn(
        `${product.name} desktop web pairing locked after too many failures; restart web host to get a new code.`,
      );
      pairingCode = "";
    },
    completePairing: async (authTokenHash) => {
      await invokeDesktopHostCommand("setWebHostAuthTokenHash", { authTokenHash });
      webHostConfig = (await loadConfig()).webHost;
      pairingCode = "";
      const current = webHost.getState();
      setDesktopWebHostRuntimeStatus({
        state: current.running ? "running" : "stopped",
        host,
        port,
        ...(current.url ? { url: current.url } : {}),
      });
    },
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
  ...(webHostConfig.authTokenHash ? {} : { pairingCode }),
});

if (!webHostConfig.authTokenHash) {
  console.warn(`${product.name} desktop web pairing code: ${pairingCode}`);
}

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
