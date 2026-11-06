import {
  isProcessAlive,
  listInstances,
} from "../../../packages/server/dist/src/instance-registry.js";

const STOP_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 50;

/** Stop every daemon registered for this data directory and wait for clean unregistration. */
export async function stopRegisteredDaemons(dataDir) {
  const instances = await listInstances(dataDir);
  for (const instance of instances) {
    if (isProcessAlive(instance.pid)) {
      process.kill(instance.pid, "SIGTERM");
    }
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await listInstances(dataDir)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  throw new Error(`Timed out waiting for daemon shutdown: ${dataDir}`);
}
