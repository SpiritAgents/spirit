import type { Messages } from "@/i18n/messages";

type JsonMessages = Omit<Messages, "common" | "footer" | "desktop"> & {
  common: Omit<Messages["common"], "downloadForPlatform"> & {
    downloadForPlatform: string;
  };
  footer: Omit<Messages["footer"], "copyrightLine"> & {
    copyrightLine: string;
  };
  desktop: Omit<Messages["desktop"], "models" | "commit" | "shell" | "previews"> & {
    models: Omit<Messages["desktop"]["models"], "deleteDialogTitle" | "deleteDialogDescription"> & {
      deleteDialogTitle: string;
      deleteDialogDescription: string;
    };
    commit: Omit<Messages["desktop"]["commit"], "currentBranch"> & {
      currentBranch: string;
    };
    shell: Omit<
      Messages["desktop"]["shell"],
      "currentWorkspace" | "unsupportedCommand" | "exited"
    > & {
      currentWorkspace: string;
      unsupportedCommand: string;
      exited: string;
    };
    previews: Omit<
      Messages["desktop"]["previews"],
      "generatedWorkspaceDescription" | "generatedWorkspaceOverview"
    > & {
      generatedWorkspaceDescription: string;
      generatedWorkspaceOverview: string;
    };
  };
};

function fill(template: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
    template,
  );
}

export function hydrateMessages(raw: unknown): Messages {
  const json = raw as JsonMessages;
  return {
    ...json,
    common: {
      ...json.common,
      downloadForPlatform: (platform) => fill(json.common.downloadForPlatform, { platform }),
    },
    footer: {
      ...json.footer,
      copyrightLine: (year) => fill(json.footer.copyrightLine, { year }),
    },
    desktop: {
      ...json.desktop,
      models: {
        ...json.desktop.models,
        deleteDialogTitle: (modelName) =>
          fill(json.desktop.models.deleteDialogTitle, { modelName }),
        deleteDialogDescription: (modelName) =>
          fill(json.desktop.models.deleteDialogDescription, { modelName }),
      },
      commit: {
        ...json.desktop.commit,
        currentBranch: (branch) =>
          fill(json.desktop.commit.currentBranch, { branch: branch || "main" }),
      },
      shell: {
        ...json.desktop.shell,
        currentWorkspace: (workspaceRoot) =>
          fill(json.desktop.shell.currentWorkspace, { workspaceRoot }),
        unsupportedCommand: (command) => fill(json.desktop.shell.unsupportedCommand, { command }),
        exited: (exitCode) => fill(json.desktop.shell.exited, { exitCode }),
      },
      previews: {
        ...json.desktop.previews,
        generatedWorkspaceDescription: (label) =>
          fill(json.desktop.previews.generatedWorkspaceDescription, { label }),
        generatedWorkspaceOverview: (root) =>
          fill(json.desktop.previews.generatedWorkspaceOverview, { root }),
      },
    },
  };
}
