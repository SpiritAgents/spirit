import { saveProviderSetup } from "@spiritagent/host-internal";
import { product } from "@spiritagent/product";
import { resolveSpiritDataDir } from "../config.js";
import { runProviderWizard } from "./run-interactive-setup.js";

/**
 * Terminal Auth setup entry (`--setup`).
 * Writes provider credentials to the shared Spirit keyring and config.json.
 */
export async function runSetup(): Promise<void> {
  console.error(`${product.name} — provider setup\n`);
  try {
    const setup = await runProviderWizard();
    await saveProviderSetup(resolveSpiritDataDir(), setup);
    console.error(
      `\nSetup complete. Active model: ${setup.activeModel?.name ?? setup.models?.[0]?.name ?? ""}`,
    );
    console.error("Return to your ACP client to authenticate and create a session.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "Setup cancelled.") {
      console.error(`Setup failed: ${message}`);
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}
