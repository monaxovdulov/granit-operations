import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildStageASiteWidgetAiTurnInput } from '../src/modules/ai/ai-turn.js';
import {
  buildCatalogReferences,
  parseCatalogIndexSnapshot,
} from '../src/modules/ai/catalog/catalog-index.js';
import type { CatalogSearchCandidate } from '../src/modules/ai/catalog/catalog-search-tool.js';
import { validateFinalTurnResult } from '../src/modules/ai/profiles/live-v2/model-turn-validator.js';

const SOURCE_REPOSITORY = 'monaxovdulov/landing-granit-static';
const SOURCE_BASE_SHA = '9d1710867b53323cbd9b99d6642541c7ddd4ec77';
const INDEX = {
  schema_version: 'catalog-index.v1',
  catalog_version: 'landing-catalog.test.v1',
  items: [
    item('ent_1111111111111111', 'Арфа', 'monuments', 'vertical'),
    item('ent_2222222222222222', 'Парус', 'monuments', 'vertical'),
    item('ent_3333333333333333', 'Прямоугольный', 'monuments', 'horizontal'),
    item('ent_4444444444444444', 'Ограда', 'fences', 'standard'),
    item('ent_5555555555555555', 'Семейный', 'special-structures', 'family'),
  ],
};

describe('model turn catalog validation', () => {
  it('accepts only unique IDs from the current tool result and pinned snapshot', () => {
    const publishedIds = new Set(snapshot().items.map((entry) => entry.id));
    const candidates = [candidate('ent_1111111111111111')];
    const valid = validate(['ent_1111111111111111'], candidates, publishedIds);
    const unknown = validate(['ent_9999999999999999'], candidates, publishedIds);
    const notFromTool = validate(
      ['ent_2222222222222222'],
      candidates,
      publishedIds,
    );
    const duplicate = validate(
      ['ent_1111111111111111', 'ent_1111111111111111'],
      candidates,
      publishedIds,
    );

    expect(valid.ok && valid.plan.recommendationIds).toEqual([
      'ent_1111111111111111',
    ]);
    for (const result of [unknown, notFromTool, duplicate]) {
      expect(result).toMatchObject({
        ok: true,
        plan: {
          responseAction: 'answer',
          recommendationIds: [],
          validationResults: expect.arrayContaining([
            'unsupported_recommendation',
            'action_repaired',
          ]),
        },
      });
    }
  });

  it('drops a candidate that is not present in the pinned published snapshot', () => {
    const id = 'ent_9999999999999999';
    const result = validate([id], [candidate(id)], new Set());

    expect(result).toMatchObject({
      ok: true,
      plan: {
        recommendationIds: [],
        droppedRecommendationIds: [id],
      },
    });
  });

  it('keeps the answer and caps valid recommendations at three', () => {
    const candidates = INDEX.items.map((entry) => candidate(entry.id));
    const ids = candidates.map((entry) => entry.id);
    const result = validate(ids, candidates, new Set(ids));

    expect(result).toMatchObject({
      ok: true,
      plan: {
        responseAction: 'recommend',
        recommendationIds: ids.slice(0, 3),
        droppedRecommendationIds: ids.slice(3),
      },
    });
  });

  it.each([
    ['answer', null, []],
    ['clarify', question(), []],
    ['recommend', null, ['ent_1111111111111111']],
    ['recommend_and_clarify', question(), ['ent_1111111111111111']],
  ] as const)('accepts the consistent %s action', (action, clarifyingQuestion, ids) => {
    const candidates = [candidate('ent_1111111111111111')];
    const result = validateFinalTurnResult({
      value: output(action, [...ids], clarifyingQuestion),
      turnInput: turnInput(),
      catalogCandidates: candidates,
      publishedCatalogIds: new Set(candidates.map((entry) => entry.id)),
    });

    expect(result).toMatchObject({ ok: true, plan: { responseAction: action } });
  });

  it('rejects an action that disagrees with its question or recommendations', () => {
    expect(
      validateFinalTurnResult({
        value: output('answer', ['ent_1111111111111111'], null),
        turnInput: turnInput(),
      }),
    ).toEqual({ ok: false, code: 'invalid_action' });
  });

  it('builds href and labels only from the pinned snapshot', () => {
    expect(buildCatalogReferences(snapshot(), ['ent_1111111111111111'])).toEqual([
      {
        kind: 'catalog_item',
        label: 'Показать «Арфа»',
        title: 'Арфа',
        entityId: 'ent_1111111111111111',
        href: '/catalog.html?section=monuments&entity=ent_1111111111111111#block-vertical',
      },
    ]);
  });
});

function validate(
  recommendationIds: string[],
  candidates: CatalogSearchCandidate[],
  publishedCatalogIds: Set<string>,
) {
  return validateFinalTurnResult({
    value: output('recommend', recommendationIds, null),
    turnInput: turnInput(),
    catalogCandidates: candidates,
    publishedCatalogIds,
  });
}

function output(
  action: 'answer' | 'clarify' | 'recommend' | 'recommend_and_clarify',
  recommendationIds: string[],
  clarifyingQuestion: ReturnType<typeof question> | null,
) {
  return {
    version: 'granit_model_turn.v2',
    action,
    message: 'Показываю несколько вариантов.',
    clarifyingQuestion,
    statePatches: [],
    recommendationIds,
    handoffIntent: null,
  };
}

function question() {
  return { text: 'Какое направление вам ближе?', target: 'monumentType' as const };
}

function candidate(id: string): CatalogSearchCandidate {
  return {
    id,
    title: 'Тестовая позиция',
    category: 'monuments',
    group: 'vertical',
  };
}

function snapshot() {
  const content = `${JSON.stringify(INDEX, null, 2)}\n`;
  return parseCatalogIndexSnapshot({
    sourceRepository: SOURCE_REPOSITORY,
    sourceBaseSha: SOURCE_BASE_SHA,
    contentHash: createHash('sha256').update(content).digest('hex'),
    content,
  });
}

function item(
  id: string,
  title: string,
  categorySlug: string,
  groupSlug: string,
) {
  return {
    id,
    title,
    category_slug: categorySlug,
    group_slug: groupSlug,
    asset_path: `assets/catalog/${id}.webp`,
    asset_revision: '1234567890ab',
    subcategory: 'Тестовая группа',
    item_type: 'модель',
    published: true,
    search_terms: [title.toLocaleLowerCase('ru-RU')],
    material: [],
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
      widgetInstanceId: 'catalog-test',
    },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: { locale: 'ru-RU' },
    gate: { aiState: 'ai_collecting_info', agentAllowedToReply: true },
  });
}
