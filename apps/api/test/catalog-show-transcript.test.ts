import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AiKnownSlots } from '../src/modules/ai/ai-dialog-contract.js';
import { buildStageASiteWidgetAiTurnInput } from '../src/modules/ai/ai-turn.js';
import { buildCatalogReferences } from '../src/modules/ai/catalog/catalog-index.js';
import {
  PINNED_CATALOG_CONTENT_HASH,
  PINNED_CATALOG_SOURCE_BASE_SHA,
  PINNED_CATALOG_SOURCE_REPOSITORY,
  loadPinnedCatalogIndex,
} from '../src/modules/ai/catalog/pinned-catalog-index.js';
import { executeModelTurn } from '../src/modules/ai/profiles/live-v2/model-turn-orchestrator.js';
import { TEST_LIVE_V2_FACTS } from './fixtures/live-v2-synthetic.v1.js';

const TRANSCRIPT = [
  'Покажи варианты памятников',
  'вертикальный',
  'пока не знаю',
  'покажи',
  'Сколько стоит памятник 100×50? Нужно установить до 15 мая',
  'москва',
  'не знаю пока',
  'не знаю',
  'да',
  'А другие?',
] as const;
const SHOW_TURNS = new Set([0, 3, 9]);

describe('catalog multi-turn transcripts', () => {
  it('keeps durable slots and uses one bounded search plus a second model call on show turns', async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const knownSlots: AiKnownSlots = {};
    const context: Array<{
      publicMessageId: string;
      direction: 'inbound' | 'outbound';
      senderRole: 'visitor' | 'ai_assistant';
      contentType: 'text';
      submittedAt: string;
      text: string;
    }> = [];
    const referencesByTurn = new Map<
      number,
      ReturnType<typeof buildCatalogReferences>
    >();
    let modelCalls = 0;
    let clarificationCount = 0;

    for (const [turnIndex, text] of TRANSCRIPT.entries()) {
      const submittedAt = `2026-08-25T12:${String(turnIndex).padStart(2, '0')}:00.000Z`;
      const inboundPublicMessageId = randomUUID();
      const turnInput = buildTurnInput({
        text,
        submittedAt,
        inboundPublicMessageId,
        context,
        knownSlots,
      });
      const outcome = await executeModelTurn({
        turnInput,
        approvedFacts: TEST_LIVE_V2_FACTS,
        catalogSnapshot: snapshot,
        generator: {
          async generateDecision(input) {
            modelCalls += 1;
            if (input.responseMode === 'turn_action') {
              return SHOW_TURNS.has(turnIndex)
                ? searchAction('памятники', ['monuments'])
                : finalAction(transcriptResult(turnIndex, []));
            }
            const candidates = input.catalogSearch?.candidates ?? [];
            expect(candidates.length).toBeLessThanOrEqual(8);
            expect(JSON.stringify(candidates)).not.toContain('catalog.html');
            return transcriptResult(turnIndex, candidates);
          },
        },
        gateReader: openGate,
      });

      expect(outcome.plan.kind).toBe('persist_reply');
      if (outcome.plan.kind !== 'persist_reply') throw new Error('turn was lost');
      const plan = outcome.plan.validatedPlan;
      if (plan.action === 'ask_clarifying_question') clarificationCount += 1;
      applyPatches(knownSlots, plan.appliedPatches, submittedAt);
      referencesByTurn.set(
        turnIndex,
        buildCatalogReferences(snapshot, plan.recommendationIds),
      );
      context.push(
        message(inboundPublicMessageId, 'inbound', 'visitor', submittedAt, text),
        message(randomUUID(), 'outbound', 'ai_assistant', submittedAt, plan.finalText),
      );
    }

    expect(modelCalls).toBe(TRANSCRIPT.length + SHOW_TURNS.size);
    expect(
      [...SHOW_TURNS].every(
        (index) => (referencesByTurn.get(index)?.length ?? 0) >= 1,
      ),
    ).toBe(true);
    expect(
      [...referencesByTurn.values()].every((references) => references.length <= 3),
    ).toBe(true);
    expect(knownSlots.monumentType?.value).toBe('вертикальный памятник');
    expect(knownSlots.size?.value).toBe('100×50');
    expect(knownSlots.desiredTiming?.value).toBe('до 15 мая');
    expect(knownSlots.city?.value).toBe('москва');
    expect(clarificationCount).toBe(0);
  });

  it.each([
    {
      name: 'direct show',
      message: 'Покажи варианты памятников',
      input: { query: 'памятники', categories: ['monuments'] },
      expectedCategories: ['monuments'],
    },
    {
      name: 'broad request',
      message: 'Хочу что-нибудь красивое, но пока не знаю что',
      input: { query: 'разные варианты оформления захоронения' },
      expectedCategories: [],
    },
    {
      name: 'mixed category',
      message: 'Покажи памятник и ограду',
      input: {
        query: 'памятники ограды',
        categories: ['monuments', 'fences'],
      },
      expectedCategories: ['monuments', 'fences'],
    },
    {
      name: 'material only',
      message: 'Что есть из гранита?',
      input: { query: 'гранит', material: 'гранит' },
      expectedCategories: [],
    },
    {
      name: 'semantic formulation',
      message: 'Хочу закрыть землю камнем, чтобы не росла трава',
      input: {
        query: 'гранитные цоколи каменное закрытие земли',
        categories: ['granite-plinths'],
      },
      expectedCategories: ['granite-plinths'],
    },
  ])('$name', async ({ message: text, input, expectedCategories }) => {
    const snapshot = await loadPinnedCatalogIndex();
    const modelInputs: unknown[] = [];
    const outcome = await executeModelTurn({
      turnInput: buildTurnInput({ text }),
      approvedFacts: TEST_LIVE_V2_FACTS,
      catalogSnapshot: snapshot,
      generator: {
        async generateDecision(modelInput) {
          modelInputs.push(modelInput);
          if (modelInput.responseMode === 'turn_action') {
            return searchAction(input.query, input.categories, input.material);
          }
          const ids = (modelInput.catalogSearch?.candidates ?? [])
            .slice(0, 3)
            .map((candidate) => candidate.id);
          return finalResult(ids.length > 0 ? 'recommend' : 'answer', ids);
        },
      },
      gateReader: openGate,
    });

    expect(modelInputs).toHaveLength(2);
    expect(outcome.trace.catalogSearch?.input.categories ?? []).toEqual(
      expectedCategories,
    );
    expect(outcome.trace.catalogSearch?.candidateIds.length).toBeGreaterThan(0);
    expect(outcome.plan.kind).toBe('persist_reply');
  });

  it('answers an informational question without search_catalog', async () => {
    const generatorInputs: unknown[] = [];
    const outcome = await executeModelTurn({
      turnInput: buildTurnInput({ text: 'Как ухаживать за гранитным памятником?' }),
      approvedFacts: TEST_LIVE_V2_FACTS,
      catalogSnapshot: await loadPinnedCatalogIndex(),
      generator: {
        async generateDecision(input) {
          generatorInputs.push(input);
          return finalAction(finalResult('answer'));
        },
      },
      gateReader: openGate,
    });

    expect(generatorInputs).toHaveLength(1);
    expect(outcome.trace.searchCatalogCalled).toBe(false);
    expect(outcome.plan.kind).toBe('persist_reply');
  });

  it('allows one useful question without forcing catalog search', async () => {
    const outcome = await executeModelTurn({
      turnInput: buildTurnInput({ text: 'Не знаю, памятник или комплекс' }),
      approvedFacts: TEST_LIVE_V2_FACTS,
      catalogSnapshot: await loadPinnedCatalogIndex(),
      generator: {
        async generateDecision() {
          return finalAction({
            ...finalResult('answer'),
            action: 'clarify',
            clarifyingQuestion: {
              text: 'Вам ближе отдельный памятник или единый семейный комплекс?',
              target: 'monumentType',
            },
          });
        },
      },
      gateReader: openGate,
    });

    expect(outcome.trace).toMatchObject({
      modelCallCount: 1,
      searchCatalogCalled: false,
      selectedAction: 'clarify',
    });
    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: { action: 'ask_clarifying_question' },
    });
  });

  it('can recommend first and ask one optional question', async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const outcome = await executeModelTurn({
      turnInput: buildTurnInput({ text: 'Хочу что-нибудь красивое, но пока не знаю что' }),
      approvedFacts: TEST_LIVE_V2_FACTS,
      catalogSnapshot: snapshot,
      generator: {
        async generateDecision(input) {
          if (input.responseMode === 'turn_action') {
            return searchAction('разные варианты оформления захоронения');
          }
          const ids = (input.catalogSearch?.candidates ?? [])
            .slice(0, 3)
            .map((candidate) => candidate.id);
          return {
            ...finalResult('recommend', ids),
            action: 'recommend_and_clarify',
            clarifyingQuestion: {
              text: 'Какое направление из показанных вам ближе?',
              target: 'monumentType',
            },
          };
        },
      },
      gateReader: openGate,
    });

    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: {
        responseAction: 'recommend_and_clarify',
        action: 'ask_clarifying_question',
      },
    });
  });

  it('shows saved-field provenance and lets the current message replace an old filter', async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const knownSlots: AiKnownSlots = {
      material: {
        value: 'чёрный гранит',
        source: 'ai_extraction',
        confidence: 0.9,
        updatedAt: '2026-08-25T11:00:00.000Z',
      },
    };
    const outcome = await executeModelTurn({
      turnInput: buildTurnInput({
        text: 'Передумал, хочу белый мрамор',
        knownSlots,
      }),
      approvedFacts: TEST_LIVE_V2_FACTS,
      catalogSnapshot: snapshot,
      generator: {
        async generateDecision(input) {
          if (input.responseMode === 'turn_action') {
            expect(input.turn.knownSlots.material).toBe('чёрный гранит');
            expect(input.turn.knownSlotProvenance.material).toEqual({
              origin: 'saved_field',
              source: 'ai_extraction',
            });
            return searchAction('белый мрамор', undefined, 'белый мрамор');
          }
          return finalResult('answer');
        },
      },
      gateReader: openGate,
    });

    expect(outcome.trace.catalogSearch?.input).toMatchObject({
      query: 'белый мрамор',
      material: 'белый мрамор',
    });
    expect(outcome.trace.catalogSearch?.input.material).not.toBe('чёрный гранит');
  });

  it('keeps the conversation alive when the catalog is unavailable', async () => {
    const outcome = await executeModelTurn({
      turnInput: buildTurnInput({ text: 'Покажи ещё варианты' }),
      approvedFacts: TEST_LIVE_V2_FACTS,
      catalogSnapshot: await loadPinnedCatalogIndex(),
      catalogSearchTool: {
        async search() {
          throw new Error('synthetic catalog outage');
        },
      },
      generator: {
        async generateDecision(input) {
          return input.responseMode === 'turn_action'
            ? searchAction('другие варианты')
            : finalResult('answer');
        },
      },
      gateReader: openGate,
    });

    expect(outcome.trace.catalogSearch).toMatchObject({
      status: 'failed',
      candidateIds: [],
    });
    expect(outcome.plan).toMatchObject({
      kind: 'persist_reply',
      validatedPlan: { recommendationIds: [] },
    });
  });

  it('keeps the checked-in snapshot pinned to exact source metadata and bytes', async () => {
    const snapshot = await loadPinnedCatalogIndex();
    expect(snapshot).toMatchObject({
      sourceRepository: PINNED_CATALOG_SOURCE_REPOSITORY,
      sourceBaseSha: PINNED_CATALOG_SOURCE_BASE_SHA,
      contentHash: PINNED_CATALOG_CONTENT_HASH,
      schemaVersion: 'catalog-index.v1',
      catalogVersion: 'landing-catalog.e76ee8be770a',
    });
    expect(snapshot.items).toHaveLength(229);
  });
});

function searchAction(
  query: string,
  categories?: readonly string[],
  material?: string,
) {
  return {
    version: 'granit_model_turn.v2',
    type: 'search_catalog',
    input: {
      query,
      ...(categories ? { categories } : {}),
      ...(material ? { material } : {}),
      limit: 8,
    },
  };
}

function finalAction(result: unknown) {
  return { version: 'granit_model_turn.v2', type: 'final', result };
}

function finalResult(
  action: 'answer' | 'recommend',
  recommendationIds: string[] = [],
) {
  return {
    version: 'granit_model_turn.v2',
    action,
    message: recommendationIds.length
      ? 'Показываю опубликованные варианты из каталога.'
      : 'Принял, продолжаем без повторного вопроса.',
    clarifyingQuestion: null,
    statePatches: [],
    recommendationIds,
    handoffIntent: null,
  };
}

function transcriptResult(
  turnIndex: number,
  candidates: ReadonlyArray<{ id: string }>,
) {
  const recommendationIds = SHOW_TURNS.has(turnIndex)
    ? candidates.slice(0, 3).map((candidate) => candidate.id)
    : [];
  const statePatches =
    turnIndex === 1
      ? [slotPatch('monumentType', 'вертикальный памятник', 'вертикальный')]
      : turnIndex === 4
        ? [
            slotPatch('size', '100×50', '100×50'),
            slotPatch('desiredTiming', 'до 15 мая', 'до 15 мая'),
          ]
        : turnIndex === 5
          ? [slotPatch('city', 'москва', 'москва')]
          : [];
  return {
    ...finalResult(recommendationIds.length > 0 ? 'recommend' : 'answer', recommendationIds),
    statePatches,
  };
}

function slotPatch(
  name: 'monumentType' | 'size' | 'desiredTiming' | 'city',
  value: string,
  quote: string,
) {
  return {
    operation: 'set_slot' as const,
    name,
    value,
    confidence: 1,
    evidence: { quote },
  };
}

function applyPatches(
  knownSlots: AiKnownSlots,
  patches: Array<{ name?: string; value: string }>,
  updatedAt: string,
) {
  for (const patch of patches) {
    if (!patch.name) continue;
    knownSlots[patch.name as keyof AiKnownSlots] = {
      value: patch.value,
      source: 'ai_extraction',
      confidence: 1,
      updatedAt,
    };
  }
}

function buildTurnInput(input: {
  text: string;
  submittedAt?: string;
  inboundPublicMessageId?: string;
  context?: Array<ReturnType<typeof message>>;
  knownSlots?: AiKnownSlots;
}) {
  const submittedAt = input.submittedAt ?? '2026-08-25T12:00:00.000Z';
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: '11111111-1111-4111-8111-111111111111',
    publicMessageId: input.inboundPublicMessageId ?? randomUUID(),
    requestFingerprint: 'a'.repeat(64),
    submittedAt,
    text: input.text,
    page: {
      url: 'https://example.test/catalog.html',
      widgetInstanceId: 'catalog-transcript',
    },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: { locale: 'ru-RU' },
    gate: { aiState: 'ai_collecting_info', agentAllowedToReply: true },
    recentMessages: input.context,
    persistedSlots: input.knownSlots,
  });
}

function message(
  publicMessageId: string,
  direction: 'inbound' | 'outbound',
  senderRole: 'visitor' | 'ai_assistant',
  submittedAt: string,
  text: string,
) {
  return {
    publicMessageId,
    direction,
    senderRole,
    contentType: 'text' as const,
    submittedAt,
    text,
  };
}

const openGate = {
  async readGate() {
    return { aiState: 'ai_collecting_info' as const, agentAllowedToReply: true };
  },
};
