/**
 * `extension-toolkit init`: delegate to @spiritagent/create-extension at
 * runtime. The specifier goes through a variable so TypeScript never resolves
 * the module at compile time, and the module shape is asserted locally — the
 * toolkit builds without create-extension's dist, keeping the build graph
 * one-directional (create-extension builds after the toolkit).
 */

export type CreateExtensionModuleLoader = () => Promise<unknown>;

// Variable specifier on purpose: compile-time module resolution must not see it.
const CREATE_EXTENSION_SPECIFIER = "@spiritagent/create-extension";

const loadCreateExtension: CreateExtensionModuleLoader = () => import(CREATE_EXTENSION_SPECIFIER);

export async function runInitCommand(
  args: string[],
  loadModule: CreateExtensionModuleLoader = loadCreateExtension,
): Promise<number> {
  const mod: unknown = await loadModule();
  const run = (mod as { runCreateExtensionCli?: unknown }).runCreateExtensionCli;
  if (typeof run !== "function") {
    process.stderr.write(
      "error: @spiritagent/create-extension does not export runCreateExtensionCli.\n",
    );
    return 1;
  }
  return (run as (args: string[]) => Promise<number>)(args);
}
