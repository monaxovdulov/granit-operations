import type { AiTurnInput } from '../../ai-turn.js';
import type { CatalogIndexSnapshot } from '../../catalog/catalog-index.js';
import {
  CATALOG_SEARCH_TIMEOUT_MS,
  CATALOG_CATEGORY_TAXONOMY,
  createCatalogSearchTool,
  normalizeCatalogSearchInput,
  type CatalogSearchCandidate,
  type CatalogSearchTool,
  type NormalizedCatalogSearchInput,
} from '../../catalog/catalog-search-tool.js';
import { MODEL_TURN_PROMPT_ASSET } from './assets/model-turn-prompt.v1.js';
import { LIVE_V2_TONE_ASSET } from './assets/tone.v1.js';
import { liveV2GateSnapshotPlan } from './live-v2-apply-plan.js';
import {
  parseLiveV2FactsSnapshot,
  toLiveV2ModelFactsAsset,
  type LiveV2FactsSnapshot,
} from './live-v2-assets.js';
import { buildLiveV2TurnView } from './live-v2-context.js';
import type { LiveV2Gate, LiveV2TurnView } from './live-v2-contract.js';
import type {
  LiveV2DecisionGenerator,
  LiveV2GeneratorInput,
  LiveV2GateReader,
} from './live-v2-orchestrator.js';
import type {
  FinalTurnAction,
  FinalTurnResult,
  ModelTurnValidationIssue,
  ModelTurnValidationResult,
  ValidatedTurnPlan,
} from './model-turn-contract.js';
import {
  parseModelTurnAction,
  validateFinalTurnResult,
} from './model-turn-validator.js';

export type ModelTurnApplyPlan =
  | {
      kind: 'persist_reply';
      action: ValidatedTurnPlan['action'];
      replyDraft: string;
      finalTextHash: string;
      agentAllowedToReplyAfterSend?: false;
      validatedPlan: ValidatedTurnPlan;
    }
  | {
      kind: 'blocked';
      reason: 'gate_closed' | 'candidate_invalid';
      validationCode?: string;
    }
  | {
      kind: 'no_reply';
      reason:
        | 'generator_failed'
        | 'assets_invalid'
        | 'context_invalid'
        | 'gate_unavailable';
    };

export type ModelTurnTrace = {
  modelCallCount: number;
  modelCalls: Array<{
    phase: 'decision' | 'final';
    status: 'succeeded' | 'failed';
    latencyMs: number;
  }>;
  searchCatalogCalled: boolean;
  catalogSearch?: {
    status: 'succeeded' | 'empty' | 'failed' | 'timed_out';
    input: NormalizedCatalogSearchInput;
    candidateIds: string[];
    latencyMs: number;
  };
  selectedAction: FinalTurnAction | 'safe_fallback' | 'blocked';
  finalRecommendationIds: string[];
};

export type ModelTurnOutcome = {
  status:
    | 'blocked_before_generation'
    | 'context_invalid'
    | 'generator_failed'
    | 'gate_unavailable'
    | 'assets_invalid'
    | 'evaluated';
  turnView: LiveV2TurnView | null;
  validation: ModelTurnValidationResult | null;
  plan: ModelTurnApplyPlan;
  trace: ModelTurnTrace;
};

type CatalogSearchObservation = NonNullable<LiveV2GeneratorInput['catalogSearch']>;

export async function executeModelTurn(input: {
  turnInput: AiTurnInput;
  approvedFacts: LiveV2FactsSnapshot;
  catalogSnapshot?: CatalogIndexSnapshot;
  catalogSearchTool?: CatalogSearchTool;
  catalogSearchTimeoutMs?: number;
  generator: LiveV2DecisionGenerator;
  gateReader: LiveV2GateReader;
}): Promise<ModelTurnOutcome> {
  const trace = emptyTrace();
  if (gateClosed(input.turnInput.gateSnapshot)) {
    trace.selectedAction = 'blocked';
    return {
      status: 'blocked_before_generation',
      turnView: null,
      validation: null,
      plan: { kind: 'blocked', reason: 'gate_closed' },
      trace,
    };
  }

  let turnView: LiveV2TurnView;
  try {
    turnView = buildLiveV2TurnView(input.turnInput);
  } catch {
    return terminalNoReply('context_invalid', null, trace);
  }

  let facts: LiveV2FactsSnapshot;
  try {
    facts = parseLiveV2FactsSnapshot(input.approvedFacts);
  } catch {
    return terminalNoReply('assets_invalid', turnView, trace);
  }

  const assets = {
    prompt: MODEL_TURN_PROMPT_ASSET,
    tone: LIVE_V2_TONE_ASSET,
    facts: toLiveV2ModelFactsAsset(facts),
  };
  const publishedCatalogIds = new Set(
    input.catalogSnapshot?.items.map((item) => item.id) ?? [],
  );
  const first = await generate(input.generator, {
    turn: turnView,
    responseMode: 'turn_action',
    catalogTool: catalogToolDefinition(),
    assets,
  }, 'decision', trace);

  let validation: ModelTurnValidationResult;
  if (!first.ok) {
    validation = safeFallback(input.turnInput, 'final_output_invalid');
  } else {
    const action = parseModelTurnAction(first.value);
    if (!action) {
      const issue = isSearchAction(first.value)
        ? 'tool_arguments_invalid'
        : 'final_output_invalid';
      validation = safeFallback(input.turnInput, issue);
    } else if (action.type === 'final') {
      validation = validateFinalTurnResult({
        value: action.result,
        turnInput: input.turnInput,
        publishedCatalogIds,
      });
      if (!validation.ok) {
        validation = safeFallback(input.turnInput, 'final_output_invalid');
      }
    } else {
      validation = await executeSearchPath({
        input,
        turnView,
        assets,
        searchInput: normalizeCatalogSearchInput(action.input),
        publishedCatalogIds,
        trace,
      });
    }
  }

  const plan = validation.plan;
  trace.selectedAction = usesSafeFallback(plan)
    ? 'safe_fallback'
    : plan.responseAction;
  trace.finalRecommendationIds = [...plan.recommendationIds];

  let freshGate: LiveV2Gate;
  try {
    freshGate = await input.gateReader.readGate();
  } catch {
    return {
      status: 'gate_unavailable',
      turnView,
      validation,
      plan: { kind: 'no_reply', reason: 'gate_unavailable' },
      trace,
    };
  }

  if (gateClosed(freshGate)) {
    trace.selectedAction = 'blocked';
    return {
      status: 'evaluated',
      turnView: { ...turnView, gate: freshGate },
      validation,
      plan: { kind: 'blocked', reason: 'gate_closed' },
      trace,
    };
  }

  return {
    status: 'evaluated',
    turnView: { ...turnView, gate: freshGate },
    validation,
    plan: {
      kind: 'persist_reply',
      action: plan.action,
      replyDraft: plan.finalText,
      finalTextHash: plan.finalTextHash,
      ...(plan.handoffAction
        ? { agentAllowedToReplyAfterSend: false as const }
        : {}),
      validatedPlan: plan,
    },
    trace,
  };
}

async function executeSearchPath(input: {
  input: Parameters<typeof executeModelTurn>[0];
  turnView: LiveV2TurnView;
  assets: LiveV2GeneratorInput['assets'];
  searchInput: NormalizedCatalogSearchInput;
  publishedCatalogIds: ReadonlySet<string>;
  trace: ModelTurnTrace;
}): Promise<Extract<ModelTurnValidationResult, { ok: true }>> {
  const startedAt = Date.now();
  const searchTool =
    input.input.catalogSearchTool ??
    (input.input.catalogSnapshot
      ? createCatalogSearchTool(input.input.catalogSnapshot)
      : null);
  let status: CatalogSearchObservation['status'] = 'failed';
  let candidates: readonly CatalogSearchCandidate[] = [];

  if (searchTool) {
    const searched = await runCatalogSearch(
      searchTool,
      input.searchInput,
      input.input.catalogSearchTimeoutMs ?? CATALOG_SEARCH_TIMEOUT_MS,
    );
    status = searched.status;
    candidates = searched.candidates;
  }

  input.trace.searchCatalogCalled = true;
  input.trace.catalogSearch = {
    status,
    input: input.searchInput,
    candidateIds: candidates.map((candidate) => candidate.id),
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
  const catalogSearch: CatalogSearchObservation = {
    status,
    input: input.searchInput,
    candidates,
  };
  const second = await generate(input.input.generator, {
    turn: input.turnView,
    responseMode: 'final_result',
    catalogTool: catalogToolDefinition(),
    catalogSearch,
    assets: input.assets,
  }, 'final', input.trace);

  if (!second.ok) return safeFallback(input.input.turnInput, 'final_output_invalid');
  if (isSearchAction(second.value)) {
    return safeFallback(input.input.turnInput, 'tool_loop_blocked');
  }
  const validation = validateFinalTurnResult({
    value: second.value,
    turnInput: input.input.turnInput,
    catalogCandidates: candidates,
    publishedCatalogIds: input.publishedCatalogIds,
  });
  return validation.ok
    ? validation
    : safeFallback(input.input.turnInput, 'final_output_invalid');
}

async function runCatalogSearch(
  tool: CatalogSearchTool,
  input: NormalizedCatalogSearchInput,
  timeoutMs: number,
): Promise<{
  status: CatalogSearchObservation['status'];
  candidates: readonly CatalogSearchCandidate[];
}> {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort('catalog_search_timeout');
  }, timeoutMs);

  try {
    const candidates = await Promise.race([
      tool.search(input, controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        });
      }),
    ]);
    const bounded = candidates.slice(0, input.limit);
    return {
      status: bounded.length > 0 ? 'succeeded' : 'empty',
      candidates: bounded,
    };
  } catch {
    return { status: didTimeout ? 'timed_out' : 'failed', candidates: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function generate(
  generator: LiveV2DecisionGenerator,
  input: LiveV2GeneratorInput,
  phase: 'decision' | 'final',
  trace: ModelTurnTrace,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const startedAt = Date.now();
  trace.modelCallCount += 1;
  try {
    const value = await generator.generateDecision(input);
    trace.modelCalls.push({
      phase,
      status: 'succeeded',
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
    return { ok: true, value };
  } catch {
    trace.modelCalls.push({
      phase,
      status: 'failed',
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
    return { ok: false };
  }
}

function safeFallback(
  turnInput: AiTurnInput,
  issue: ModelTurnValidationIssue,
): Extract<ModelTurnValidationResult, { ok: true }> {
  const output: FinalTurnResult = {
    version: 'granit_model_turn.v2',
    action: 'answer',
    message:
      'Сейчас не удалось подготовить точный подбор. Могу помочь с общими вопросами или продолжить без карточек.',
    clarifyingQuestion: null,
    statePatches: [],
    recommendationIds: [],
    handoffIntent: null,
  };
  const validated = validateFinalTurnResult({ value: output, turnInput });
  if (!validated.ok) throw new Error('Safe model-turn fallback is invalid');
  return {
    ...validated,
    plan: Object.freeze({
      ...validated.plan,
      validationResults: [...validated.plan.validationResults, issue],
    }),
  };
}

function usesSafeFallback(plan: ValidatedTurnPlan): boolean {
  return plan.validationResults.some(
    (issue) =>
      issue === 'tool_arguments_invalid' ||
      issue === 'tool_loop_blocked' ||
      issue === 'final_output_invalid',
  );
}

function isSearchAction(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'search_catalog'
  );
}

function gateClosed(gate: LiveV2Gate): boolean {
  return liveV2GateSnapshotPlan(gate) !== null;
}

function catalogToolDefinition(): NonNullable<LiveV2GeneratorInput['catalogTool']> {
  return {
    name: 'search_catalog',
    maxResults: 8,
    categories: CATALOG_CATEGORY_TAXONOMY,
  };
}

function emptyTrace(): ModelTurnTrace {
  return {
    modelCallCount: 0,
    modelCalls: [],
    searchCatalogCalled: false,
    selectedAction: 'safe_fallback',
    finalRecommendationIds: [],
  };
}

function terminalNoReply(
  reason: 'context_invalid' | 'assets_invalid' | 'generator_failed',
  turnView: LiveV2TurnView | null,
  trace: ModelTurnTrace,
): ModelTurnOutcome {
  return {
    status: reason,
    turnView,
    validation: null,
    plan: { kind: 'no_reply', reason },
    trace,
  };
}
