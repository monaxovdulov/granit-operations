import type { AiRunUsage } from "../repositories/ai-run-repository.js";

export const OPENAI_GPT_5_6_SOL_PRICING_VERSION =
  "openai_gpt-5.6-sol_2026-07-15.v1" as const;

/**
 * Dated app-owned snapshot of the standard text-token prices published on the official model
 * page. One microunit is one micro-USD. The live_v2 request cap is far below the documented
 * >272k-token surcharge threshold. The provider also documents a 1.25x cache-write premium,
 * so an estimate is emitted only when trusted billing evidence proves that no cache-write input
 * tokens were charged. Current Mastra usage does not provide that proof; M2 therefore persists no
 * OpenAI cost estimate.
 */
export const OPENAI_GPT_5_6_SOL_PRICING = {
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
} as const;

export type AiRunCostEstimate = {
  costEstimateMicrounits: number;
  costRateVersion: typeof OPENAI_GPT_5_6_SOL_PRICING_VERSION;
};

export function estimateOpenAiGpt56SolCost(
  usage: AiRunUsage | undefined,
  billingEvidence: { cacheWriteInputTokens: 0 } | undefined
): AiRunCostEstimate | undefined {
  if (
    billingEvidence?.cacheWriteInputTokens !== 0 ||
    usage?.inputTokens === undefined ||
    usage.outputTokens === undefined ||
    usage.inputTokens > OPENAI_GPT_5_6_SOL_PRICING.standardPricingMaximumInputTokens
  ) {
    return undefined;
  }

  const costEstimateMicrounits =
    usage.inputTokens * OPENAI_GPT_5_6_SOL_PRICING.standardInputMicrounitsPerToken +
    usage.outputTokens * OPENAI_GPT_5_6_SOL_PRICING.standardOutputMicrounitsPerToken;

  if (!Number.isSafeInteger(costEstimateMicrounits) || costEstimateMicrounits < 0) {
    return undefined;
  }

  return {
    costEstimateMicrounits,
    costRateVersion: OPENAI_GPT_5_6_SOL_PRICING_VERSION
  };
}
