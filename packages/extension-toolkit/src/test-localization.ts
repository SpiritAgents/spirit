export function localizedTestFields(displayName = "Demo", description = "Demo extension.") {
  return {
    defaultLocale: "en",
    messages: {
      en: {
        metadata: { displayName, description, keyword: "demo" },
        skills: {
          demo: { displayName: "Demo Skill", summary: "Demo skill summary." },
          "demo-skill": { displayName: "Demo Skill", summary: "Demo skill summary." },
        },
        mcp: {
          demo: { displayName: "Demo MCP" },
          example: { displayName: "Example MCP" },
        },
        hooks: { sessionStart: { displayName: "Session Start" } },
        rules: { displayName: "Demo Rules", summary: "Demo rules summary." },
        tools: { hello: { displayName: "Hello", summary: "Say hello." } },
        desktop: {
          settingsPage: { title: displayName },
          views: {
            main: { title: "View" },
            enable: { title: "Enable" },
            fixture: { title: "Fixture" },
            authorize: { title: "Authorize" },
          },
          tabs: {
            main: { name: displayName },
            notes: { name: "Notes" },
            preview: { name: "Preview" },
            browser: { name: "Browser" },
          },
        },
        authorization: { oauth: { displayName: "OAuth" } },
        automation: {
          activity: { name: displayName, description: `React to activity from ${displayName}.` },
        },
        settings: {
          prOverviewRatio: { title: "Pull Request Overview Ratio" },
          prFilesWidth: { title: "Changed Files Width" },
        },
      },
    },
    displayName: { message: "metadata.displayName" },
    description: { message: "metadata.description" },
    keywords: [{ message: "metadata.keyword" }],
  };
}

export function localizedTestPackage(
  displayName: string,
  description: string,
  manifest: Record<string, unknown>,
) {
  const fields = localizedTestFields(displayName, description);
  const generated = localizeManifest(manifest);
  return {
    ...fields,
    messages: {
      en: mergeCatalogs(fields.messages.en, generated.messages),
    },
    manifest: generated.manifest,
  };
}

function localizeManifest(manifest: Record<string, unknown>) {
  const messages: Record<string, unknown> = {};
  const visit = (value: unknown, path: string[]): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry, index) => visit(entry, [...path, String(index)]));
    }
    if (typeof value !== "object" || value === null) return value;
    if ("message" in value && Object.keys(value).length === 1) return value;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "nameKey") continue;
      const nextPath = [...path, key];
      if (typeof entry === "string" && isLocalizedPath(nextPath)) {
        const message = ["generated", ...nextPath].join(".");
        setMessage(messages, ["generated", ...nextPath], entry);
        result[key] = { message };
      } else {
        result[key] = visit(entry, nextPath);
      }
    }
    if (path.length === 3 && path[0] === "contributes" && path[1] === "tools") {
      const name = typeof result.name === "string" ? result.name : "Tool";
      const description = typeof result.description === "string" ? result.description : name;
      result.presentation ??= {
        displayName: { message: `generated.${path.join(".")}.presentation.displayName` },
        summary: { message: `generated.${path.join(".")}.presentation.summary` },
      };
      setMessage(messages, ["generated", ...path, "presentation", "displayName"], name);
      setMessage(messages, ["generated", ...path, "presentation", "summary"], description);
    }
    if (path.length === 3 && path[0] === "contributes" && path[1] === "authorizations") {
      const displayName = typeof result.id === "string" ? result.id : "Authorization";
      result.displayName ??= { message: `generated.${path.join(".")}.displayName` };
      setMessage(messages, ["generated", ...path, "displayName"], displayName);
    }
    return result;
  };
  return { manifest: visit(manifest, []), messages };
}

function isLocalizedPath(path: string[]): boolean {
  const value = path.join(".");
  return (
    /^contributes\.automationTriggers\.\d+\.(name|description)$/.test(value) ||
    /^contributes\.authorizations\.\d+\.displayName$/.test(value) ||
    /^contributes\.(mcp|hooks|skills)\.\d+\.(displayName|summary)$/.test(value) ||
    /^contributes\.rules\.(displayName|summary)$/.test(value) ||
    /^contributes\.desktop\.views\.\d+\.title$/.test(value) ||
    /^contributes\.desktop\.tabs\.\d+\.name$/.test(value) ||
    /^contributes\.desktop\.settingsPage\.title$/.test(value) ||
    /^settingsSchema\.\d+\.(title|description|placeholder)$/.test(value) ||
    /^settingsSchema\.\d+\.options\.\d+\.(label|description)$/.test(value)
  );
}

function setMessage(target: Record<string, unknown>, path: string[], value: string): void {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    current = (current[segment] ??= {}) as Record<string, unknown>;
  }
  current[path.at(-1)!] = value;
}

function mergeCatalogs(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = result[key];
    result[key] =
      typeof existing === "object" &&
      existing !== null &&
      typeof value === "object" &&
      value !== null
        ? mergeCatalogs(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return result;
}
