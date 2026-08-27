import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import {
  APPROVED_AI_ASSET_MANIFEST_VERSION,
  loadApprovedAiAssetManifest,
  parseApprovedAiAssetManifest,
  selectLiveV2ApprovedAssets
} from "../src/modules/ai/assets/approved-ai-assets.js";
import { MODEL_TURN_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/model-turn-prompt.v1.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("P3 approved AI assets", () => {
  it("validates the static manifest from actual versioned repo constants", () => {
    const manifest = loadApprovedAiAssetManifest();

    expect(manifest).toMatchObject({
      version: APPROVED_AI_ASSET_MANIFEST_VERSION,
      liveV2: {
        promptVersion: manifest.liveV2Prompt.version,
        toneVersion: manifest.liveV2Tone.version
      }
    });
    expect(manifest.liveV2Prompt.instructions.length).toBeGreaterThan(0);
    expect(manifest.liveV2Tone.desired.length).toBeGreaterThan(0);
  });

  it("pins the model-owned bounded catalog-search policy", () => {
    const instructions = MODEL_TURN_PROMPT_ASSET.instructions;

    expect(instructions).toContain(
      "На первом вызове выбери ровно одно: final или search_catalog. На втором вызове после поиска верни только FinalTurnResult."
    );
    expect(instructions).toContain(
      "Текущая visitor-реплика имеет приоритет над сохранённым фактом при конфликте. knownSlotProvenance и knownRequirements передают сохранённые факты с источником. Сам реши, какие явно заданные фильтры передать search_catalog; backend не добавит скрытые фильтры."
    );
  });

  it("rejects unknown, unversioned and cross-profile asset values", () => {
    const manifest = loadApprovedAiAssetManifest();

    expect(() =>
      parseApprovedAiAssetManifest({ ...manifest, unexpected: "raw" })
    ).toThrow();
    expect(() =>
      parseApprovedAiAssetManifest({
        ...manifest,
        liveV2: { ...manifest.liveV2, toolVersion: "unversioned" }
      })
    ).toThrow();
    expect(() =>
      parseApprovedAiAssetManifest({
        ...manifest,
        liveV2: { ...manifest.liveV2, assetVersion: "unversioned" }
      })
    ).toThrow();
  });

  it("keeps direct startup static while live_v2 selection enforces the facts review window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    expect(() => loadApprovedAiAssetManifest()).not.toThrow();
    await expect(selectLiveV2ApprovedAssets()).rejects.toThrow("outside its approval window");
  });

  it("records the exact approved live_v2 asset version on a direct run", async () => {
    const repository = new MemoryIntakeRepository();
    const manifest = loadApprovedAiAssetManifest();
    const app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        directLiveV2: {
          generator: {
            async generateDecision() {
              return {
                candidate: {
                  version: "granit_model_turn.v2",
                  type: "final",
                  result: {
                    version: "granit_model_turn.v2",
                    action: "clarify",
                    message: "Подберу варианты.",
                    clarifyingQuestion: { text: "Какой материал вам ближе?", target: "material" },
                    statePatches: [],
                    recommendationIds: [],
                    handoffIntent: null
                  },
                },
                observation: {
                  observedModelProvider: "openai",
                  observedModelName: "gpt-5.6-luna"
                }
              };
            }
          },
          modelName: "gpt-5.6-luna",
          approvedFacts: TEST_LIVE_V2_FACTS
        },
        jobWorker: testJobWorkerOptions()
      }
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p3-assets-run-version-0001")
    });

    expect(response.statusCode).toBe(202);
    await waitForAiRun(repository);
    expect(repository.listAiRuns()).toMatchObject([
      {
        versions: {
          policyVersion: manifest.liveV2.policyVersion,
          promptVersion: "granit_model_turn_prompt.v4",
          disclosureVersion: manifest.liveV2.disclosureVersion,
          assetVersion: manifest.liveV2.assetVersion
        }
      }
    ]);
  });
});

function testJobWorkerOptions() {
  return {
    enabled: true,
    pollIntervalMs: 10,
    leaseMs: 5_000,
    retryBackoffMs: 10,
    maxAttempts: 3
  };
}

async function waitForAiRun(repository: MemoryIntakeRepository): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (repository.listAiRuns().length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for approved-assets run");
}

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-15T00:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "p3-assets-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}
