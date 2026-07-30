import { z } from "zod";

import { WIDGET_AI_POLICY_VERSION } from "../policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../prompts/widget-ai-prompt.js";
import {
  LIVE_V2_PROMPT_ASSET,
  LIVE_V2_PROMPT_VERSION
} from "../profiles/live-v2/assets/prompt.v1.js";
import {
  LIVE_V2_TONE_ASSET,
  LIVE_V2_TONE_VERSION
} from "../profiles/live-v2/assets/tone.v1.js";
import {
  LIVE_V2_FACTS_VERSION,
  parseLiveV2FactsSnapshot,
  toLiveV2ModelFactsAsset
} from "../profiles/live-v2/live-v2-assets.js";
import {
  LIVE_V2_CANDIDATE_VERSION,
  LIVE_V2_DECISION_PROFILE,
  LIVE_V2_TURN_VIEW_VERSION
} from "../profiles/live-v2/live-v2-contract.js";
import { LEGACY_S05_DECISION_PROFILE } from "../profiles/legacy-s05/legacy-s05-decision.js";
import { WIDGET_AI_DISCLOSURE_VERSION } from "../../intake/ports/public-widget-ai-reply-generator.js";

export const APPROVED_AI_ASSET_MANIFEST_VERSION =
  "granit_ai_approved_assets_manifest.v1" as const;
export const LEGACY_S05_ASSET_VERSION = "granit_widget_ai_assets.s05.v1" as const;
export const LEGACY_S05_TOOL_VERSION = "granit_ai_tools.none.v1" as const;
export const LEGACY_S05_MODEL_PROFILE_VERSION =
  "granit_widget_ai_direct.s05.v1" as const;
export const LIVE_V2_ASSET_VERSION = "granit_live_v2_assets.v1" as const;
export const LIVE_V2_POLICY_VERSION = "granit_live_v2_policy.v1" as const;
export const LIVE_V2_TOOL_VERSION = "granit_ai_tools.none.v1" as const;
export const LIVE_V2_MODEL_PROFILE_VERSION = "granit_live_v2_model_profile.v1" as const;

const versionSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]+$/)
  .refine((value) => value.includes("."), "version must be explicitly versioned");

const legacyS05ProfileSchema = z
  .object({
    decisionProfile: z.literal(LEGACY_S05_DECISION_PROFILE),
    policyVersion: z.literal(WIDGET_AI_POLICY_VERSION),
    promptVersion: z.literal(WIDGET_AI_PROMPT_VERSION),
    toolVersion: z.literal(LEGACY_S05_TOOL_VERSION),
    assetVersion: z.literal(LEGACY_S05_ASSET_VERSION),
    disclosureVersion: z.literal(WIDGET_AI_DISCLOSURE_VERSION),
    modelProfileVersion: z.literal(LEGACY_S05_MODEL_PROFILE_VERSION)
  })
  .strict();

const liveV2ProfileSchema = z
  .object({
    decisionProfile: z.literal(LIVE_V2_DECISION_PROFILE),
    policyVersion: z.literal(LIVE_V2_POLICY_VERSION),
    promptVersion: z.literal(LIVE_V2_PROMPT_VERSION),
    toolVersion: z.literal(LIVE_V2_TOOL_VERSION),
    assetVersion: z.literal(LIVE_V2_ASSET_VERSION),
    disclosureVersion: z.literal(WIDGET_AI_DISCLOSURE_VERSION),
    modelProfileVersion: z.literal(LIVE_V2_MODEL_PROFILE_VERSION),
    toneVersion: z.literal(LIVE_V2_TONE_VERSION),
    factsVersion: z.literal(LIVE_V2_FACTS_VERSION),
    candidateVersion: z.literal(LIVE_V2_CANDIDATE_VERSION),
    turnViewVersion: z.literal(LIVE_V2_TURN_VIEW_VERSION)
  })
  .strict();

const liveV2PromptAssetSchema = z
  .object({
    version: z.literal(LIVE_V2_PROMPT_VERSION),
    instructions: z.array(z.string().trim().min(1).max(500)).min(1).max(32)
  })
  .strict();

const liveV2ToneAssetSchema = z
  .object({
    version: z.literal(LIVE_V2_TONE_VERSION),
    desired: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).min(1).max(32),
    avoid: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).min(1).max(32)
  })
  .strict();

export const approvedAiAssetManifestSchema = z
  .object({
    version: z.literal(APPROVED_AI_ASSET_MANIFEST_VERSION),
    legacyS05: legacyS05ProfileSchema,
    liveV2: liveV2ProfileSchema,
    liveV2Prompt: liveV2PromptAssetSchema,
    liveV2Tone: liveV2ToneAssetSchema
  })
  .strict();

export type ApprovedAiAssetManifest = z.infer<typeof approvedAiAssetManifestSchema>;

const APPROVED_AI_ASSET_MANIFEST_INPUT = {
  version: APPROVED_AI_ASSET_MANIFEST_VERSION,
  legacyS05: {
    decisionProfile: LEGACY_S05_DECISION_PROFILE,
    policyVersion: WIDGET_AI_POLICY_VERSION,
    promptVersion: WIDGET_AI_PROMPT_VERSION,
    toolVersion: LEGACY_S05_TOOL_VERSION,
    assetVersion: LEGACY_S05_ASSET_VERSION,
    disclosureVersion: WIDGET_AI_DISCLOSURE_VERSION,
    modelProfileVersion: LEGACY_S05_MODEL_PROFILE_VERSION
  },
  liveV2: {
    decisionProfile: LIVE_V2_DECISION_PROFILE,
    policyVersion: LIVE_V2_POLICY_VERSION,
    promptVersion: LIVE_V2_PROMPT_VERSION,
    toolVersion: LIVE_V2_TOOL_VERSION,
    assetVersion: LIVE_V2_ASSET_VERSION,
    toneVersion: LIVE_V2_TONE_VERSION,
    factsVersion: LIVE_V2_FACTS_VERSION,
    disclosureVersion: WIDGET_AI_DISCLOSURE_VERSION,
    modelProfileVersion: LIVE_V2_MODEL_PROFILE_VERSION,
    candidateVersion: LIVE_V2_CANDIDATE_VERSION,
    turnViewVersion: LIVE_V2_TURN_VIEW_VERSION
  },
  liveV2Prompt: LIVE_V2_PROMPT_ASSET,
  liveV2Tone: LIVE_V2_TONE_ASSET
} as const;

export function parseApprovedAiAssetManifest(value: unknown): ApprovedAiAssetManifest {
  return approvedAiAssetManifestSchema.parse(value);
}

/**
 * Synchronous startup validation is deliberately static: it does not import the dated facts
 * snapshot, perform I/O or make the frozen direct rollback depend on a live_v2 review window.
 */
export function loadApprovedAiAssetManifest(): ApprovedAiAssetManifest {
  return parseApprovedAiAssetManifest(APPROVED_AI_ASSET_MANIFEST_INPUT);
}

export type SelectedLiveV2ApprovedAssets = {
  manifest: ApprovedAiAssetManifest["liveV2"];
  prompt: typeof LIVE_V2_PROMPT_ASSET;
  tone: typeof LIVE_V2_TONE_ASSET;
  factsSnapshot: ReturnType<typeof parseLiveV2FactsSnapshot>;
  facts: ReturnType<typeof toLiveV2ModelFactsAsset>;
};

/**
 * Runtime live_v2 selection is the only place that imports and date-validates the owner-approved
 * facts snapshot. Direct legacy startup never calls this function.
 */
export async function selectLiveV2ApprovedAssets(): Promise<SelectedLiveV2ApprovedAssets> {
  const registry = loadApprovedAiAssetManifest();
  const { LIVE_V2_FACTS_SNAPSHOT } = await import("../profiles/live-v2/facts.v1.js");
  // The production selector always checks the real current date. Callers cannot backdate an
  // expired owner approval; parser-level tests use the explicit clock seam directly.
  const facts = parseLiveV2FactsSnapshot(LIVE_V2_FACTS_SNAPSHOT);

  if (facts.version !== registry.liveV2.factsVersion) {
    throw new Error("live_v2 facts version does not match the approved asset manifest");
  }

  return {
    manifest: registry.liveV2,
    prompt: LIVE_V2_PROMPT_ASSET,
    tone: LIVE_V2_TONE_ASSET,
    factsSnapshot: facts,
    facts: toLiveV2ModelFactsAsset(facts)
  };
}
