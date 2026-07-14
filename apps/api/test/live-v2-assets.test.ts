import { describe, expect, it } from "vitest";

import {
  LIVE_V2_FACTS_VERSION,
  parseLiveV2FactsSnapshot,
  toLiveV2ModelFactsAsset
} from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import { LIVE_V2_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { LIVE_V2_PROFILE } from "../src/modules/ai/profiles/live-v2/live-v2-profile.js";
import {
  TEST_LIVE_V2_AS_OF_DATE,
  TEST_LIVE_V2_FACTS
} from "./fixtures/live-v2-synthetic.v1.js";

const SOURCE_COMMIT_FOR_ASSERTION = "23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a";

describe("live_v2 versioned assets", () => {
  it("keeps prompt and tone behavior explicit and versioned", () => {
    expect(LIVE_V2_PROMPT_ASSET.version).toBe("granit_live_v2_prompt.v1");
    expect(LIVE_V2_PROMPT_ASSET.instructions.join("\n")).toContain(
      "не повторяй фразу клиента"
    );
    expect(LIVE_V2_PROMPT_ASSET.instructions.join("\n")).toContain(
      "не больше одного вопроса"
    );
    expect(LIVE_V2_TONE_ASSET).toMatchObject({
      version: "granit_live_v2_tone.v1",
      desired: expect.arrayContaining(["meaning_first", "specific_when_sourced"]),
      avoid: expect.arrayContaining(["empty_echo", "questionnaire"])
    });
    expect(LIVE_V2_PROFILE).toMatchObject({
      id: "live_v2",
      candidateVersion: "granit_live_v2_candidate.v1",
      runtimeEnabled: false,
      provider: null
    });
  });

  it("accepts a strict source-metadata-pinned test-only facts registry", () => {
    expect(TEST_LIVE_V2_FACTS.version).toBe(LIVE_V2_FACTS_VERSION);
    expect(TEST_LIVE_V2_FACTS.ownerReviewId).toBe("test-only-p1q-fixture");
    expect(TEST_LIVE_V2_FACTS.facts).toHaveLength(3);
  });

  it.each([
    {
      name: "unapproved fact",
      mutate: (value: Record<string, any>) => {
        value.facts[0].ownerApproved = false;
      }
    },
    {
      name: "unknown extra field",
      mutate: (value: Record<string, any>) => {
        value.facts[0].runtimeHint = "trust me";
      }
    },
    {
      name: "commercial wording",
      mutate: (value: Record<string, any>) => {
        value.facts[0].allowedCustomerWording = "Цена от 10000 руб.";
      }
    },
    {
      name: "duplicate fact ID",
      mutate: (value: Record<string, any>) => {
        value.facts[1].id = value.facts[0].id;
      }
    }
  ])("rejects $name", ({ mutate }) => {
    const value = structuredClone(TEST_LIVE_V2_FACTS) as Record<string, any>;
    mutate(value);

    expect(() =>
      parseLiveV2FactsSnapshot(value, { asOfDate: TEST_LIVE_V2_AS_OF_DATE })
    ).toThrow();
  });

  it.each([
    {
      name: "impossible validFrom calendar date",
      asOfDate: "2026-07-14",
      mutate: (value: Record<string, any>) => {
        value.facts[0].validFrom = "2026-02-30";
      }
    },
    {
      name: "impossible injected as-of calendar date",
      asOfDate: "2026-02-30",
      mutate: (_value: Record<string, any>) => undefined
    },
    {
      name: "fact not valid yet",
      asOfDate: "2026-07-13",
      mutate: (_value: Record<string, any>) => undefined
    },
    {
      name: "fact due for review on the reviewBy date",
      asOfDate: "2026-10-14",
      mutate: (_value: Record<string, any>) => undefined
    }
  ])("rejects $name", ({ asOfDate, mutate }) => {
    const value = structuredClone(TEST_LIVE_V2_FACTS) as Record<string, any>;
    mutate(value);

    expect(() => parseLiveV2FactsSnapshot(value, { asOfDate })).toThrow();
  });

  it("accepts facts inside the injected approval window", () => {
    expect(
      parseLiveV2FactsSnapshot(TEST_LIVE_V2_FACTS, { asOfDate: "2026-07-14" })
    ).toEqual(TEST_LIVE_V2_FACTS);
  });

  it("projects only customer-safe fact fields into the future model asset", () => {
    const modelAsset = toLiveV2ModelFactsAsset(TEST_LIVE_V2_FACTS);
    const serialized = JSON.stringify(modelAsset);

    expect(modelAsset.facts[0]).toEqual({
      id: TEST_LIVE_V2_FACTS.facts[0]!.id,
      category: TEST_LIVE_V2_FACTS.facts[0]!.category,
      allowedCustomerWording: TEST_LIVE_V2_FACTS.facts[0]!.allowedCustomerWording,
      forbiddenExtrapolations: TEST_LIVE_V2_FACTS.facts[0]!.forbiddenExtrapolations
    });
    expect(serialized).not.toContain("ownerReviewId");
    expect(serialized).not.toContain("ownerApproved");
    expect(serialized).not.toContain("blobSha");
    expect(serialized).not.toContain("validFrom");
    expect(serialized).not.toContain(SOURCE_COMMIT_FOR_ASSERTION);
  });
});
