import { isToolOutputArchivePath } from "@spiritagent/tools/tool-output-archive-path";

export { isToolOutputArchivePath };

export function toolOutputArchiveHeadlineDetail(toolOutputLabel: string, lineRange = ""): string {
  return `${toolOutputLabel}${lineRange}`.trim();
}
