import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { evalScenarios } from '../packages/agent-core/dist/eval/scenarios.js';
import { validateEvalRunArtifact } from '../packages/agent-core/dist/eval/artifacts.js';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const DEFAULT_SCENARIO_ID = 'tool-heavy-code-edit';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.listScenarios) {
    printScenarioList();
    return;
  }

  assertRequiredOptions(options);

  const scenario = resolveScenario(options);
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const comparison = await resolveComparison(repoRoot, options);
  const modelConfig = resolveModelConfig(options);
  const runId = `eval-${new Date().toISOString().replace(/[.:]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const outputDir = await prepareOutputDirectory(options.outputDir);
  const artifactsDir = path.join(outputDir, 'artifacts');
  const baselineRuntimeSource = path.join(outputDir, 'baseline-runtime-source');
  const candidateRuntimeSource = path.join(outputDir, 'candidate-runtime-source');
  const baselineWorkspace = path.join(outputDir, 'baseline-workspace');
  const candidateWorkspace = path.join(outputDir, 'candidate-workspace');

  await mkdir(artifactsDir, { recursive: true });

  try {
    await createRuntimeSourceSnapshot(repoRoot, baselineRuntimeSource, comparison.baselineRuntimeRef);
    await createRuntimeSourceSnapshot(repoRoot, candidateRuntimeSource, comparison.candidateRuntimeRef);
    await linkWorkspaceNodeModules(repoRoot, baselineRuntimeSource);
    await linkWorkspaceNodeModules(repoRoot, candidateRuntimeSource);
    if (comparison.mode === 'staged') {
      await applyPatchToWorkspace(candidateRuntimeSource, comparison.patchText);
    }

    await createExecutionWorkspace(options.workspaceSource, baselineWorkspace);
    await createExecutionWorkspace(options.workspaceSource, candidateWorkspace);

    const startedAtUnixMs = Date.now();
    const [baselineResult, candidateResult] = await Promise.all([
      runCandidate({
        candidateId: 'baseline',
        label: 'Before',
        runtimeSourcePath: baselineRuntimeSource,
        workspacePath: baselineWorkspace,
        repoRoot,
        runId,
        scenario,
        modelConfig,
        artifactsDir,
        comparison,
        bypassApprove: options.bypassApprove,
      }),
      runCandidate({
        candidateId: 'candidate',
        label: 'After',
        runtimeSourcePath: candidateRuntimeSource,
        workspacePath: candidateWorkspace,
        repoRoot,
        runId,
        scenario,
        modelConfig,
        artifactsDir,
        comparison,
        bypassApprove: options.bypassApprove,
      }),
    ]);

    const artifact = {
      schemaVersion: 2,
      runId,
      createdAtUnixMs: startedAtUnixMs,
      scenario,
      comparison: {
        mode: comparison.mode,
        baselineRef: comparison.baselineRef,
        ...(comparison.candidateRef ? { candidateRef: comparison.candidateRef } : {}),
        diffFingerprint: comparison.diffFingerprint,
      },
      ...(options.workspaceSource ? { workspaceSource: options.workspaceSource } : {}),
      candidates: [baselineResult.record, candidateResult.record],
      humanReview: {
        status: 'pending-human-review',
      },
    };

    validateEvalRunArtifact(artifact);

    const artifactPath = path.join(artifactsDir, 'review-artifact.json');
    await writeJsonFile(artifactPath, artifact);

    console.log('');
    console.log('Compare run completed.');
    console.log(`Run ID: ${runId}`);
    console.log(`Scenario: ${scenario.id} | ${scenario.title}`);
    console.log(`Output directory: ${outputDir}`);
    console.log(`Workspace source: ${options.workspaceSource ?? 'empty'}`);
    console.log(`Baseline workspace: ${baselineWorkspace}`);
    console.log(`Candidate workspace: ${candidateWorkspace}`);
    console.log(`Review artifact: ${artifactPath}`);
    console.log(`Comparison source: ${renderComparisonMode(comparison.mode)}`);
    console.log(`Baseline ref: ${comparison.baselineRef}`);
    console.log(
      comparison.candidateRef
        ? `Candidate ref: ${comparison.candidateRef}`
        : `Candidate source: staged diff on top of ${comparison.baselineRef}`,
    );
    console.log(`Diff fingerprint: ${comparison.diffFingerprint}`);
  } catch (error) {
    console.error('Compare run failed.');
    console.error(renderError(error));
    console.error(`Output directory kept for manual inspection: ${outputDir}`);
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    help: false,
    listScenarios: false,
    scenarioId: DEFAULT_SCENARIO_ID,
    prompt: undefined,
    title: undefined,
    objective: undefined,
    apiKey: undefined,
    baseUrl: undefined,
    model: undefined,
    reasoningEffort: undefined,
    outputDir: undefined,
    workspaceSource: undefined,
    commit: undefined,
    baselineRef: undefined,
    candidateRef: undefined,
    bypassApprove: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--list-scenarios':
        options.listScenarios = true;
        break;
      case '--scenario':
        options.scenarioId = requiredArgValue(argv, ++index, '--scenario');
        break;
      case '--prompt':
        options.prompt = requiredArgValue(argv, ++index, '--prompt');
        break;
      case '--title':
        options.title = requiredArgValue(argv, ++index, '--title');
        break;
      case '--objective':
        options.objective = requiredArgValue(argv, ++index, '--objective');
        break;
      case '--api-key':
        options.apiKey = requiredArgValue(argv, ++index, '--api-key');
        break;
      case '--base-url':
        options.baseUrl = requiredArgValue(argv, ++index, '--base-url');
        break;
      case '--model':
        options.model = requiredArgValue(argv, ++index, '--model');
        break;
      case '--reasoning-effort':
        options.reasoningEffort = requiredArgValue(argv, ++index, '--reasoning-effort');
        break;
      case '--output-dir':
        options.outputDir = path.resolve(requiredArgValue(argv, ++index, '--output-dir'));
        break;
      case '--workspace-source':
        options.workspaceSource = path.resolve(requiredArgValue(argv, ++index, '--workspace-source'));
        break;
      case '--commit':
        options.commit = requiredArgValue(argv, ++index, '--commit');
        break;
      case '--baseline-ref':
        options.baselineRef = requiredArgValue(argv, ++index, '--baseline-ref');
        break;
      case '--candidate-ref':
        options.candidateRef = requiredArgValue(argv, ++index, '--candidate-ref');
        break;
      case '--bypass-approve':
        options.bypassApprove = true;
        break;
      case '--require-approvals':
        options.bypassApprove = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function assertRequiredOptions(options) {
  if (!options.outputDir) {
    throw new Error('Missing output directory. Specify the artifact directory for this compare via --output-dir, e.g. d:\\eval-runs\\spirit-eval-compare-001.');
  }
}

async function resolveComparison(repoRoot, options) {
  if (options.commit && (options.baselineRef || options.candidateRef)) {
    throw new Error('--commit cannot be used together with --baseline-ref / --candidate-ref.');
  }

  if (options.baselineRef || options.candidateRef) {
    if (!options.baselineRef || !options.candidateRef) {
      throw new Error('--baseline-ref and --candidate-ref must be used together.');
    }
    return resolveGitRefComparison(repoRoot, options.baselineRef, options.candidateRef);
  }

  if (options.commit) {
    return resolveCommitComparison(repoRoot, options.commit);
  }

  return resolveStagedComparison(repoRoot);
}

async function resolveStagedComparison(repoRoot) {
  const baselineRef = await resolveGitRef(repoRoot, 'HEAD');
  const patchText = (await git(repoRoot, ['diff', '--cached', '--binary', '--no-ext-diff'])).stdout;
  if (!patchText.trim()) {
    throw new Error('Staging area is empty. Stage the candidate changes first, then run the compare runner.');
  }

  return {
    mode: 'staged',
    baselineRef,
    diffFingerprint: sha256(patchText),
    baselineRuntimeRef: baselineRef,
    candidateRuntimeRef: baselineRef,
    patchText,
  };
}

async function resolveGitRefComparison(repoRoot, rawBaselineRef, rawCandidateRef) {
  const baselineRef = await resolveGitRef(repoRoot, rawBaselineRef);
  const candidateRef = await resolveGitRef(repoRoot, rawCandidateRef);
  const diffText = (await git(repoRoot, [
    'diff',
    '--binary',
    '--no-ext-diff',
    baselineRef,
    candidateRef,
  ])).stdout;
  if (!diffText.trim()) {
      throw new Error(`The specified git refs have no differences: ${rawBaselineRef} -> ${rawCandidateRef}`);
  }

  return {
    mode: 'git-ref',
    baselineRef,
    candidateRef,
    diffFingerprint: sha256(diffText),
    baselineRuntimeRef: baselineRef,
    candidateRuntimeRef: candidateRef,
  };
}

async function resolveCommitComparison(repoRoot, rawCommitRef) {
  const candidateRef = await resolveGitCommitRef(repoRoot, rawCommitRef);
  const parents = await listGitCommitParents(repoRoot, candidateRef);
  if (parents.length === 0) {
    throw new Error('--commit currently only supports commits with a parent; for a root commit use --baseline-ref / --candidate-ref instead.');
  }

  if (parents.length > 1) {
    console.warn(`--commit ${rawCommitRef} is a merge commit; using first-parent ${parents[0]} as baseline by default.`);
  }

  return resolveGitRefComparison(repoRoot, parents[0], candidateRef);
}

async function resolveGitRef(repoRoot, ref) {
  return (await git(repoRoot, ['rev-parse', ref])).stdout.trim();
}

async function resolveGitCommitRef(repoRoot, ref) {
  return (await git(repoRoot, ['rev-parse', `${ref}^{commit}`])).stdout.trim();
}

async function listGitCommitParents(repoRoot, ref) {
  const line = (await git(repoRoot, ['rev-list', '--parents', '-n', '1', ref])).stdout.trim();
  const parts = line.split(/\s+/u).filter(Boolean);
  return parts.slice(1);
}

async function prepareOutputDirectory(outputDir) {
  if (existsSync(outputDir)) {
    const stats = await stat(outputDir);
    if (!stats.isDirectory()) {
      throw new Error(`--output-dir must point to a directory path; it already exists and is not a directory: ${outputDir}`);
    }

    const entries = await readdir(outputDir);
    if (entries.length > 0) {
      throw new Error(`--output-dir points to a non-empty directory; provide a new non-existent path or an empty directory: ${outputDir}`);
    }

    return outputDir;
  }

  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function validateWorkspaceSource(sourcePath) {
  if (!existsSync(sourcePath)) {
      throw new Error(`--workspace-source points to a directory that does not exist: ${sourcePath}`);
  }

  const stats = await stat(sourcePath);
  if (!stats.isDirectory()) {
      throw new Error(`--workspace-source must point to a directory: ${sourcePath}`);
  }
}

function requiredArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function resolveScenario(options) {
  if (options.prompt) {
    return {
      id: 'custom-runtime-compare',
      title: options.title ?? 'Custom runtime compare',
      description: options.objective ?? 'Compare baseline and candidate behavior in isolated artifact workspaces.',
      userPrompt: options.prompt,
      expectedDeliverables: ['workspace diff', 'assistant output', 'review artifact'],
      rubric: {
        id: 'custom-compare-v1',
        title: 'Custom compare rubric',
        criteria: [
          {
            id: 'task-completion',
            label: 'Task completion',
            description: 'The delivered result satisfies the user request end to end.',
            weight: 0.35,
            scale: { min: 1, max: 5 },
          },
          {
            id: 'tool-judgment',
            label: 'Tool judgment',
            description: 'Tool use is necessary, scoped, and sequenced well.',
            weight: 0.25,
            scale: { min: 1, max: 5 },
          },
          {
            id: 'instruction-following',
            label: 'Instruction following',
            description: 'System, repository, and user instructions are followed without drift.',
            weight: 0.2,
            scale: { min: 1, max: 5 },
          },
          {
            id: 'user-experience',
            label: 'User experience',
            description: 'The final answer is useful, concise, and easy for a human reviewer to act on.',
            weight: 0.2,
            scale: { min: 1, max: 5 },
          },
        ],
      },
      metadata: {
        tags: ['custom', 'runtime-compare'],
        decisionPrompt: 'Compare baseline and candidate outputs for this scenario. Pick the better user experience, or tie if neither is meaningfully better.',
      },
    };
  }

  const scenario = evalScenarios.find((entry) => entry.id === options.scenarioId);
  if (!scenario) {
    const ids = evalScenarios.map((entry) => entry.id).join(', ');
    throw new Error(`Unknown scenario: ${options.scenarioId}. Available scenarios: ${ids}`);
  }
  return scenario;
}

function resolveModelConfig(options) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing API key. Set OPENAI_API_KEY or pass --api-key.');
  }

  const model = options.model ?? process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error('Missing model configuration. Set OPENAI_MODEL or pass --model.');
  }

  return {
    apiKey,
    model,
    ...(options.baseUrl ?? process.env.OPENAI_BASE_URL
      ? { baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL }
      : {}),
    ...(options.reasoningEffort ?? process.env.SPIRIT_AGENT_EVAL_REASONING_EFFORT
      ? { reasoningEffort: options.reasoningEffort ?? process.env.SPIRIT_AGENT_EVAL_REASONING_EFFORT }
      : {}),
  };
}

async function runCandidate(params) {
  const spiritDataDir = path.join(params.workspacePath, '.spirit-eval-data');
  await mkdir(spiritDataDir, { recursive: true });

  const tracker = new CandidateTracker(params.candidateId, params.label);
  tracker.info(`in progress | workspace: ${params.workspacePath}`);
  tracker.info(`runtime source: ${params.runtimeSourcePath}`);
  tracker.info('building isolated runtime source');

  const modules = await loadWorkspaceRuntimeModules(params.runtimeSourcePath);
  const {
    AgentRuntime,
    pendingWorkspaceFilesFromInput,
    buildBuiltinHostToolDefinitions,
    enrichUnknownToolError,
    toolNamesFromDefinitions,
    createToolExecutionTextOutput,
    createOpenAiCompatibleTransport,
    appendOpenAiToolResultMessage,
    appendOpenAiUserLlmMessage,
    appendOpenAiUserMessage,
    continueOpenAiToolAgentState,
    extractLastOpenAiAssistantText,
    rebuildOpenAiToolAgentStateAfterCompaction,
    startOpenAiToolAgentState,
    truncateOpenAiHistoryForCompaction,
    truncateOpenAiToolAgentStateForContextRetry,
    resolveOpenAiModelCompatibilityProfile,
    loadHostInstructionMetadata,
    NodeHostToolService,
  } = modules;

  const context = {
    workspaceRoot: params.workspacePath,
    spiritDataDir,
  };
  const hostMetadata = await loadHostInstructionMetadata(context);
  const hostToolService = new NodeHostToolService(context, {
    getModelCompatibilityProfile: () => resolveOpenAiModelCompatibilityProfile(params.modelConfig),
  });
  const toolExecutor = new EvalHostToolExecutor(hostToolService, tracker, {
    bypassApprove: params.bypassApprove,
    buildBuiltinHostToolDefinitions,
    createToolExecutionTextOutput,
    unknownToolHelpers: {
      enrichUnknownToolError: modules.enrichUnknownToolError,
      toolNamesFromDefinitions: modules.toolNamesFromDefinitions,
    },
  });
  if (typeof hostToolService.bindAvailableToolDefinitions === 'function') {
    hostToolService.bindAvailableToolDefinitions(() => toolExecutor.toolDefinitionsJson());
  }
  const toolDefinitionsJson = toolExecutor.toolDefinitionsJson();
  const initialState = startOpenAiToolAgentState(
    [],
    params.scenario.userPrompt,
    params.workspacePath,
    hostMetadata.rules.enabledRules,
    hostMetadata.skills.enabledSkillCatalog,
    params.modelConfig.model,
    hostMetadata.planMetadata,
    [],
  );
  const runtime = new AgentRuntime({
    config: {
      ...params.modelConfig,
      workspaceRoot: params.workspacePath,
    },
    llmTransport: createOpenAiCompatibleTransport(params.modelConfig),
    toolExecutor,
    createToolAgentState: (history, userInput) =>
      startOpenAiToolAgentState(
        history,
        userInput,
        params.workspacePath,
        hostMetadata.rules.enabledRules,
        hostMetadata.skills.enabledSkillCatalog,
        params.modelConfig.model,
        hostMetadata.planMetadata,
        [],
      ),
    createContinuationState: (history) =>
      continueOpenAiToolAgentState(
        history,
        params.workspacePath,
        hostMetadata.rules.enabledRules,
        hostMetadata.skills.enabledSkillCatalog,
        params.modelConfig.model,
        hostMetadata.planMetadata,
        [],
      ),
    appendToolResultMessage: appendOpenAiToolResultMessage,
    appendUserMessage: appendOpenAiUserMessage,
    appendUserLlmMessage: (state, message) =>
      appendOpenAiUserLlmMessage(state, message, params.workspacePath),
    extractAssistantText: extractLastOpenAiAssistantText,
    truncateStateForContextRetry: truncateOpenAiToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateOpenAiHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (history, userInput, retryState) =>
      rebuildOpenAiToolAgentStateAfterCompaction(
        history,
        userInput,
        retryState,
        params.workspacePath,
        hostMetadata.rules.enabledRules,
        hostMetadata.skills.enabledSkillCatalog,
        params.modelConfig.model,
        hostMetadata.planMetadata,
        [],
      ),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(params.workspacePath, text),
    onEvent: (event) => tracker.handleEvent(event),
  });

  let result;
  try {
    result = await runtime.submitUserTurn(params.scenario.userPrompt);
  } catch (error) {
    result = {
      kind: 'failed',
      error: renderError(error),
      requestTrace: [],
      toolExecutions: [],
      compactions: [],
    };
  }

  const normalized = normalizeRuntimeResult(result);
  if (normalized.status === 'completed') {
    tracker.info('completed');
  } else {
    tracker.info('failed');
  }

  const assistantPath = path.join(params.artifactsDir, `${params.candidateId}-assistant.txt`);
  const eventsPath = path.join(params.artifactsDir, `${params.candidateId}-events.log`);
  const requestTracePath = path.join(params.artifactsDir, `${params.candidateId}-request-trace.json`);
  const toolExecutionsPath = path.join(params.artifactsDir, `${params.candidateId}-tool-executions.json`);
  const workspaceSummaryPath = path.join(params.artifactsDir, `${params.candidateId}-workspace-summary.txt`);

  await writeFile(assistantPath, `${normalized.outputText}\n`, 'utf8');
  await writeFile(eventsPath, `${tracker.lines.join('\n')}\n`, 'utf8');
  await writeJsonFile(requestTracePath, normalized.requestTrace);
  await writeJsonFile(toolExecutionsPath, normalized.toolExecutions);
  await writeFile(workspaceSummaryPath, await collectWorkspaceSummary(params.workspacePath), 'utf8');

  return {
    record: {
      id: params.candidateId,
      label: params.label,
      sourceRef: formatCandidateSourceRef(params.comparison, params.candidateId),
      ...(params.candidateId === 'candidate'
        ? { diffFingerprint: params.comparison.diffFingerprint }
        : {}),
      modelConfigFingerprint: sha256(stableJsonStringify(redactModelConfig(params.modelConfig))),
      systemPromptFingerprint: sha256(stableJsonStringify(initialState.messages[0] ?? null)),
      toolSchemaFingerprint: sha256(stableJsonStringify(toolDefinitionsJson)),
      workspaceIsolationId: path.basename(params.workspacePath),
      outputText: normalized.outputText,
      artifactPaths: [
        params.workspacePath,
        assistantPath,
        eventsPath,
        requestTracePath,
        toolExecutionsPath,
        workspaceSummaryPath,
      ],
      traceSummary: tracker.buildTraceSummary(),
    },
  };
}

function normalizeRuntimeResult(result) {
  switch (result.kind) {
    case 'completed':
      return {
        status: 'completed',
        outputText: nonEmpty(result.assistantText, '[empty assistant output]'),
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    case 'failed':
      return {
        status: 'failed',
        outputText: `[run failed] ${nonEmpty(result.error, 'unknown error')}`,
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    case 'requires-approval':
      return {
        status: 'failed',
        outputText: `[run blocked by approval] ${nonEmpty(result.approval.prompt, 'approval required')}`,
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    case 'requires-questions':
      return {
        status: 'failed',
        outputText: `[run blocked by ask_questions] ${result.questions.questions.title ?? result.questions.toolName}`,
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    default:
      return {
        status: 'failed',
        outputText: '[run failed] unknown runtime result',
        requestTrace: [],
        toolExecutions: [],
      };
  }
}

class EvalHostToolExecutor {
  constructor(service, tracker, options) {
    this.service = service;
    this.tracker = tracker;
    this.bypassApprove = options.bypassApprove;
    this.createToolExecutionTextOutput = options.createToolExecutionTextOutput;
    this.unknownToolHelpers = options.unknownToolHelpers;
    this.hostToolDefinitionsCache = options.buildBuiltinHostToolDefinitions(service.toolDefinitionEnvironment());
  }

  toolDefinitionsJson() {
    return this.hostToolDefinitionsCache;
  }

  parseCommand(message) {
    return this.service.parseCommand(message);
  }

  async requestFromFunctionCall(name, argumentsJson) {
    const availableDefinitions = this.toolDefinitionsJson();
    try {
      return await this.service.requestFromFunctionCall(name, argumentsJson);
    } catch (error) {
      const { enrichUnknownToolError, toolNamesFromDefinitions } = this.unknownToolHelpers ?? {};
      if (typeof enrichUnknownToolError !== 'function' || typeof toolNamesFromDefinitions !== 'function') {
        throw error;
      }
      throw enrichUnknownToolError(
        error,
        name,
        toolNamesFromDefinitions(availableDefinitions),
      );
    }
  }

  async authorize(request) {
    const decision = await this.service.authorize(request);
    if (decision.kind !== 'need-approval' || !this.bypassApprove) {
      return decision;
    }

    // TODO: the compare runner currently only supports "block" or "bypass approvals"; interactive y/n approval or a finer-grained allowlist could be added later.
    this.tracker.recordApprovalBypass(request.name, decision.prompt);
    return { kind: 'allowed' };
  }

  rememberApproval(target, scope) {
    return this.service.rememberApproval(target, scope);
  }

  async execute(request) {
    const output = await this.service.execute(request);
    return normalizeToolExecutionOutput(output);
  }

  attachRequestMetadata(request, metadata) {
    return this.service.attachRequestMetadata
      ? this.service.attachRequestMetadata(request, metadata)
      : request;
  }

  async continueAfterQuestions(request, result) {
    if (!request || request.name !== 'extension_tool') {
      return undefined;
    }
    return {
      ...request,
      questions_result: result,
    };
  }

  shouldExecuteInBackground(request) {
    return this.service.shouldExecuteInBackground?.(request) ?? false;
  }

  backgroundStatusText(request) {
    return this.service.backgroundStatusText?.(request);
  }

  startMcpBackgroundRefresh() {
    this.service.startMcpBackgroundRefresh();
  }

  mcpStatusSnapshot() {
    return this.service.mcpStatusSnapshot();
  }

  addMcpServer(name, config) {
    return this.service.addMcpServer(name, config);
  }

  listMcpServers() {
    return this.service.listMcpServers();
  }

  inspectMcpServer(name) {
    return this.service.inspectMcpServer(name);
  }

  listMcpTools(name) {
    return this.service.listMcpTools(name);
  }

  listMcpResources(name) {
    return this.service.listMcpResources(name);
  }

  readMcpResource(name, uri) {
    return this.service.readMcpResource(name, uri);
  }

  listCachedMcpPrompts(name) {
    return this.service.listCachedMcpPrompts(name);
  }

  listMcpPrompts(name) {
    return this.service.listMcpPrompts(name);
  }

  getMcpPrompt(name, prompt, argsJson) {
    return this.service.getMcpPrompt(name, prompt, argsJson);
  }
}

function normalizeToolExecutionOutput(output) {
  return normalizeToolExecutionOutputWithFactory(output, createToolExecutionTextOutputFallback);
}

function normalizeToolExecutionOutputWithFactory(output, createToolExecutionTextOutput) {
  if (typeof output === 'string') {
    return createToolExecutionTextOutput(output);
  }

  return {
    summaryText: output.summaryText,
    content: output.content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      if (part.type === 'video') {
        return { type: 'video', path: part.path };
      }
      return { type: 'image', path: part.path };
    }),
  };
}

function createToolExecutionTextOutputFallback(text) {
  return {
    summaryText: text,
    content: text.length > 0 ? [{ type: 'text', text }] : [],
  };
}

class CandidateTracker {
  constructor(candidateId, label) {
    this.candidateId = candidateId;
    this.label = label;
    this.lines = [];
    this.toolCallCount = 0;
    this.approvalRequestCount = 0;
    this.backgroundToolCount = 0;
    this.compactionCount = 0;
    this.streamingEventCount = 0;
    this.bypassApproveCount = 0;
    this.warnings = [];
  }

  info(message) {
    const line = `[${new Date().toISOString()}] [${this.candidateId}] ${message}`;
    this.lines.push(line);
    console.log(line);
  }

  handleEvent(event) {
    switch (event.kind) {
      case 'tool-call-started':
        this.toolCallCount += 1;
        this.info(`tool call: ${event.toolName}`);
        break;
      case 'tool-execution-finished':
        this.info(
          `${event.execution.failed ? 'tool failed' : 'tool finished'}: ${event.execution.toolName} | ${truncate(event.execution.output, 180)}`,
        );
        break;
      case 'approval-requested':
        this.approvalRequestCount += 1;
        this.info(`awaiting approval: ${event.approval.toolName}`);
        break;
      case 'background-tool-status':
        if (event.phase === 'started') {
          this.backgroundToolCount += 1;
        }
        this.info(
          `background tool ${event.phase === 'started' ? 'started' : 'finished'}: ${event.toolName}${event.failed ? ' | failed' : ''}`,
        );
        break;
      case 'history-compacted':
        this.compactionCount += 1;
        this.info(`context compaction: dropped=${event.droppedMessages}`);
        break;
      case 'assistant-chunk':
      case 'update-pending-assistant-thinking':
      case 'streaming-tool-preview':
        this.streamingEventCount += 1;
        break;
      default:
        break;
    }
  }

  recordApprovalBypass(toolName, prompt) {
    this.bypassApproveCount += 1;
    this.warnings.push(`bypass-approved risky tool ${toolName}`);
    this.info(`approval bypassed: ${toolName} | ${truncate(prompt, 120)}`);
  }

  buildTraceSummary() {
    const warnings = [...new Set([
      ...this.warnings,
      ...(this.bypassApproveCount > 0
        ? [`bypass-approved ${this.bypassApproveCount} risky tool call(s)`]
        : []),
    ])];
    return {
      toolCallCount: this.toolCallCount,
      approvalRequestCount: this.approvalRequestCount,
      backgroundToolCount: this.backgroundToolCount,
      compactionCount: this.compactionCount,
      streamingEventCount: this.streamingEventCount,
      warnings,
    };
  }
}

async function collectWorkspaceSummary(workspacePath) {
  const status = (await git(workspacePath, ['status', '--short', '--untracked-files=all'])).stdout.trim();
  const diff = (await git(workspacePath, ['diff', '--stat', '--no-ext-diff'])).stdout.trim();
  const stagedDiff = (await git(workspacePath, ['diff', '--cached', '--stat', '--no-ext-diff'])).stdout.trim();
  return [
    `[workspace] ${workspacePath}`,
    '',
    '[status]',
    status || '(clean)',
    '',
    '[diff]',
    diff || '(no unstaged diff)',
    '',
    '[cached diff]',
    stagedDiff || '(no staged diff)',
    '',
  ].join('\n');
}

async function createExecutionWorkspace(workspaceSource, workspacePath) {
  if (workspaceSource) {
    await createCopiedExecutionWorkspace(workspaceSource, workspacePath);
    return;
  }

  await createEmptyExecutionWorkspace(workspacePath);
}

async function createCopiedExecutionWorkspace(sourcePath, workspacePath) {
  await validateWorkspaceSource(sourcePath);
  await cp(sourcePath, workspacePath, {
    recursive: true,
    force: true,
    filter: (source) => !shouldSkipWorkspaceCopyPath(source, sourcePath),
  });
  await initializeWorkspaceGitRepo(workspacePath, `workspace-source ${sourcePath}`);
}

function shouldSkipWorkspaceCopyPath(source, root) {
  const relative = path.relative(root, source);
  if (!relative) {
    return false;
  }

  const segments = relative.split(path.sep);
  return segments.some((segment) => segment === '.git' || segment === 'node_modules');
}

async function createRuntimeSourceSnapshot(repoRoot, workspacePath, ref) {
  await createIsolatedWorkspaceSnapshot(repoRoot, workspacePath, ref);
}

async function createIsolatedWorkspaceSnapshot(repoRoot, workspacePath, ref) {
  await mkdir(workspacePath, { recursive: true });

  const archivePath = path.join(path.dirname(workspacePath), `${path.basename(workspacePath)}.tar`);
  try {
    await git(repoRoot, ['archive', '--format=tar', '-o', archivePath, ref]);
    await extractArchiveWithNodeTar(repoRoot, archivePath, workspacePath);
  } finally {
    await rm(archivePath, { force: true });
  }

  await initializeWorkspaceGitRepo(workspacePath, ref);
}

async function createEmptyExecutionWorkspace(workspacePath) {
  await mkdir(workspacePath, { recursive: true });
  await git(workspacePath, ['init', '--quiet']);
  await git(workspacePath, ['config', 'user.name', 'Spirit Eval']);
  await git(workspacePath, ['config', 'user.email', 'spirit-eval@example.invalid']);
}

async function extractArchiveWithNodeTar(repoRoot, archivePath, workspacePath) {
  const repoRequire = createRequire(path.join(repoRoot, 'package.json'));
  let tar;
  try {
    tar = repoRequire('tar');
  } catch {
    throw new Error('Missing the Node tar dependency, cannot unpack git archive. Run pnpm install in the repo root first.');
  }
  if (!tar || typeof tar.x !== 'function') {
    throw new Error('Cannot load tar.x(); compare runner cannot unpack the snapshot.');
  }

  await tar.x({
    file: archivePath,
    cwd: workspacePath,
    strict: true,
  });
}

async function linkWorkspaceNodeModules(repoRoot, workspacePath) {
  const rootNodeModules = path.join(repoRoot, 'node_modules');
  const targetRootNodeModules = path.join(workspacePath, 'node_modules');

  if (!existsSync(rootNodeModules)) {
    throw new Error(`node_modules is missing in this repo, cannot reuse dependencies for the isolated workspace: ${rootNodeModules}`);
  }

  if (!existsSync(targetRootNodeModules)) {
    await symlink(rootNodeModules, targetRootNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
  }

  const packageRelativePaths = [
    'packages/agent-core/node_modules',
    'packages/host-internal/node_modules',
    'packages/extension-toolkit/node_modules',
  ];

  for (const relativePath of packageRelativePaths) {
    const sourceNodeModules = path.join(repoRoot, relativePath);
    const targetNodeModules = path.join(workspacePath, relativePath);

    if (!existsSync(sourceNodeModules)) {
      continue;
    }

    if (existsSync(targetNodeModules)) {
      continue;
    }

    await mkdir(path.dirname(targetNodeModules), { recursive: true });
    await symlink(sourceNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

async function applyPatchToWorkspace(workspacePath, patchText) {
  const patchPath = path.join(workspacePath, '.spirit-eval-staged.patch');
  await writeFile(patchPath, patchText, 'utf8');
  try {
    await git(workspacePath, ['apply', '--binary', '--whitespace=nowarn', patchPath]);
  } finally {
    await rm(patchPath, { force: true });
  }
}

async function git(cwd, args) {
  return execFile('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

async function initializeWorkspaceGitRepo(workspacePath, ref) {
  await git(workspacePath, ['init', '--quiet']);
  await git(workspacePath, ['config', 'user.name', 'Spirit Eval']);
  await git(workspacePath, ['config', 'user.email', 'spirit-eval@example.invalid']);
  await git(workspacePath, ['add', '--all']);
  await git(workspacePath, ['commit', '--quiet', '--allow-empty', '-m', `snapshot ${ref}`]);
}

async function loadWorkspaceRuntimeModules(workspacePath) {
  await buildWorkspacePackages(workspacePath);

  const [
    runtimeModule,
    hostToolsModule,
    portsModule,
    transportFactoryModule,
    toolAgentHelpersModule,
    openAiCompatModule,
    discoveryModule,
    hostInternalToolsModule,
  ] = await Promise.all([
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/runtime.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/host-tools.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/ports.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/openai/transport-factory.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/openai/tool-agent-helpers.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/openai/openai-compat.js'),
    importModuleFromWorkspace(workspacePath, 'packages/host-internal/dist/discovery.js'),
    importModuleFromWorkspace(workspacePath, 'packages/host-internal/dist/tools.js'),
  ]);

  return {
    AgentRuntime: runtimeModule.AgentRuntime,
    pendingWorkspaceFilesFromInput: runtimeModule.pendingWorkspaceFilesFromInput,
    buildBuiltinHostToolDefinitions: hostToolsModule.buildBuiltinHostToolDefinitions,
    enrichUnknownToolError: hostToolsModule.enrichUnknownToolError ?? undefined,
    toolNamesFromDefinitions: hostToolsModule.toolNamesFromDefinitions ?? undefined,
    createToolExecutionTextOutput: portsModule.createToolExecutionTextOutput,
    createOpenAiCompatibleTransport: transportFactoryModule.createOpenAiCompatibleTransport,
    appendOpenAiToolResultMessage: toolAgentHelpersModule.appendOpenAiToolResultMessage,
    appendOpenAiUserLlmMessage: toolAgentHelpersModule.appendOpenAiUserLlmMessage,
    appendOpenAiUserMessage: toolAgentHelpersModule.appendOpenAiUserMessage,
    continueOpenAiToolAgentState: toolAgentHelpersModule.continueOpenAiToolAgentState,
    extractLastOpenAiAssistantText: toolAgentHelpersModule.extractLastOpenAiAssistantText,
    rebuildOpenAiToolAgentStateAfterCompaction:
      toolAgentHelpersModule.rebuildOpenAiToolAgentStateAfterCompaction,
    startOpenAiToolAgentState: toolAgentHelpersModule.startOpenAiToolAgentState,
    truncateOpenAiHistoryForCompaction: toolAgentHelpersModule.truncateOpenAiHistoryForCompaction,
    truncateOpenAiToolAgentStateForContextRetry:
      toolAgentHelpersModule.truncateOpenAiToolAgentStateForContextRetry,
    resolveOpenAiModelCompatibilityProfile: openAiCompatModule.resolveOpenAiModelCompatibilityProfile,
    loadHostInstructionMetadata: discoveryModule.loadHostInstructionMetadata,
    NodeHostToolService: hostInternalToolsModule.NodeHostToolService,
  };
}

async function buildWorkspacePackages(workspacePath) {
  await execWorkspaceCommand(workspacePath, pnpmExecutable(), [
    'exec',
    'turbo',
    'run',
    'build',
    '--filter=@spiritagent/host-internal',
    '--filter=@spiritagent/agent-core',
  ]);
}

async function execWorkspaceCommand(cwd, command, args) {
  if (process.platform === 'win32') {
    await execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return;
  }

  await execFile(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function pnpmExecutable() {
  return 'pnpm';
}

async function importModuleFromWorkspace(workspacePath, relativePath) {
  const filePath = path.join(workspacePath, relativePath);
  return import(pathToFileURL(filePath).href);
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${stableJsonStringify(value)}\n`, 'utf8');
}

function redactModelConfig(modelConfig) {
  return {
    model: modelConfig.model,
    ...(modelConfig.baseUrl ? { baseUrl: modelConfig.baseUrl } : {}),
    ...(modelConfig.reasoningEffort ? { reasoningEffort: modelConfig.reasoningEffort } : {}),
  };
}

function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, key) => {
        accumulator[key] = sortJsonValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function nonEmpty(text, fallback) {
  return text && text.trim() ? text : fallback;
}

function renderError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function printScenarioList() {
  console.log('Available scenarios:');
  for (const scenario of evalScenarios) {
    console.log(`- ${scenario.id}: ${scenario.title}`);
  }
}

function printHelp() {
  console.log('Usage: pnpm run eval:compare -- [options]');
  console.log('');
  console.log('Default comparison source: current HEAD vs staged diff.');
  console.log('Use --commit or --baseline-ref/--candidate-ref to specify before / after explicitly.');
  console.log('');
  console.log('Options:');
  console.log('  --list-scenarios          List built-in scenarios');
  console.log('  --scenario <id>          Select a built-in scenario, default tool-heavy-code-edit');
  console.log('  --prompt <text>          Provide a custom user prompt directly');
  console.log('  --title <text>           Custom scenario title, only with --prompt');
  console.log('  --objective <text>       Custom scenario objective, only with --prompt');
  console.log('  --commit <ref>           Compare the given commit against its first-parent');
  console.log('  --baseline-ref <ref>     Explicit baseline git ref; must be used with --candidate-ref');
  console.log('  --candidate-ref <ref>    Explicit candidate git ref; must be used with --baseline-ref');
  console.log('  --api-key <key>          Overrides OPENAI_API_KEY');
  console.log('  --base-url <url>         Overrides OPENAI_BASE_URL');
  console.log('  --model <id>             Overrides OPENAI_MODEL; falls back to the environment variable');
  console.log('  --reasoning-effort <v>   e.g. low / medium / high');
  console.log('  --output-dir <dir>       Required; output root for this compare, either a new non-existent path or an existing empty directory');
  console.log('  --workspace-source <dir> Copy the given workspace directory into the output directory; defaults to an empty workspace');
  console.log('  --bypass-approve         Bypass high-risk tool approvals; default blocks and records the outcome in the artifact');
}

function renderComparisonMode(mode) {
  return mode === 'git-ref' ? 'explicit git refs' : 'HEAD + staged diff';
}

function formatCandidateSourceRef(comparison, candidateId) {
  if (candidateId === 'baseline') {
    return `git:${comparison.baselineRef}`;
  }

  if (comparison.mode === 'git-ref') {
    return `git:${comparison.candidateRef}`;
  }

  return `git:${comparison.baselineRef}+staged:${comparison.diffFingerprint.slice(0, 12)}`;
}

void main();