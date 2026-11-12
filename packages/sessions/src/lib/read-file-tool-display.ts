import { readFileHeadlineDetailForPath, readFileVerbKey } from "./read-file-skill-display.js";
import { backgroundTaskOutputKind } from "@spiritagent/host-internal/background-task-path";
import {
  isToolOutputArchivePath,
  toolOutputArchiveHeadlineDetail,
} from "./tool-output-archive-display.js";

export function readFileToolHeadlineDetail(
  rawPath: string,
  options: {
    emptyFileLabel: string;
    toolOutputLabel: string;
    shellOutputLabel: string;
    subagentOutputLabel: string;
    lineRange?: string;
    skillMarkdownContent?: string;
  },
): string {
  const lineRange = options.lineRange ?? "";
  const taskKind = backgroundTaskOutputKind(rawPath);
  if (taskKind) {
    return `${taskKind === "shell" ? options.shellOutputLabel : options.subagentOutputLabel}${lineRange}`.trim();
  }
  if (isToolOutputArchivePath(rawPath)) {
    return toolOutputArchiveHeadlineDetail(options.toolOutputLabel, lineRange);
  }
  return readFileHeadlineDetailForPath(rawPath, {
    emptyFileLabel: options.emptyFileLabel,
    lineRange,
    skillMarkdownContent: options.skillMarkdownContent,
  });
}

export { readFileVerbKey };
