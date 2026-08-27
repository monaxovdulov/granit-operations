import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { sha256Hex } from "@granit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import {
  LIVE_V2_MAX_INPUT_CHARACTERS,
  LiveV2GenerationError,
  type ObservedLiveV2DecisionGenerator
} from "../src/modules/ai/ports/live-v2-runtime.js";
import {
  loadPinnedCatalogIndex,
  PINNED_CATALOG_VERSION
} from "../src/modules/ai/catalog/pinned-catalog-index.js";
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
    const catalogSnapshot = await loadPinnedCatalogIndex();
    const finalText = "Подберём подходящий вариант.";
    const rawProviderId = "resp_123456789_customer_canary";
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async (input) => {
        if (input.responseMode === "turn_action") {
          return observed({
            version: "granit_model_turn.v2",
            type: "search_catalog",
            input: {
              query: "чёрный гранит памятник без золота",
              categories: ["monuments"],
              material: null,
              monumentType: null,
              limit: 8
            }
          }, rawProviderId);
        }

        const recommendationId = input.catalogSearch?.candidates[0]?.id;
        if (!recommendationId) throw new Error("Test catalog candidate is missing");
        return observed({
          version: "granit_model_turn.v2",
          action: "recommend",
          message: finalText,
          clarifyingQuestion: null,
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
          recommendationIds: [recommendationId],
          handoffIntent: null
        }, rawProviderId);
      }
    );
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS,
            catalogSnapshot
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
        expect.objectContaining({
          sender_role: "ai_assistant",
          text: finalText,
          catalog_references: [
            expect.objectContaining({
              kind: "catalog_item",
              entity_id: expect.stringMatching(/^ent_[a-f0-9]{16}$/),
              href: expect.stringMatching(
                /^\/catalog\.html\?section=[a-z0-9-]+&entity=ent_[a-f0-9]{16}#block-[a-z0-9-]+$/
              )
            })
          ]
        })
      ])
    );
    expect(generateDecision).toHaveBeenCalledTimes(2);
    expect(generateDecision.mock.calls[0]?.[0].assets.prompt.version).toBe(
      "granit_model_turn_prompt.v4"
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
        turn_contract: "granit_model_turn.v2",
        final_text_hash: sha256Hex(finalText),
        applied_patch_count: 2,
        catalog_schema_version: "catalog-index.v1",
        catalog_version: PINNED_CATALOG_VERSION,
        catalog_content_hash: catalogSnapshot.contentHash,
        model_call_count: 2,
        selected_response_action: "recommend",
        catalog_search_called: true,
        catalog_search_status: "succeeded",
        catalog_search_query_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        catalog_search_categories: ["monuments"],
        catalog_search_limit: 8,
        catalog_candidate_ids: expect.arrayContaining([recommendationIdPattern()]),
        final_recommendation_ids: [recommendationIdPattern()],
        catalog_references: [expect.objectContaining({ kind: "catalog_item" })]
      }
    });
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "persisted",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      model: {
        modelProvider: "openai",
        requestedModelName: "gpt-5.6-luna",
        reasoningEffort: "medium"
      },
      versions: {
        promptVersion: "granit_model_turn_prompt.v4",
        modelProfileVersion: "granit_model_turn_openai_luna.v1"
      },
      usage: { inputTokens: 160, outputTokens: 40, totalTokens: 200 },
      spans: expect.arrayContaining([
        expect.objectContaining({ kind: "model", status: "succeeded" }),
        expect.objectContaining({
          kind: "tool",
          status: "succeeded",
          toolVersion: "granit_ai_tools.search_catalog.v1",
          usedInFinalAnswer: true
        })
      ]),
      outboundMessageId: expect.any(String)
    });
    expect(repository.listAiRuns()[0]).not.toHaveProperty("validatorFailureCode");
    expect(repository.listAiRuns()[0]).not.toHaveProperty("runtimeRunId");
    expect(JSON.stringify(repository)).not.toContain(rawProviderId);
  });

  it("keeps provider evidence coherent when the final model call has no trusted identity", async () => {
    const repository = new MemoryIntakeRepository();
    const catalogSnapshot = await loadPinnedCatalogIndex();
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async (input) => {
        if (input.responseMode === "turn_action") {
          return observed({
            version: "granit_model_turn.v2",
            type: "search_catalog",
            input: {
              query: "памятники",
              categories: ["monuments"],
              material: null,
              monumentType: null,
              limit: 8
            }
          });
        }

        throw new LiveV2GenerationError(
          {
            observedModelProvider: "none",
            usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }
          },
          "identity_mismatch"
        );
      }
    );
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS,
            catalogSnapshot
          },
          jobWorker: { ...testJobWorkerOptions(), maxAttempts: 1 }
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("coherent-provider-evidence-0001", "Покажите памятники")
    });
    const history = await waitForTerminalHistory(app, response.json().public_session_id);

    expect(history.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sender_role: "ai_assistant",
          text: expect.stringContaining("не удалось подготовить точный подбор")
        })
      ])
    );
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "persisted",
      observedModelProvider: "openai",
      observedModelName: "gpt-5.6-luna",
      usage: { inputTokens: 85, outputTokens: 22, totalTokens: 107 },
      qualityEvents: [
        expect.objectContaining({
          eventType: "runtime_failure",
          reasonCode: "runtime_failed"
        })
      ]
    });
  });

  it.each([
    {
      label: "invalid shape",
      candidate: { version: "wrong_model_turn_contract" },
      expectedCode: "invalid_shape",
      requestId: "ailr-01-validator-reject-0001"
    },
    {
      label: "handoff and question conflict",
      candidate: {
        version: "granit_model_turn.v2",
        type: "final",
        result: {
          version: "granit_model_turn.v2",
          action: "clarify",
          message: "Передам запрос менеджеру.",
          clarifyingQuestion: { text: "Какой материал рассматриваете?", target: "material" },
          statePatches: [],
          recommendationIds: [],
          handoffIntent: { reason: "customer_requested_manager" }
        }
      },
      expectedCode: "invalid_question",
      requestId: "ailr-02-handoff-question-reject-0001"
    }
  ])("uses a safe public fallback for $label without leaking internals", async (testCase) => {
    const repository = new MemoryIntakeRepository();
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async () => ({
        candidate: testCase.candidate,
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
      payload: widgetRequest(testCase.requestId, "Покажите варианты памятников")
    });
    const history = await waitForTerminalHistory(app, response.json().public_session_id);

    expect(generateDecision).toHaveBeenCalledTimes(1);
    expect(history.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sender_role: "ai_assistant",
          text: expect.stringContaining("не удалось подготовить точный подбор")
        })
      ])
    );
    expect(JSON.stringify(history)).not.toContain(testCase.expectedCode);
    expect(JSON.stringify(history)).not.toContain(JSON.stringify(testCase.candidate));
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "persisted",
      validatorResult: "passed",
      outboundMessageId: expect.any(String)
    });
    expect(repository.lastAiSaveInput?.metadata).toMatchObject({
      selected_response_action: "safe_fallback",
      validation_results: ["final_output_invalid"]
    });
    expect(repository.listAiRuns()[0]).not.toHaveProperty("validatorFailureCode");
  });

  it("does not turn a tone regex match into a silent terminal turn", async () => {
    const repository = new MemoryIntakeRepository();
    const finalText = "Понимаю ваши чувства. Давайте посмотрим подходящие варианты.";
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async () => ({
        candidate: {
          version: "granit_model_turn.v2",
          type: "final",
          result: {
          version: "granit_model_turn.v2",
          action: "answer",
          message: finalText,
          clarifyingQuestion: null,
          statePatches: [],
          recommendationIds: [],
          handoffIntent: null
          }
        },
        observation: {
          observedModelProvider: "openai",
          observedModelName: "gpt-5.6-luna",
          runtimeRunId: "resp_ailr_02_quality_001"
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
      payload: widgetRequest("ailr-02-quality-not-terminal-0001", "Покажите варианты")
    });
    const history = await waitForTerminalHistory(app, response.json().public_session_id);

    expect(generateDecision).toHaveBeenCalledTimes(1);
    expect(history.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sender_role: "ai_assistant", text: finalText })
      ])
    );
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "persisted",
      outboundMessageId: expect.any(String)
    });
    expect(repository.listAiRuns()[0]).not.toHaveProperty("validatorFailureCode");
  });

  it("publishes only the first three of five valid catalog recommendations", async () => {
    const repository = new MemoryIntakeRepository();
    const catalogSnapshot = await loadPinnedCatalogIndex();
    const finalText = "Показываю пять найденных вариантов.";
    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>(
      async (input) => {
        if (input.responseMode === "turn_action") {
          return observed({
            version: "granit_model_turn.v2",
            type: "search_catalog",
            input: {
              query: "памятники",
              categories: ["monuments"],
              material: null,
              monumentType: null,
              limit: 8
            }
          });
        }

        const recommendationIds = input.catalogSearch?.candidates
          .slice(0, 5)
          .map((candidate) => candidate.id);
        if (recommendationIds?.length !== 5) {
          throw new Error("Test catalog candidates are missing");
        }

        return {
          candidate: {
            version: "granit_model_turn.v2",
            action: "recommend",
            message: finalText,
            clarifyingQuestion: null,
            statePatches: [],
            recommendationIds,
            handoffIntent: null
          },
          observation: {
            observedModelProvider: "openai",
            observedModelName: "gpt-5.6-luna"
          }
        };
      }
    );
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS,
            catalogSnapshot
          },
          jobWorker: testJobWorkerOptions()
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("ailr-03-public-catalog-limit-0001", "Покажите варианты")
    });
    const history = await waitForTerminalHistory(app, response.json().public_session_id);
    const reply = history.messages.find(
      (message: { sender_role?: string }) => message.sender_role === "ai_assistant"
    );

    expect(reply).toMatchObject({ text: finalText });
    expect(reply.catalog_references).toHaveLength(3);
    expect(repository.lastAiSaveInput).toMatchObject({
      metadata: {
        dropped_recommendation_count: 2,
        catalog_references: expect.arrayContaining([
          expect.objectContaining({ kind: "catalog_item" })
        ])
      }
    });
    expect(repository.lastAiSaveInput?.metadata.catalog_references).toHaveLength(3);
  });

  it("persists sanitized budget evidence and a safe fallback without calling the model", async () => {
    const repository = new MemoryIntakeRepository();
    const publicSessionId = "44444444-4444-4444-8444-444444444444";
    const privateMarker = "private-budget-marker";

    for (let index = 0; index < 64; index += 1) {
      const request = widgetRequest(
        `budget-history-${String(index).padStart(2, "0")}`,
        `${privateMarker}-${index}-`.padEnd(4_000, "x"),
        publicSessionId
      );
      await repository.saveAcceptedSiteWidgetMessage({
        publicMessageId: randomUUID(),
        publicSessionId,
        agentAllowedToReply: true,
        request,
        requestFingerprint: sha256Hex(JSON.stringify(request))
      });
    }

    const generateDecision = vi.fn<ObservedLiveV2DecisionGenerator["generateDecision"]>();
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
      payload: widgetRequest("budget-current-0001", "Финальное сообщение", publicSessionId)
    });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    for (let attempt = 0; attempt < 200 && !repository.lastAiSaveInput; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const historyResponse = await app.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${response.json().public_session_id}/history?schema_version=site_widget.history.v2`
    });
    const history = historyResponse.json();

    expect(generateDecision).not.toHaveBeenCalled();
    expect(repository.lastAiSaveInput).toBeDefined();
    expect(history.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sender_role: "ai_assistant",
          text: expect.stringContaining("не удалось подготовить точный подбор")
        })
      ])
    );
    expect(repository.lastAiSaveInput?.metadata).toMatchObject({
      model_call_count: 0,
      selected_response_action: "safe_fallback",
      model_request_budget_status: "exceeded",
      model_request_budget_phase: "decision",
      model_request_max_characters: LIVE_V2_MAX_INPUT_CHARACTERS,
      model_transcript_message_count: 65
    });
    expect(repository.lastAiSaveInput?.metadata.model_request_characters).toBeGreaterThan(
      LIVE_V2_MAX_INPUT_CHARACTERS
    );
    expect(JSON.stringify(repository.lastAiSaveInput?.metadata)).not.toContain(privateMarker);
    expect(repository.lastAiSaveInput?.handoff).toBeUndefined();
    const persistedLead = await repository.getManagerLead(
      repository.lastAiSaveInput!.leadId
    );
    const persistedEvent = [...(persistedLead?.timeline ?? [])].reverse().find(
      (event) => event.eventType === "conversation.ai_message_sent"
    );
    expect(persistedEvent?.metadata).toMatchObject({
      model_request_budget_status: "exceeded",
      model_request_budget_phase: "decision",
      model_request_max_characters: LIVE_V2_MAX_INPUT_CHARACTERS,
      model_transcript_message_count: 65
    });
    expect(persistedEvent?.metadata.model_request_characters).toBeGreaterThan(
      LIVE_V2_MAX_INPUT_CHARACTERS
    );
    expect(JSON.stringify(persistedEvent?.metadata)).not.toContain(privateMarker);
  });
});

function observed(candidate: unknown, runtimeRunId?: string) {
  return {
    candidate,
    observation: {
      observedModelProvider: "openai" as const,
      observedModelName: "gpt-5.6-luna",
      ...(runtimeRunId ? { runtimeRunId } : {}),
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }
    }
  };
}

function recommendationIdPattern() {
  return expect.stringMatching(/^ent_[a-f0-9]{16}$/);
}

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
    const status = body.messages
      ?.map((message: { automation?: { status?: string } }) => message.automation?.status)
      .filter(Boolean)
      .at(-1);

    if (status && !["pending", "processing", "retrying"].includes(status)) {
      return body;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("timed out waiting for terminal site_widget.v2 history");
}

function widgetRequest(
  idempotencyKey: string,
  messageText: string,
  publicSessionId?: string
): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-14T20:00:00.000Z",
    ...(publicSessionId ? { public_session_id: publicSessionId } : {}),
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
