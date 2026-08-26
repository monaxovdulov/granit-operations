import { describe, expect, it } from 'vitest';

import {
  buildLiveV2ModelRequest,
  measureLiveV2ModelRequestCharacters,
} from '../src/modules/ai/ports/live-v2-runtime.js';
import { serializeOpenAiStructuredResponseBody } from '../src/modules/ai/ports/openai-structured-response-body.js';
import { CATALOG_CATEGORY_TAXONOMY } from '../src/modules/ai/catalog/catalog-search-tool.js';
import { MODEL_TURN_PROMPT_ASSET } from '../src/modules/ai/profiles/live-v2/assets/model-turn-prompt.v1.js';
import { LIVE_V2_TONE_ASSET } from '../src/modules/ai/profiles/live-v2/assets/tone.v1.js';
import { toLiveV2ModelFactsAsset } from '../src/modules/ai/profiles/live-v2/live-v2-assets.js';
import { buildLiveV2TurnView } from '../src/modules/ai/profiles/live-v2/live-v2-context.js';
import { TEST_LIVE_V2_FACTS, buildLiveV2TestTurn } from './fixtures/live-v2-synthetic.v1.js';

describe('live_v2 complete model request budget', () => {
  it.each([
    ['turn_action', 'granit_model_turn_action'],
    ['final_result', 'granit_final_turn_result'],
  ] as const)('measures the complete %s Responses body', (responseMode, formatName) => {
    const input = {
      turn: buildLiveV2TurnView(buildLiveV2TestTurn()),
      responseMode,
      catalogTool: {
        name: 'search_catalog' as const,
        maxResults: 8 as const,
        categories: CATALOG_CATEGORY_TAXONOMY,
      },
      assets: {
        prompt: MODEL_TURN_PROMPT_ASSET,
        tone: LIVE_V2_TONE_ASSET,
        facts: toLiveV2ModelFactsAsset(TEST_LIVE_V2_FACTS),
      },
    };

    const request = buildLiveV2ModelRequest(input);
    const serializedBody = serializeOpenAiStructuredResponseBody({
      ...request,
      input: request.serializedInput,
    });

    expect(request.formatName).toBe(formatName);
    expect(request.requestCharacters).toBe(serializedBody.length);
    expect(measureLiveV2ModelRequestCharacters(input)).toBe(serializedBody.length);
    expect(request.requestCharacters).toBeGreaterThan(
      request.instructions.length + request.serializedInput.length + JSON.stringify(request.schema).length
    );
  });
});
