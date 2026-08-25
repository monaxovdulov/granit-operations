import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AiKnownSlots } from "../src/modules/ai/ai-dialog-contract.js";
import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import { buildCatalogReferences } from "../src/modules/ai/catalog/catalog-index.js";
import {
  PINNED_CATALOG_CONTENT_HASH,
  PINNED_CATALOG_SOURCE_BASE_SHA,
  PINNED_CATALOG_SOURCE_REPOSITORY,
  loadPinnedCatalogIndex
} from "../src/modules/ai/catalog/pinned-catalog-index.js";
import { executeModelTurn } from "../src/modules/ai/profiles/live-v2/model-turn-orchestrator.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";

const TRANSCRIPT = [
  "Покажи варианты памятников",
  "вертикальный",
  "пока не знаю",
  "покажи",
  "Сколько стоит памятник 100×50? Нужно установить до 15 мая",
  "москва",
  "не знаю пока",
  "не знаю",
  "да",
  "какие есть"
] as const;
const SHOW_TURNS = new Set([0, 3, 9]);

describe("AILR-03 sanitized catalog-show transcript", () => {
  it("keeps durable slots, returns verified actions on show turns and uses one model call per turn", async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const knownSlots: AiKnownSlots = {};
    const context: Array<{
      publicMessageId: string;
      direction: "inbound" | "outbound";
      senderRole: "visitor" | "ai_assistant";
      contentType: "text";
      submittedAt: string;
      text: string;
    }> = [];
    const referencesByTurn = new Map<number, ReturnType<typeof buildCatalogReferences>>();
    const completedPlans: Array<{
      finalText: string;
      hasHandoff: boolean;
    }> = [];
    let modelCalls = 0;
    let clarificationCount = 0;

    for (const [turnIndex, text] of TRANSCRIPT.entries()) {
      const submittedAt = `2026-08-25T12:${String(turnIndex).padStart(2, "0")}:00.000Z`;
      const inboundPublicMessageId = randomUUID();
      const turnInput = buildStageASiteWidgetAiTurnInput({
        publicConversationId: "11111111-1111-4111-8111-111111111111",
        publicMessageId: inboundPublicMessageId,
        requestFingerprint: "a".repeat(64),
        submittedAt,
        text,
        page: {
          url: "https://example.test/catalog.html",
          widgetInstanceId: "catalog-transcript"
        },
        customer: { phoneProvided: false, emailProvided: false },
        visitor: { locale: "ru-RU" },
        gate: { aiState: "ai_collecting_info", agentAllowedToReply: true },
        recentMessages: context.slice(-7),
        persistedSlots: knownSlots
      });
      const outcome = await executeModelTurn({
        turnInput,
        approvedFacts: TEST_LIVE_V2_FACTS,
        catalogSnapshot: snapshot,
        generator: {
          async generateDecision(input) {
            modelCalls += 1;
            expect(input.catalogCandidates?.length ?? 0).toBeLessThanOrEqual(8);
            expect(JSON.stringify(input.catalogCandidates)).not.toContain("catalog.html");
            if (turnIndex === 0) {
              const candidates = input.catalogCandidates ?? [];
              const groups = candidates.map((candidate) => candidate.groupSlug);

              expect(candidates.length).toBeGreaterThan(0);
              expect(candidates.every((candidate) => candidate.categorySlug === "monuments")).toBe(
                true
              );
              expect(new Set(groups).size).toBe(groups.length);
            }
            return transcriptOutput(turnIndex, input.catalogCandidates ?? []);
          }
        },
        gateReader: {
          async readGate() {
            return { aiState: "ai_collecting_info" as const, agentAllowedToReply: true };
          }
        }
      });

      expect(outcome.plan.kind).toBe("persist_reply");
      if (outcome.plan.kind !== "persist_reply") throw new Error("Transcript turn was lost");
      const plan = outcome.plan.validatedPlan;
      completedPlans.push({
        finalText: plan.finalText,
        hasHandoff: Boolean(plan.handoffAction)
      });
      if (plan.action === "ask_clarifying_question") clarificationCount += 1;
      applyPatches(knownSlots, plan.appliedPatches, submittedAt);
      const references = buildCatalogReferences(snapshot, plan.recommendationIds);
      referencesByTurn.set(turnIndex, references);
      context.push(
        {
          publicMessageId: inboundPublicMessageId,
          direction: "inbound",
          senderRole: "visitor",
          contentType: "text",
          submittedAt,
          text
        },
        {
          publicMessageId: randomUUID(),
          direction: "outbound",
          senderRole: "ai_assistant",
          contentType: "text",
          submittedAt,
          text: plan.finalText
        }
      );
    }

    expect(modelCalls).toBe(TRANSCRIPT.length);
    expect([...SHOW_TURNS].every((index) => (referencesByTurn.get(index)?.length ?? 0) >= 1)).toBe(
      true
    );
    expect(
      [...referencesByTurn.values()].every((references) => references.length <= 3)
    ).toBe(true);
    expect(
      [...referencesByTurn.values()].flat().every((reference) =>
        snapshot.items.some((item) => item.id === reference.entityId)
      )
    ).toBe(true);
    expect(knownSlots.monumentType?.value).toBe("вертикальный памятник");
    expect(knownSlots.size?.value).toBe("100×50");
    expect(knownSlots.desiredTiming?.value).toBe("до 15 мая");
    expect(knownSlots.city?.value).toBe("москва");
    expect(clarificationCount).toBe(0);
    const misleadingManagerCopy = completedPlans.some(
      (plan) => !plan.hasHandoff && mentionsManager(plan.finalText)
    );
    expect({
      baseline: {
        showTaskSuccess: 0,
        catalogActionRate: 0,
        silentFailures: 1,
        clarificationReplies: 7,
        forgotKnownMonumentType: 1,
        misleadingManagerCopy: true
      },
      after: {
        showTaskSuccess: 1,
        catalogActionRate: 1,
        silentFailures: 0,
        clarificationReplies: clarificationCount,
        forgotKnownMonumentType: 0,
        misleadingManagerCopy
      }
    }).toEqual({
      baseline: {
        showTaskSuccess: 0,
        catalogActionRate: 0,
        silentFailures: 1,
        clarificationReplies: 7,
        forgotKnownMonumentType: 1,
        misleadingManagerCopy: true
      },
      after: {
        showTaskSuccess: 1,
        catalogActionRate: 1,
        silentFailures: 0,
        clarificationReplies: 0,
        forgotKnownMonumentType: 0,
        misleadingManagerCopy: false
      }
    });
  });

  it("keeps the checked-in snapshot pinned to exact source metadata and bytes", async () => {
    const snapshot = await loadPinnedCatalogIndex();
    expect(snapshot).toMatchObject({
      sourceRepository: PINNED_CATALOG_SOURCE_REPOSITORY,
      sourceBaseSha: PINNED_CATALOG_SOURCE_BASE_SHA,
      contentHash: PINNED_CATALOG_CONTENT_HASH,
      schemaVersion: "catalog-index.v1",
      catalogVersion: "landing-catalog.e76ee8be770a"
    });
    expect(snapshot.items).toHaveLength(229);
  });
});

function transcriptOutput(
  turnIndex: number,
  candidates: ReadonlyArray<{ id: string }>
) {
  const recommendationIds = SHOW_TURNS.has(turnIndex)
    ? candidates.slice(0, 3).map((candidate) => candidate.id)
    : [];
  const statePatches =
    turnIndex === 1
      ? [slotPatch("monumentType", "вертикальный памятник", "вертикальный")]
      : turnIndex === 4
        ? [
            slotPatch("size", "100×50", "100×50"),
            slotPatch("desiredTiming", "до 15 мая", "до 15 мая")
          ]
        : turnIndex === 5
          ? [slotPatch("city", "москва", "москва")]
          : [];
  return {
    version: "granit_model_turn.v1",
    message: {
      answerText: recommendationIds.length
        ? "Показываю опубликованные варианты из каталога."
        : "Принял, продолжаем подбор без повторного вопроса.",
      question: null
    },
    statePatches,
    recommendationIds,
    handoffIntent: null
  };
}

function mentionsManager(text: string): boolean {
  return /менеджер/iu.test(text);
}

function slotPatch(
  name: "monumentType" | "size" | "desiredTiming" | "city",
  value: string,
  quote: string
) {
  return {
    operation: "set_slot" as const,
    name,
    value,
    confidence: 1,
    evidence: { quote }
  };
}

function applyPatches(
  knownSlots: AiKnownSlots,
  patches: Array<{ name?: string; value: string }>,
  updatedAt: string
) {
  for (const patch of patches) {
    if (!patch.name) continue;
    knownSlots[patch.name as keyof AiKnownSlots] = {
      value: patch.value,
      source: "ai_extraction",
      confidence: 1,
      updatedAt
    };
  }
}
