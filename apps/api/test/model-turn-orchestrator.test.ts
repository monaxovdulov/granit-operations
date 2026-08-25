import { describe, expect, it, vi } from 'vitest';

import { buildStageASiteWidgetAiTurnInput } from '../src/modules/ai/ai-turn.js';
import { loadPinnedCatalogIndex } from '../src/modules/ai/catalog/pinned-catalog-index.js';
import { executeModelTurn } from '../src/modules/ai/profiles/live-v2/model-turn-orchestrator.js';
import { TEST_LIVE_V2_FACTS } from './fixtures/live-v2-synthetic.v1.js';

describe('bounded model-turn orchestration', () => {
  it('accepts a final answer without calling search_catalog', async () => {
    const generator = vi.fn(async () => finalAction('answer'));
    const search = vi.fn();
    const outcome = await execute({ generator, search });

    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: { responseAction: 'answer', recommendationIds: [] },
    });
    expect(generator).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
    expect(outcome.trace).toMatchObject({
      modelCallCount: 1,
      searchCatalogCalled: false,
      selectedAction: 'answer',
    });
  });

  it('runs one search and a second call of the same model', async () => {
    const generator = vi
      .fn()
      .mockResolvedValueOnce({
        version: 'granit_model_turn.v2',
        type: 'search_catalog',
        input: {
          query: 'вертикальные памятники',
          categories: ['monuments'],
          limit: 20,
        },
      })
      .mockResolvedValueOnce(finalResult('recommend', ['ent_ae4234fc4a358865']));
    const search = vi.fn(async () => [candidate('ent_ae4234fc4a358865')]);
    const outcome = await execute({ generator, search });

    expect(generator).toHaveBeenCalledTimes(2);
    expect(generator.mock.calls[0]?.[0]).toMatchObject({ responseMode: 'turn_action' });
    expect(generator.mock.calls[1]?.[0]).toMatchObject({
      responseMode: 'final_result',
      catalogSearch: {
        status: 'succeeded',
        candidates: [expect.objectContaining({ id: 'ent_ae4234fc4a358865' })],
      },
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 8 }),
      expect.any(AbortSignal),
    );
    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: {
        responseAction: 'recommend',
        recommendationIds: ['ent_ae4234fc4a358865'],
      },
    });
    expect(outcome.trace).toMatchObject({
      modelCallCount: 2,
      searchCatalogCalled: true,
      catalogSearch: {
        status: 'succeeded',
        candidateIds: ['ent_ae4234fc4a358865'],
      },
    });
  });

  it('stops a second search request and returns a safe text-only fallback', async () => {
    const generator = vi.fn(async () => ({
      version: 'granit_model_turn.v2',
      type: 'search_catalog',
      input: { query: 'памятники' },
    }));
    const outcome = await execute({
      generator,
      search: vi.fn(async () => [candidate('ent_1111111111111111')]),
    });

    expect(generator).toHaveBeenCalledTimes(2);
    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: {
        responseAction: 'answer',
        recommendationIds: [],
        validationResults: expect.arrayContaining(['tool_loop_blocked']),
      },
    });
  });

  it('bounds a hanging search and still asks the model for a useful final answer', async () => {
    const generator = vi
      .fn()
      .mockResolvedValueOnce({
        version: 'granit_model_turn.v2',
        type: 'search_catalog',
        input: { query: 'памятники' },
      })
      .mockResolvedValueOnce(finalResult('answer'));
    const search = vi.fn(
      async () => new Promise<never>(() => undefined),
    );
    const outcome = await execute({ generator, search, timeoutMs: 5 });

    expect(generator).toHaveBeenCalledTimes(2);
    expect(generator.mock.calls[1]?.[0]).toMatchObject({
      catalogSearch: { status: 'timed_out', candidates: [] },
    });
    expect(outcome.plan.kind).toBe('persist_reply');
  });

  it('uses a safe fallback for malformed tool arguments and malformed final output', async () => {
    const malformedTool = await execute({
      generator: vi.fn(async () => ({
        version: 'granit_model_turn.v2',
        type: 'search_catalog',
        input: { query: '', limit: -1 },
      })),
      search: vi.fn(),
    });
    const malformedFinal = await execute({
      generator: vi.fn(async () => ({ version: 'granit_model_turn.v2' })),
      search: vi.fn(),
    });

    for (const outcome of [malformedTool, malformedFinal]) {
      expect(outcome.plan).toMatchObject({
        kind: 'persist_reply',
        validatedPlan: { responseAction: 'answer', recommendationIds: [] },
      });
      expect(outcome.trace.selectedAction).toBe('safe_fallback');
    }
  });

  it('persists a safe fallback when the model call fails and retains failure evidence', async () => {
    const outcome = await execute({
      generator: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
      search: vi.fn(),
    });

    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: {
        responseAction: 'answer',
        recommendationIds: [],
        validationResults: expect.arrayContaining(['final_output_invalid']),
      },
    });
    expect(outcome.trace).toMatchObject({
      modelCallCount: 1,
      selectedAction: 'safe_fallback',
      modelCalls: [{ phase: 'decision', status: 'failed' }],
    });
  });

  it('passes an empty or failed search result as data and never invents cards', async () => {
    for (const search of [
      vi.fn(async () => []),
      vi.fn(async () => {
        throw new Error('catalog unavailable');
      }),
    ]) {
      const generator = vi
        .fn()
        .mockResolvedValueOnce({
          version: 'granit_model_turn.v2',
          type: 'search_catalog',
          input: { query: 'памятники' },
        })
        .mockResolvedValueOnce(finalResult('answer'));
      const outcome = await execute({ generator, search });

      expect(outcome.plan).toMatchObject({
        kind: 'persist_reply',
        validatedPlan: { recommendationIds: [] },
      });
      expect(generator.mock.calls[1]?.[0]).toMatchObject({
        catalogSearch: { candidates: [] },
      });
    }
  });
});

async function execute(input: {
  generator: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  timeoutMs?: number;
}) {
  return executeModelTurn({
    turnInput: turnInput(),
    approvedFacts: TEST_LIVE_V2_FACTS,
    catalogSnapshot: await loadPinnedCatalogIndex(),
    generator: { generateDecision: input.generator },
    catalogSearchTool: { search: input.search },
    catalogSearchTimeoutMs: input.timeoutMs,
    gateReader: {
      async readGate() {
        return { aiState: 'ai_collecting_info', agentAllowedToReply: true };
      },
    },
  });
}

function finalAction(
  action: 'answer' | 'clarify' | 'recommend' | 'recommend_and_clarify',
) {
  return {
    version: 'granit_model_turn.v2',
    type: 'final',
    result: finalResult(action),
  };
}

function finalResult(
  action: 'answer' | 'clarify' | 'recommend' | 'recommend_and_clarify',
  recommendationIds: string[] = [],
) {
  const hasQuestion = action === 'clarify' || action === 'recommend_and_clarify';
  return {
    version: 'granit_model_turn.v2',
    action,
    message: 'Показываю подходящие варианты.',
    clarifyingQuestion: hasQuestion
      ? { text: 'Какое направление вам ближе?', target: 'monumentType' }
      : null,
    statePatches: [],
    recommendationIds,
    handoffIntent: null,
  };
}

function candidate(id: string) {
  return {
    id,
    title: 'Арфа',
    category: 'monuments' as const,
    group: 'vertical',
    shortDescription: 'Вертикальные памятники',
  };
}

function turnInput() {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: '11111111-1111-4111-8111-111111111111',
    publicMessageId: '22222222-2222-4222-8222-222222222222',
    requestFingerprint: 'a'.repeat(64),
    submittedAt: '2026-08-25T12:00:00.000Z',
    text: 'Покажи варианты памятников',
    page: {
      url: 'https://example.test/catalog.html',
      widgetInstanceId: 'orchestrator-test',
    },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: { locale: 'ru-RU' },
    gate: { aiState: 'ai_collecting_info', agentAllowedToReply: true },
  });
}
