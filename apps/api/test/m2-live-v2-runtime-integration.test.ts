import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { sha256Hex } from "@granit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import type { ObservedLiveV2DecisionGenerator } from "../src/modules/ai/ports/live-v2-runtime.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe("M2 app-owned direct live_v2 runtime", () => {
  it("commits model-turn text/hash and state patches through the only runtime", async () => {
    const repository = new MemoryIntakeRepository();
    const finalText = "Подберём подходящий вариант.";
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async () => ({
        candidate: {
          version: "granit_model_turn.v1",
          message: { answerText: finalText, question: null },
          statePatches: [
            {
              operation: "set_slot",
              name: "material",
              value: "чёрный гранит",
              confidence: 0.96,
              evidence: { quote: "чёрный гранит" }
            },
            {
              operation: "upsert_requirement",
              category: "decoration",
              mode: "avoidance",
              value: "золото",
              confidence: 0.9,
              evidence: { quote: "без золота" }
            }
          ],
          recommendationIds: [],
          handoffIntent: null
        },
        observation: {
          observedModelProvider: "openai",
          observedModelName: "gpt-5.6-luna",
          runtimeRunId: "resp_direct_model_turn_001",
          usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }
        }
      })
    );
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS
          },
          jobWorker: testJobWorkerOptions()
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest(
        "conv3-direct-model-turn-0001",
        "Нужен памятник: чёрный гранит, без золота"
      )
    });
    const history = await waitForTerminalHistory(app, response.json().public_session_id);

    expect(history.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sender_role: "ai_assistant", text: finalText })
      ])
    );
    expect(generateDecision).toHaveBeenCalledTimes(1);
    expect(generateDecision.mock.calls[0]?.[0].assets.prompt.version).toBe(
      "granit_model_turn_prompt.v1"
    );
    expect(repository.lastAiSaveInput).toMatchObject({
      body: finalText,
      runtimeMode: "direct_openai",
      slotUpdates: [
        expect.objectContaining({ name: "material", value: "чёрный гранит" })
      ],
      requirementUpdates: [
        expect.objectContaining({
          category: "decoration",
          mode: "avoidance",
          value: "золото"
        })
      ],
      metadata: {
        turn_contract: "granit_model_turn.v1",
        final_text_hash: sha256Hex(finalText),
        applied_patch_count: 2
      }
    });
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "persisted",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      runtimeRunId: "resp_direct_model_turn_001",
      model: {
        modelProvider: "openai",
        requestedModelName: "gpt-5.6-luna",
        reasoningEffort: "medium"
      },
      versions: {
        promptVersion: "granit_model_turn_prompt.v1",
        modelProfileVersion: "granit_model_turn_openai_luna.v1"
      },
      outboundMessageId: expect.any(String)
    });
  });

  it("records the exact safe candidate validation failure without raw model output", async () => {
    const repository = new MemoryIntakeRepository();
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async () => ({
        candidate: {
          version: "granit_model_turn.v1",
          message: { answerText: "Сделаем за три дня.", question: null },
          statePatches: [],
          recommendationIds: [],
          handoffIntent: null
        },
        observation: {
          observedModelProvider: "openai",
          observedModelName: "gpt-5.6-luna",
          runtimeRunId: "resp_direct_model_turn_invalid_001"
        }
      })
    );
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS
          },
          jobWorker: testJobWorkerOptions()
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("conv3-direct-model-turn-invalid-0001", "Когда будет готово?")
    });
    await waitForTerminalHistory(app, response.json().public_session_id);

    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "blocked",
      outcomeReason: "candidate_invalid",
      spans: expect.arrayContaining([
        expect.objectContaining({
          name: "candidate_validation",
          status: "failed",
          errorCode: "validation_failed",
          toolVersion: "candidate_validator.unsafe_claim.v1"
        })
      ])
    });
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

async function waitForTerminalHistory(
  app: ReturnType<typeof buildApi>,
  publicSessionId: string
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${publicSessionId}/history?schema_version=site_widget.history.v2`
    });
    const body = response.json();
    const status = body.messages?.[0]?.automation?.status;

    if (status && !["pending", "processing", "retrying"].includes(status)) {
      return body;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("timed out waiting for terminal site_widget.v2 history");
}

function widgetRequest(
  idempotencyKey: string,
  messageText: string
): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-14T20:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "m2-direct-test"
    },
    message: { role: "visitor", text: messageText },
    consent: { privacy_policy: true }
  };
}

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}
