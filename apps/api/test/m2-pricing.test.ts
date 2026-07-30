import { describe, expect, it } from "vitest";

import {
  OPENAI_GPT_5_6_SOL_PRICING,
  OPENAI_GPT_5_6_SOL_PRICING_VERSION,
  estimateOpenAiGpt56SolCost
} from "../src/modules/ai/pricing/openai-gpt-5-6-sol-pricing.v1.js";

describe("M2 dated gpt-5.6-sol pricing snapshot", () => {
  it("keeps the reviewed official source, date and integer micro-USD rates versioned", () => {
    expect(OPENAI_GPT_5_6_SOL_PRICING).toEqual({
      version: OPENAI_GPT_5_6_SOL_PRICING_VERSION,
      model: "gpt-5.6-sol",
      currency: "USD",
      unit: "micro_USD",
      checkedAt: "2026-07-15T03:00:00.000Z",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
      standardInputMicrounitsPerToken: 5,
      standardOutputMicrounitsPerToken: 30,
      cacheWritePremiumBasisPoints: 12_500,
      standardPricingMaximumInputTokens: 272_000
    });
  });

  it("requires zero cache-write billing evidence and refuses partial or surcharge-band usage", () => {
    expect(
      estimateOpenAiGpt56SolCost(
        { inputTokens: 1_000, outputTokens: 200, totalTokens: 1_200 },
        { cacheWriteInputTokens: 0 }
      )
    ).toEqual({
      costEstimateMicrounits: 11_000,
      costRateVersion: OPENAI_GPT_5_6_SOL_PRICING_VERSION
    });
    expect(
      estimateOpenAiGpt56SolCost(
        { inputTokens: 1_000, outputTokens: 200, totalTokens: 1_200 },
        undefined
      )
    ).toBeUndefined();
    expect(
      estimateOpenAiGpt56SolCost({ inputTokens: 1_000 }, { cacheWriteInputTokens: 0 })
    ).toBeUndefined();
    expect(
      estimateOpenAiGpt56SolCost(
        { inputTokens: 272_001, outputTokens: 1 },
        { cacheWriteInputTokens: 0 }
      )
    ).toBeUndefined();
  });
});
