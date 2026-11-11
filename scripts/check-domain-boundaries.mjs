import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

const root = process.cwd();
const retiredDirectory = ["host", "internal"].join("-");
const retiredPackage = `@spiritagent/${retiredDirectory}`;
const packages = new Map();
const errors = [];

for (const directory of fs.readdirSync(path.join(root, "packages"))) {
  const manifestPath = path.join(root, "packages", directory, "package.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  packages.set(manifest.name, {
    directory,
    dependencies: new Set(
      Object.keys(manifest.dependencies ?? {}).concat(Object.keys(manifest.devDependencies ?? {})),
    ),
  });
}

for (const { dependencies } of packages.values()) {
  for (const dependency of dependencies) {
    if (!packages.has(dependency)) dependencies.delete(dependency);
  }
}

for (const [name, { dependencies }] of packages) {
  for (const dependency of dependencies) {
    if (dependency === retiredPackage) {
      errors.push(`${name} still depends on the retired host package`);
    }
    if (
      name === "@spiritagent/server" &&
      ["@spiritagent/workbench", "@spiritagent/http", "@spiritagent/web"].includes(dependency)
    ) {
      errors.push(`${name} must not depend on ${dependency}`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
function visit(name, trail) {
  if (visiting.has(name)) {
    const cycle = [...trail.slice(trail.indexOf(name)), name].join(" -> ");
    if (
      !cycle.includes("@spiritagent/create-extension") ||
      !cycle.includes("@spiritagent/extension-toolkit")
    ) {
      errors.push(`dependency cycle: ${cycle}`);
    }
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dependency of packages.get(name)?.dependencies ?? []) {
    if (packages.has(dependency)) visit(dependency, [...trail, dependency]);
  }
  visiting.delete(name);
  visited.add(name);
}

for (const name of packages.keys()) visit(name, [name]);

const nodeDomains = new Set([
  "api",
  "automations",
  "code-completion",
  "config",
  "extensions",
  "github",
  "hooks",
  "http",
  "instructions",
  "lsp",
  "mcp",
  "permissions",
  "process",
  "remote-control",
  "server",
  "sessions",
  "tasks",
  "tools",
  "workbench",
  "workspace",
]);
const reactPresentationPaths = [
  /^packages\/extensions\/src\/extension-ui-kit\//u,
  /^packages\/sessions\/src\/lib\//u,
];
const nodeBuiltins = new Set(builtinModules);

function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(target));
    if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.d\.[cm]?ts$/u.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

function importsOf(source) {
  const imports = [];
  const patterns = [
    /^\s*(import|export)\s+(type\s+)?(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gmu,
    /\bimport\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({ specifier: match.at(-1), typeOnly: match[2] === "type " });
    }
  }
  return imports;
}

for (const [name, { directory }] of packages) {
  const domain = directory;
  for (const file of sourceFiles(path.join(root, "packages", directory, "src"))) {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const source = fs.readFileSync(file, "utf8");
    for (const { specifier, typeOnly } of importsOf(source)) {
      if (specifier === retiredPackage || specifier.startsWith(`${retiredPackage}/`)) {
        errors.push(`${relative}: import from the retired host package`);
      }
      const internalDependency = specifier.startsWith("@spiritagent/")
        ? specifier.split("/").slice(0, 2).join("/")
        : undefined;
      if (
        internalDependency &&
        internalDependency !== name &&
        packages.has(internalDependency) &&
        !packages.get(name)?.dependencies.has(internalDependency)
      ) {
        errors.push(`${relative}: ${internalDependency} is not declared in ${name}'s manifest`);
      }
      if (
        !/\.test\.[cm]?[jt]sx?$/u.test(file) &&
        (specifier === name || specifier.startsWith(`${name}/`))
      ) {
        errors.push(`${relative}: package self-import ${specifier}; use a direct module path`);
      }
      if (
        name === "@spiritagent/server" &&
        ["@spiritagent/workbench", "@spiritagent/http", "@spiritagent/web"].some(
          (dependency) => specifier === dependency || specifier.startsWith(`${dependency}/`),
        )
      ) {
        errors.push(`${relative}: server must not import ${specifier}`);
      }
      if (!nodeDomains.has(domain) || typeOnly) continue;
      if (specifier === "electron" || specifier.startsWith("electron/")) {
        errors.push(`${relative}: Node domain must not import Electron`);
      }
      if (
        (specifier === "react" || specifier.startsWith("react/") || specifier === "react-dom" || specifier.startsWith("react-dom/")) &&
        !reactPresentationPaths.some((pattern) => pattern.test(relative))
      ) {
        errors.push(`${relative}: React is limited to declared browser presentation entry points`);
      }
      if (domain === "api") {
        const builtin = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
        if (nodeBuiltins.has(builtin)) {
          errors.push(`${relative}: runtime-neutral API contracts must not import ${specifier}`);
        }
      }
    }
  }
}

try {
  const matches = execFileSync("git", ["grep", "-n", retiredDirectory, "--", ":!pnpm-lock.yaml"], {
    cwd: root,
    encoding: "utf8",
  });
  errors.push(`retired host package references remain:\n${matches.trim()}`);
} catch (error) {
  if (error.status !== 1) throw error;
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`domain dependency graph passed (${packages.size} packages)`);
