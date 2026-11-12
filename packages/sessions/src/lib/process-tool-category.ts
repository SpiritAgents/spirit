import type { ToolBlockSnapshot } from "@/types";

export type ProcessToolCategory =
  | "explore"
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "ask"
  | "diagnose"
  | "generate"
  | "run"
  | "other";

export type ProcessToolCounts = Record<ProcessToolCategory, number>;

export const PROCESS_TOOL_CATEGORY_ORDER: readonly ProcessToolCategory[] = [
  "explore",
  "view",
  "create",
  "edit",
  "delete",
  "ask",
  "diagnose",
  "generate",
  "run",
  "other",
];

/** Process card summary: read/search/match/list-directory/fetch-page/web-search/dream and TODO-list style exploratory tools are all grouped as "explore". */
const EXPLORE_TOOLS = new Set([
  "read_file",
  "ls",
  "grep",
  "glob",
  "web_fetch",
  "web_search",
  "dream_read",
  "dream_list",
  "todo_list",
]);

const CREATE_TOOLS = new Set(["create_file", "create_plan", "create_automation"]);

const EDIT_TOOLS = new Set(["edit_file", "todo_write", "dream_update", "dream_record"]);

const DELETE_TOOLS = new Set(["delete_file", "dream_delete"]);

/** Tools excluded from process card grouping and summary counts (rendered outside the process card). */
export const PROCESS_GROUP_EXCLUDED_TOOL_NAMES = new Set(["finish_task", "todo_write"]);

export function isProcessGroupExcludedToolName(toolName: string): boolean {
  return PROCESS_GROUP_EXCLUDED_TOOL_NAMES.has(toolName);
}

const APPLY_PATCH_CREATE = new Set(["创建", "创建中", "已创建", "Create", "Creating", "Created"]);
const APPLY_PATCH_EDIT = new Set(["编辑", "编辑中", "已编辑", "Edit", "Editing", "Edited"]);
const APPLY_PATCH_DELETE = new Set(["删除", "删除中", "已删除", "Delete", "Deleting", "Deleted"]);

export function emptyProcessToolCounts(): ProcessToolCounts {
  return {
    explore: 0,
    view: 0,
    create: 0,
    edit: 0,
    delete: 0,
    ask: 0,
    diagnose: 0,
    generate: 0,
    run: 0,
    other: 0,
  };
}

function classifyApplyPatch(headline: string | undefined): ProcessToolCategory {
  const normalized = headline?.trim() ?? "";
  if (APPLY_PATCH_CREATE.has(normalized)) {
    return "create";
  }
  if (APPLY_PATCH_EDIT.has(normalized)) {
    return "edit";
  }
  if (APPLY_PATCH_DELETE.has(normalized)) {
    return "delete";
  }
  return "edit";
}

const CREATE_AUTOMATION_HEADLINES = new Set(["创建自动化", "Create automation"]);

function isCreateAutomationHeadline(headline: string | undefined): boolean {
  return CREATE_AUTOMATION_HEADLINES.has(headline?.trim() ?? "");
}

export function classifyProcessToolCategory(
  toolName: string,
  headline?: string,
): ProcessToolCategory {
  if (isProcessGroupExcludedToolName(toolName)) {
    return "other";
  }
  if (toolName === "tool_call" && isCreateAutomationHeadline(headline)) {
    return "create";
  }
  if (toolName === "generate_image" || toolName === "generate_video") {
    return "generate";
  }
  if (toolName === "ask_questions") {
    return "ask";
  }
  if (toolName === "get_diagnostics") {
    return "diagnose";
  }
  if (toolName === "shell") {
    return "run";
  }
  if (EXPLORE_TOOLS.has(toolName)) {
    return "explore";
  }
  if (toolName === "apply_patch") {
    return classifyApplyPatch(headline);
  }
  if (CREATE_TOOLS.has(toolName)) {
    return "create";
  }
  if (EDIT_TOOLS.has(toolName)) {
    return "edit";
  }
  if (DELETE_TOOLS.has(toolName)) {
    return "delete";
  }
  return "other";
}

export function classifyProcessToolCategoryFromSnapshot(
  tool: Pick<ToolBlockSnapshot, "toolName" | "headline">,
): ProcessToolCategory {
  return classifyProcessToolCategory(tool.toolName, tool.headline);
}

export function incrementProcessToolCounts(
  counts: ProcessToolCounts,
  category: ProcessToolCategory,
): ProcessToolCounts {
  return {
    ...counts,
    [category]: counts[category] + 1,
  };
}

export function aggregateProcessToolCounts(
  tools: ReadonlyArray<Pick<ToolBlockSnapshot, "toolName" | "headline">>,
): ProcessToolCounts {
  return tools.reduce((counts, tool) => {
    const category = classifyProcessToolCategoryFromSnapshot(tool);
    return incrementProcessToolCounts(counts, category);
  }, emptyProcessToolCounts());
}

/** First occurrence order of each category in the tool sequence. */
export function collectProcessCategoryOrder(
  tools: ReadonlyArray<Pick<ToolBlockSnapshot, "toolName" | "headline">>,
): ProcessToolCategory[] {
  const seen = new Set<ProcessToolCategory>();
  const order: ProcessToolCategory[] = [];
  for (const tool of tools) {
    const category = classifyProcessToolCategoryFromSnapshot(tool);
    if (seen.has(category)) {
      continue;
    }
    seen.add(category);
    order.push(category);
  }
  return order;
}
