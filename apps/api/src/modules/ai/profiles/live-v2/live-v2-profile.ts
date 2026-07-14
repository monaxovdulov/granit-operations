import { LIVE_V2_PROMPT_VERSION } from "./assets/prompt.v1.js";
import { LIVE_V2_TONE_VERSION } from "./assets/tone.v1.js";
import { LIVE_V2_FACTS_VERSION } from "./live-v2-assets.js";
import {
  LIVE_V2_CANDIDATE_VERSION,
  LIVE_V2_DECISION_PROFILE,
  LIVE_V2_TURN_VIEW_VERSION
} from "./live-v2-contract.js";

export const LIVE_V2_PROFILE = {
  id: LIVE_V2_DECISION_PROFILE,
  candidateVersion: LIVE_V2_CANDIDATE_VERSION,
  turnViewVersion: LIVE_V2_TURN_VIEW_VERSION,
  promptVersion: LIVE_V2_PROMPT_VERSION,
  toneVersion: LIVE_V2_TONE_VERSION,
  factsVersion: LIVE_V2_FACTS_VERSION,
  runtimeEnabled: false,
  provider: null
} as const;
