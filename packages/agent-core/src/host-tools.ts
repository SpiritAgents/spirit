import { APPLY_PATCH_HOST_TOOL_NAME } from "./open-responses/apply-patch-eligibility.js";
import { LLM_CONTEXT_TAGS, wrapLlmContextBlock } from "./llm-context-block.js";
import { USE_SAME_LANGUAGE_AS_USER_MESSAGE_RULE } from "./user-message-language.js";
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  DEFAULT_VIDEO_GENERATION_DURATION,
  type JsonObject,
  type JsonValue,
  type AgentMode,
} from "./ports.js";
import { throwUnknownToolError, toolNamesFromDefinitions } from "./unknown-tool-error.js";

export {
  enrichUnknownToolError,
  toolNamesFromDefinitions,
  unknownToolErrorMessage,
} from "./unknown-tool-error.js";

export interface BuiltinHostToolDefinitionEnvironment {
  shellDisplayName: string;
  commandParameterDescription: string;
}

export interface ContributedHostToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  /** When true, omitted from tools list in Ask mode. */
  excludeFromAskMode?: boolean;
  /**
   * When `agent`, only exposed in Agent mode (hidden in Plan/Ask).
   * Default: exposed in every mode that merges contributed tools.
   */
  agentModeExposure?: "all" | "agent";
}

export type DreamHostToolName =
  | "dream_list"
  | "dream_read"
  | "dream_record"
  | "dream_update"
  | "dream_delete";

export type TodoHostToolName = "todo_list" | "todo_write";

export const FINISH_TASK_TOOL_NAME = "finish_task";

export const ASK_MODE_EXCLUDED_HOST_TOOL_NAMES = new Set<string>([
  "shell",
  "create_file",
  "edit_file",
  "delete_file",
  APPLY_PATCH_HOST_TOOL_NAME,
  "generate_image",
  "generate_video",
  "create_plan",
]);

export function isAskAgentMode(agentMode: AgentMode): boolean {
  return agentMode === "ask";
}

export function isPlanAgentMode(agentMode: AgentMode): boolean {
  return agentMode === "plan";
}

export function readHostFunctionToolName(definition: JsonValue): string | undefined {
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    return undefined;
  }
  const fn = definition.function;
  if (typeof fn !== "object" || fn === null || Array.isArray(fn)) {
    return undefined;
  }
  return typeof fn.name === "string" ? fn.name : undefined;
}

/**
 * Host-contributed, tool-targeted description hint (e.g. a host UI rendering
 * capability such as Desktop Mermaid). The host owns the fact; agent-core owns
 * the merge point and the surrounding tool contract.
 */
export interface HostToolDescriptionHint {
  /** Function tool name the hint targets (e.g. "create_plan"). */
  toolName: string;
  /** When set, the hint extends this parameter's description instead of the tool's. */
  parameterName?: string;
  text: string;
}

/**
 * Appends host-contributed description hints to matching function tool
 * definitions. Matched definitions are copied; unmatched ones pass through by
 * reference. Hints matching no tool (or no such parameter) are ignored.
 */
export function applyHostToolDescriptionHints(
  definitions: JsonValue,
  hints: readonly HostToolDescriptionHint[],
): JsonValue {
  if (!Array.isArray(definitions) || hints.length === 0) {
    return definitions;
  }
  return definitions.map((definition) => {
    let result = definition;
    for (const hint of hints) {
      result = applyHostToolDescriptionHint(result, hint);
    }
    return result;
  });
}

function applyHostToolDescriptionHint(
  definition: JsonValue,
  hint: HostToolDescriptionHint,
): JsonValue {
  if (readHostFunctionToolName(definition) !== hint.toolName) {
    return definition;
  }
  const text = hint.text.trim();
  if (!text) {
    return definition;
  }
  const fn = (definition as JsonObject).function as JsonObject;
  if (hint.parameterName) {
    const parameters = fn.parameters;
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
      return definition;
    }
    const properties = (parameters as JsonObject).properties;
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
      return definition;
    }
    const property = (properties as JsonObject)[hint.parameterName];
    if (typeof property !== "object" || property === null || Array.isArray(property)) {
      return definition;
    }
    const description = (property as JsonObject).description;
    if (typeof description !== "string" || !description.trim()) {
      return definition;
    }
    return {
      ...(definition as JsonObject),
      function: {
        ...fn,
        parameters: {
          ...(parameters as JsonObject),
          properties: {
            ...(properties as JsonObject),
            [hint.parameterName]: {
              ...(property as JsonObject),
              description: `${description}\n\n${text}`,
            },
          },
        },
      },
    };
  }
  const description = fn.description;
  if (typeof description !== "string" || !description.trim()) {
    return definition;
  }
  return {
    ...(definition as JsonObject),
    function: { ...fn, description: `${description}\n\n${text}` },
  };
}

export function filterHostToolDefinitionsForAgentMode(
  definitions: JsonValue,
  agentMode: AgentMode,
): JsonValue {
  if (!isAskAgentMode(agentMode) || !Array.isArray(definitions)) {
    return definitions;
  }
  return definitions.filter((definition) => {
    const name = readHostFunctionToolName(definition);
    return name === undefined || !ASK_MODE_EXCLUDED_HOST_TOOL_NAMES.has(name);
  });
}

/** Reject edit-class host tools in Ask mode (model may still call them from prior turns). */
export function assertAgentModeAllowsHostTool(
  toolName: string,
  agentMode: AgentMode,
  availableToolDefinitions: JsonValue,
): void {
  const trimmed = toolName.trim();
  if (isAskAgentMode(agentMode) && ASK_MODE_EXCLUDED_HOST_TOOL_NAMES.has(trimmed)) {
    throwUnknownToolError(trimmed, toolNamesFromDefinitions(availableToolDefinitions));
  }
}

/** Reject finish_task when Loop is off (model may still call it from prior turns). */
export function assertFinishTaskToolAllowed(
  toolName: string,
  loopEnabled: boolean,
  availableToolDefinitions: JsonValue,
): void {
  if (toolName.trim() === FINISH_TASK_TOOL_NAME && !loopEnabled) {
    throwUnknownToolError(toolName, toolNamesFromDefinitions(availableToolDefinitions));
  }
}

export function buildFinishTaskHostToolDefinitions(): JsonValue[] {
  return [
    functionTool(
      "finish_task",
      "Mark the current user task as fully complete. When Loop is enabled, ordinary assistant replies do not stop the loop; call this tool only when the task is done and no further work is needed.",
      {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              'Optional terse completion reason (roughly 4–16 characters) shown as "Task completed: X." in the UI. Provide only the X phrase—no quotes, no full sentence, and do not include the "Task completed:" wrapper. Example X: "verified each message".',
          },
        },
        additionalProperties: false,
      },
    ),
  ];
}

export function buildBuiltinHostToolDefinitions(
  environment: BuiltinHostToolDefinitionEnvironment,
): JsonValue[] {
  return [
    functionTool("shell", buildShellToolDescription(environment.shellDisplayName), {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            `Short imperative phrase describing the command action. ${USE_SAME_LANGUAGE_AS_USER_MESSAGE_RULE} ` +
            'Must be in imperative mood (e.g., "List directory contents", "Install dependencies"). ' +
            'Do not use user-centric framing like "User requested" or "As per user\'s instruction". ' +
            "Keep it terse — one short phrase, not a sentence.",
        },
        command: {
          type: "string",
          description: environment.commandParameterDescription,
        },
      },
      required: ["reason", "command"],
      additionalProperties: false,
    }),
    functionTool(
      "web_fetch",
      "Fetch a web page over HTTP or HTTPS. Returns readable Markdown with headings, links, code blocks, and a link index for follow-up fetches; absolute URLs are preserved. Requests text/markdown when supported. For supported images, returns the image content. Security: only fetch trustworthy pages—untrusted content may contain prompt injection or misleading instructions.",
      {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Absolute http or https URL to fetch. Only use URLs you have reason to trust; fetched Markdown is passed into the model context.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "ls",
      "List all files and directories under one directory (non-recursive). The input path must be an absolute directory path. Use this instead of shell dir or find when you only need a directory inventory.",
      {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute directory path to enumerate. Returns file and directory paths in the specified directory only (non-recursive).",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "read_file",
      "Read file contents. Workspace files are direct; external files may need approval. Default to ~200-line chunks unless specified. For supported images, returns the actual image content.",
      {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the file to read, or a Spirit-managed generated asset ref such as spirit://generated/image/<name> or spirit://generated/video/<name>.",
          },
          offset: {
            type: "integer",
            minimum: 1,
            description:
              "1-based line number to start reading from. When paging through a file, prefer broad windows such as 1, 201, 401 instead of tiny slices.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            description:
              "Number of lines to read. Defaults to about 200 when omitted. For image files, line ranges may be ignored.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "glob",
      "Match workspace file paths with a glob pattern such as src/**/*.ts or **/*.{json,md}. Returns matching relative file paths only. Respects .gitignore. Use grep to search file contents and ls for a single directory inventory.",
      {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Workspace-relative glob pattern used to match file paths. Examples: src/**/*.ts, **/*.{ts,tsx}, .github/**/*.md.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "grep",
      "Search text within workspace file contents using a ripgrep regular expression. Respects .gitignore. Matching is case-sensitive by default; set -i to ignore case. Optionally pass glob to limit which files are searched. Use the glob tool to list paths only and ls for a single directory inventory.",
      {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Ripgrep regular expression to search for.",
          },
          "-i": {
            type: "boolean",
            description: "Match case-insensitively.",
          },
          "-n": {
            type: "boolean",
            description: "Show line numbers in content mode. Defaults to true.",
          },
          "-A": {
            type: "integer",
            minimum: 0,
            description: "Number of lines to show after each match. Content mode only.",
          },
          "-B": {
            type: "integer",
            minimum: 0,
            description: "Number of lines to show before each match. Content mode only.",
          },
          "-C": {
            type: "integer",
            minimum: 0,
            description: "Number of lines to show before and after each match. Content mode only.",
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count_matches"],
            description:
              "Output mode: content shows matching lines (default), files_with_matches lists matching file paths only, count_matches shows per-file match counts.",
          },
          head_limit: {
            type: "integer",
            minimum: 1,
            description:
              "Maximum number of entries to return. Defaults to 250; use offset to page through more.",
          },
          offset: {
            type: "integer",
            minimum: 0,
            description: "Number of entries to skip before returning results, for pagination.",
          },
          glob: {
            type: "string",
            description:
              "Optional workspace-relative glob that limits searched file paths, e.g. packages/**/*.ts or src/**/*.{ts,tsx}.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "subagent",
      "Delegate a scoped task to a child agent session. Use this when the task can be isolated from the main conversation and you want the child agent to return only its final result.",
      {
        type: "object",
        properties: {
          task: { type: "string" },
          success_criteria: { type: "string" },
          context_summary: { type: "string" },
          files_to_inspect: {
            type: "array",
            items: { type: "string" },
          },
          expected_output: { type: "string" },
          worktree: {
            type: "boolean",
            description:
              "When true, run the subagent in an isolated git worktree so parallel subagents can edit files without conflicting. Use when the subagent will modify workspace files and other subagents may edit at the same time; omit for read-only tasks.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "generate_image",
      "Generate one image with the configured image generation model. Use this only when the user explicitly wants an image. First gather enough context and rewrite the final image prompt yourself, then call this tool. After it completes, you may continue with a normal assistant message when that helps the user.",
      {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Detailed final prompt for the image generation model. Include subject, composition, style, lighting, colors, constraints, and any user-requested details.",
          },
          size: {
            type: "string",
            pattern: "^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$",
            description: `Optional pixel size in WIDTHxHEIGHT format, such as 1024x1024 or 1536x1024. If omitted, default to ${DEFAULT_IMAGE_GENERATION_SIZE} so the image matches the square card unless the user asked otherwise.`,
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "generate_video",
      "Generate one video with the configured video generation model. Use this only when the user explicitly wants a video. First gather enough context and rewrite the final video prompt yourself, then call this tool. After it completes, you may continue with a normal assistant message when that helps the user.",
      {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Detailed final prompt for the video generation model. Include subject, motion, camera, style, lighting, duration intent, and any user-requested details.",
          },
          duration: {
            type: "integer",
            minimum: 4,
            maximum: 15,
            description: `Optional clip duration in seconds. If omitted, default to ${DEFAULT_VIDEO_GENERATION_DURATION}.`,
          },
          aspect_ratio: {
            type: "string",
            description: "Optional aspect ratio such as 16:9, 9:16, or 1:1.",
          },
          resolution: {
            type: "string",
            description: "Optional output resolution such as 720p or 1080p.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "ask_questions",
      "Ask structured follow-up questions when a user decision is required to continue. The host always shows a custom text field per question.",
      {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Optional short title for the questionnaire panel.",
          },
          questions: {
            type: "array",
            description: "Ordered list of questions to ask.",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Stable machine-readable question id used in the returned JSON.",
                },
                title: {
                  type: "string",
                  description: "Question title shown to the user.",
                },
                allowMultiple: {
                  type: "boolean",
                  description:
                    "When true, the user may select multiple preset options. Defaults to false.",
                },
                options: {
                  type: "array",
                  description:
                    "Preset options for this question. Omit or use an empty array for a custom-text-only question.",
                  items: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        description: "Stable machine-readable option id used in the returned JSON.",
                      },
                      label: {
                        type: "string",
                        description: "Visible option label.",
                      },
                      summary: {
                        type: "string",
                        description: "Optional short gray summary shown under the option label.",
                      },
                    },
                    required: ["id", "label"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["id", "title"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "create_file",
      "Create a new file inside the workspace or under Spirit-managed user rule/plan/skills paths. Fails if the file already exists.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "edit_file",
      "Edit an existing file inside the workspace or under Spirit-managed user rule/plan/skills paths by replacing one exact old_text snippet with new_text. This prevents accidental full-file overwrite.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["path", "old_text", "new_text"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "delete_file",
      "Delete an existing file inside the workspace or under Spirit-managed user rule/plan/skills paths.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    ),
  ];
}

export function filterContributedToolDefinitionsForAgentMode(
  definitions: readonly ContributedHostToolDefinition[],
  agentMode: AgentMode,
): ContributedHostToolDefinition[] {
  return definitions.filter((definition) => {
    if (
      definition.agentModeExposure === "agent" &&
      agentMode !== "agent" &&
      agentMode !== "debug"
    ) {
      return false;
    }
    if (isAskAgentMode(agentMode) && definition.excludeFromAskMode === true) {
      return false;
    }
    return true;
  });
}

/** Reject contributed host tools hidden for the current agent mode (e.g. prior-turn calls in Ask). */
export function assertContributedHostToolAllowed(
  toolName: string,
  agentMode: AgentMode,
  contributedDefinitions: readonly ContributedHostToolDefinition[],
  availableToolDefinitions: JsonValue,
): void {
  const trimmed = toolName.trim();
  const definition = contributedDefinitions.find((item) => item.name === trimmed);
  if (!definition) {
    return;
  }
  if (filterContributedToolDefinitionsForAgentMode([definition], agentMode).length === 0) {
    throwUnknownToolError(trimmed, toolNamesFromDefinitions(availableToolDefinitions));
  }
}

export function buildContributedHostToolDefinitions(
  definitions: readonly ContributedHostToolDefinition[],
): JsonValue[] {
  return definitions.map((definition) =>
    functionTool(definition.name, definition.description, definition.inputSchema),
  );
}

export function buildDreamHostToolDefinitions(): JsonValue[] {
  return [
    functionTool(
      "dream_list",
      "List all non-expired dream summaries in the current collector scope. The host scope is fixed to the collector workspace and Git branch; do not ask for broader memory. Use this before recording a new dream so you can update or delete stale dreams instead of duplicating them.",
      {
        type: "object",
        properties: {
          include_deleted: {
            type: "boolean",
            description:
              "Whether to include dreams previously marked as deleted. Defaults to false.",
          },
          include_expired: {
            type: "boolean",
            description: "Whether to include expired dreams. Defaults to false.",
          },
        },
        additionalProperties: false,
      },
    ),
    functionTool(
      "dream_read",
      "Read one dream summary by id within the current collector scope. Use this when the list result indicates an existing dream may need to be updated or deleted.",
      {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Dream id returned by dream_list.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "dream_record",
      "Record a new dream summary for the current collector scope. Only use this when existing dreams do not already cover the source session movement.",
      {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short human-readable title for the recent work movement.",
          },
          summary: {
            type: "string",
            description: "Concise summary of what changed and why it matters.",
          },
          details: {
            type: "string",
            description:
              "Optional supporting detail, decisions, constraints, or unresolved follow-ups.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional high-signal tags only. Prefer 1-2 word lowercase tags such as desktop, git, commit. Keep the list short and do not enumerate every subtopic.",
          },
        },
        required: ["title", "summary"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "dream_update",
      "Update an existing dream summary in the current collector scope. Prefer updating a related dream over creating a duplicate when a source session continues the same work movement.",
      {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Dream id returned by dream_list.",
          },
          title: {
            type: "string",
            description: "Replacement title, if the existing title is no longer accurate.",
          },
          summary: {
            type: "string",
            description: "Replacement concise summary.",
          },
          details: {
            type: "string",
            description: "Replacement supporting detail. Omit to keep existing details.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Replacement high-signal tags only. Prefer a short list of 1-2 word lowercase tags. Omit to keep existing tags.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    ),
    functionTool(
      "dream_delete",
      "Mark an existing dream as deleted within the current collector scope. Use this only when the dream is stale, misleading, or superseded by another dream. Normal expiry is handled by the host.",
      {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Dream id returned by dream_list.",
          },
          reason: {
            type: "string",
            description: "Short reason for deleting the dream.",
          },
        },
        required: ["id", "reason"],
        additionalProperties: false,
      },
    ),
  ];
}

export function buildDreamReadHostToolDefinitions(): JsonValue[] {
  return [
    functionTool(
      "dream_list",
      "List short-lived dream summaries for the current workspace and Git branch. Use this when the dream catalog in the system message suggests relevant prior work, or when you want the freshest list of dream ids before reading one in detail.",
      {
        type: "object",
        properties: {
          include_deleted: {
            type: "boolean",
            description:
              "Whether to include dreams previously marked as deleted. Defaults to false.",
          },
          include_expired: {
            type: "boolean",
            description: "Whether to include expired dreams. Defaults to false.",
          },
        },
        additionalProperties: false,
      },
    ),
    functionTool(
      "dream_read",
      "Read one dream by id for the current workspace and Git branch. Use this after dream_list or after the dream catalog in the system message highlights a potentially relevant dream id.",
      {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Dream id returned by dream_list or shown in the system message dream catalog.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    ),
  ];
}

export function buildTodoHostToolDefinitions(): JsonValue[] {
  const todoItemSchema: JsonObject = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "Stable todo identifier. Reuse ids from todo_list when updating items; omit for new items to let the host assign one.",
      },
      title: {
        type: "string",
        description: "Human-readable todo title.",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed"],
        description:
          'Todo status: "pending" (not started), "in_progress" (actively working), or "completed" (done).',
      },
    },
    required: ["title", "status"],
    additionalProperties: false,
  };

  return [
    functionTool(
      "todo_list",
      "List todos for the current chat session. Returns the same shape as todo_write accepts.",
      {
        type: "object",
        properties: {
          include_completed: {
            type: "boolean",
            description: "Whether to include completed todos. Defaults to true.",
          },
        },
        additionalProperties: false,
      },
    ),
    functionTool(
      "todo_write",
      "Replace the full session todo list. Pass the entire list each time (same shape as todo_list returns). Use an empty list to clear todos. Call this tool frequently as you work through tasks to keep your progress tracked and visible to the user.",
      {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: todoItemSchema,
            description: "Full session todo list to store.",
          },
        },
        required: ["todos"],
        additionalProperties: false,
      },
    ),
  ];
}

export function buildPlanModeHostToolDefinitions(): JsonValue[] {
  return [
    functionTool(
      "create_plan",
      "Create a named implementation plan stored as plans/{name}.md for a later Agent turn to execute.",
      {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Short plan slug used as the file stem only: letters, digits, hyphens, underscores. No directories, no .md suffix, no spaces (example: desktop-plans-dir).",
          },
          content: {
            type: "string",
            description:
              'Full markdown body of the implementation plan—the document a coding agent will follow in a later turn.\n\nUnless the user explicitly asks for another shape (one-pager, ADR-only, research notes), write an execution-ready plan, not a roadmap deck:\n\n- Start with a "# Title" and one short paragraph: goal, non-goals, and what "done" means.\n- Split work into ordered phases: "## Phase 1: <short title>", "## Phase 2: ...", and so on.\n- Under each phase use markdown task checkboxes only for actionable work: "- [ ] <imperative task>". Each task should be specific enough to implement or verify in one sitting; name files, modules, or APIs when known from the repo.\n- End each phase with a "**Verify**" bullet list: commands, tests, or observable checks that prove the phase is complete.\n- Phase 1 must state workspace assumptions that affect implementation (e.g. target git branch name, feature flags, or "no schema migrations") when relevant; do not invent repo facts—read the codebase first when unsure.\n- Prefer depth on the current user request over generic process filler; skip empty checklist boilerplate.\n\nAfter creation, revise this plan with edit_file on the same path (old_text/new_text), not another create_plan call.',
          },
        },
        required: ["name", "content"],
        additionalProperties: false,
      },
    ),
  ];
}

export function buildDreamCollectorSystemMessage(): string {
  return wrapLlmContextBlock(
    LLM_CONTEXT_TAGS.dream_collector,
    [
      "You are the dream collector for Spirit.",
      "Dreams are short-lived summaries of recent work movement, not permanent memory.",
      "The host has already scoped this collection run to one workspace and one Git branch.",
      "First call dream_list to inspect existing dreams in this scope.",
      "Then decide whether the source session should create a new dream, update an existing dream, delete a stale dream, or leave dreams unchanged.",
      "Prefer updating an existing related dream over creating duplicates.",
      "When the host marks the source session context as incremental, focus on the newly added movement and merge it into existing dreams instead of restating older context.",
      "Record why the work matters, user intent, important decisions, constraints, and unresolved follow-ups.",
      "Do not summarize every message mechanically. Preserve signal that helps future host consumers understand the current work direction.",
      "Do not perform production work. Only read the provided context and maintain dreams through the dream tools.",
    ].join("\n"),
  );
}

function buildShellToolDescription(shellDisplayName: string): string {
  return `Execute a shell command in the workspace directory using the current shell: ${shellDisplayName}.`;
}

function functionTool(name: string, description: string, parameters: JsonObject): JsonValue {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
    },
  };
}
