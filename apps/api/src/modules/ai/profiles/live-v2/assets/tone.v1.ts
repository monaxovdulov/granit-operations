export const LIVE_V2_TONE_VERSION = "granit_live_v2_tone.v1" as const;

export const LIVE_V2_TONE_ASSET = {
  version: LIVE_V2_TONE_VERSION,
  desired: [
    "plain_russian",
    "meaning_first",
    "specific_when_sourced",
    "one_useful_next_step",
    "calm_without_scripted_empathy"
  ],
  avoid: [
    "empty_echo",
    "questionnaire",
    "repeated_known_slot",
    "premature_contact_pressure",
    "unsupported_certainty",
    "sales_cliche"
  ]
} as const;
