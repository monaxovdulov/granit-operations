import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildCatalogReferences,
  parseCatalogIndexSnapshot,
  retrieveCatalogCandidates
} from "../src/modules/ai/catalog/catalog-index.js";
import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import { loadPinnedCatalogIndex } from "../src/modules/ai/catalog/pinned-catalog-index.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import { validateModelTurnOutput } from "../src/modules/ai/profiles/live-v2/model-turn-validator.js";

const SOURCE_REPOSITORY = "monaxovdulov/landing-granit-static";
const SOURCE_BASE_SHA = "9d1710867b53323cbd9b99d6642541c7ddd4ec77";
const INDEX = {
  schema_version: "catalog-index.v1",
  catalog_version: "landing-catalog.test.v1",
  items: [
    item("ent_1111111111111111", "Арфа", "monuments", "vertical", [
      "арфа",
      "вертикальные",
      "памятники"
    ]),
    item("ent_2222222222222222", "Парус", "monuments", "vertical", [
      "парус",
      "вертикальные",
      "памятники"
    ]),
    item("ent_3333333333333333", "Прямоугольный", "monuments", "horizontal", [
      "горизонтальные",
      "памятники"
    ]),
    item("ent_4444444444444444", "Ограда", "fences", "standard", [
      "ограда",
      "ограды"
    ])
  ]
};
const INDEX_TEXT = `${JSON.stringify(INDEX, null, 2)}\n`;

describe("model turn catalog boundary", () => {
  it("parses a pinned snapshot and deterministically retrieves at most eight published candidates", () => {
    const snapshot = parseCatalogIndexSnapshot({
      sourceRepository: SOURCE_REPOSITORY,
      sourceBaseSha: SOURCE_BASE_SHA,
      contentHash: createHash("sha256").update(INDEX_TEXT).digest("hex"),
      content: INDEX_TEXT
    });
    const turn = buildLiveV2TurnView(turnInput("покажи", "вертикальный памятник"));
    const first = retrieveCatalogCandidates(snapshot, turn);
    const second = retrieveCatalogCandidates(snapshot, turn);

    expect(snapshot.items[0]?.assetRevision).toBe("1234567890ab");
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.every((candidate) => candidate.groupSlug === "vertical")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("catalog.html");
    expect(first.length).toBeLessThanOrEqual(8);
  });

  it("rejects a catalog item without an immutable asset revision", () => {
    const invalidIndex = structuredClone(INDEX);
    Reflect.deleteProperty(invalidIndex.items[0]!, "asset_revision");
    const content = `${JSON.stringify(invalidIndex, null, 2)}\n`;

    expect(() =>
      parseCatalogIndexSnapshot({
        sourceRepository: SOURCE_REPOSITORY,
        sourceBaseSha: SOURCE_BASE_SHA,
        contentHash: createHash("sha256").update(content).digest("hex"),
        content
      })
    ).toThrow();
  });

  it("uses a deterministic cross-category fallback for mixed or unrecognized requests", () => {
    const snapshot = parseCatalogIndexSnapshot({
      sourceRepository: SOURCE_REPOSITORY,
      sourceBaseSha: SOURCE_BASE_SHA,
      contentHash: createHash("sha256").update(INDEX_TEXT).digest("hex"),
      content: INDEX_TEXT
    });
    const mixed = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи памятник и ограду"))
    );
    const unrecognized = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи что-нибудь"))
    );

    expect(mixed).toEqual(unrecognized);
    expect(new Set(mixed.map((entry) => entry.categorySlug))).toEqual(
      new Set(["fences", "monuments"])
    );
  });

  it("does not override a durable product category when the current turn conflicts with it", () => {
    const snapshot = parseCatalogIndexSnapshot({
      sourceRepository: SOURCE_REPOSITORY,
      sourceBaseSha: SOURCE_BASE_SHA,
      contentHash: createHash("sha256").update(INDEX_TEXT).digest("hex"),
      content: INDEX_TEXT
    });
    const conflicting = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи ограду", "вертикальный памятник"))
    );
    const fallback = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи что-нибудь"))
    );

    expect(conflicting).toEqual(fallback);
  });

  it("selects an unambiguous category from a durable material-only slot", async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const castIron = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи", undefined, "чугун"))
    );
    const ceramic = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи", undefined, "керамика"))
    );

    expect(castIron.length).toBeGreaterThan(0);
    expect(castIron.every((entry) => entry.categorySlug === "fences")).toBe(true);
    expect(ceramic.length).toBeGreaterThan(0);
    expect(ceramic.every((entry) => entry.categorySlug === "photo-portraits")).toBe(
      true
    );
  });

  it("falls back across categories for ambiguous material or conflicting current intent", async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const fallback = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи"))
    );
    const ambiguousMaterial = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи", undefined, "гранит"))
    );
    const conflictingIntent = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи фотопортреты", undefined, "чугун"))
    );

    expect(ambiguousMaterial).toEqual(fallback);
    expect(conflictingIntent).toEqual(fallback);
  });

  it("does not infer a category from ambiguous generic current terms", async () => {
    const snapshot = await loadPinnedCatalogIndex();
    const fallback = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи"))
    );
    const genericModels = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи модели"))
    );
    const genericGranite = retrieveCatalogCandidates(
      snapshot,
      buildLiveV2TurnView(turnInput("покажи гранит"))
    );

    expect(genericModels).toEqual(fallback);
    expect(genericGranite).toEqual(fallback);
  });

  it("rejects a catalog asset path with traversal segments", () => {
    const invalidIndex = structuredClone(INDEX);
    invalidIndex.items[0]!.asset_path = "assets/catalog/../outside.webp";
    const content = `${JSON.stringify(invalidIndex, null, 2)}\n`;

    expect(() =>
      parseCatalogIndexSnapshot({
        sourceRepository: SOURCE_REPOSITORY,
        sourceBaseSha: SOURCE_BASE_SHA,
        contentHash: createHash("sha256").update(content).digest("hex"),
        content
      })
    ).toThrow();
  });

  it("accepts only a unique subset of exact supplied candidate ids", () => {
    const candidates = [
      {
        id: "ent_1111111111111111",
        title: "Арфа",
        categorySlug: "monuments",
        groupSlug: "vertical",
        searchTerms: ["арфа", "вертикальные", "памятники"],
        material: []
      }
    ];
    const valid = validateModelTurnOutput({
      value: output(["ent_1111111111111111"]),
      turnInput: turnInput("покажи", "вертикальный памятник"),
      catalogCandidates: candidates
    });
    const unknown = validateModelTurnOutput({
      value: output(["ent_9999999999999999"]),
      turnInput: turnInput("покажи", "вертикальный памятник"),
      catalogCandidates: candidates
    });
    const duplicate = validateModelTurnOutput({
      value: output(["ent_1111111111111111", "ent_1111111111111111"]),
      turnInput: turnInput("покажи", "вертикальный памятник"),
      catalogCandidates: candidates
    });

    expect(valid.ok && valid.plan.recommendationIds).toEqual([
      "ent_1111111111111111"
    ]);
    expect(unknown.ok && unknown.plan.recommendationIds).toEqual([]);
    expect(unknown.ok && unknown.plan.droppedRecommendationIds).toEqual([
      "ent_9999999999999999"
    ]);
    expect(duplicate.ok && duplicate.plan.recommendationIds).toEqual([]);
    expect(duplicate.ok && duplicate.plan.droppedRecommendationIds).toEqual([
      "ent_1111111111111111",
      "ent_1111111111111111"
    ]);
  });

  it("keeps the answer and drops valid recommendation ids beyond the public limit", () => {
    const candidates = [
      candidate("ent_1111111111111111", "Арфа", "vertical"),
      candidate("ent_2222222222222222", "Парус", "vertical"),
      candidate("ent_3333333333333333", "Прямоугольный", "horizontal"),
      candidate("ent_4444444444444444", "Семейный", "family"),
      candidate("ent_5555555555555555", "Мемориальный", "memorial")
    ];
    const recommendationIds = candidates.map((entry) => entry.id);
    const result = validateModelTurnOutput({
      value: output(recommendationIds),
      turnInput: turnInput("покажи"),
      catalogCandidates: candidates
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        finalText: "Показываю несколько вариантов.",
        recommendationIds: recommendationIds.slice(0, 3),
        droppedRecommendationIds: recommendationIds.slice(3)
      }
    });
  });

  it("builds href and labels only from the pinned snapshot", () => {
    const snapshot = parseCatalogIndexSnapshot({
      sourceRepository: SOURCE_REPOSITORY,
      sourceBaseSha: SOURCE_BASE_SHA,
      contentHash: createHash("sha256").update(INDEX_TEXT).digest("hex"),
      content: INDEX_TEXT
    });

    expect(buildCatalogReferences(snapshot, ["ent_1111111111111111"])).toEqual([
      {
        kind: "catalog_item",
        label: "Показать «Арфа»",
        title: "Арфа",
        entityId: "ent_1111111111111111",
        href: "/catalog.html?section=monuments&entity=ent_1111111111111111#block-vertical"
      }
    ]);
  });
});

function item(
  id: string,
  title: string,
  categorySlug: string,
  groupSlug: string,
  searchTerms: string[]
) {
  return {
    id,
    title,
    category_slug: categorySlug,
    group_slug: groupSlug,
    asset_path: `assets/catalog/${id}.webp`,
    asset_revision: "1234567890ab",
    subcategory: "Тестовая группа",
    item_type: "модель",
    published: true,
    search_terms: searchTerms,
    material: []
  };
}

function candidate(id: string, title: string, groupSlug: string) {
  return {
    id,
    title,
    categorySlug: "monuments",
    groupSlug,
    searchTerms: [title.toLowerCase(), "памятники"],
    material: []
  };
}

function turnInput(text: string, monumentType?: string, material?: string) {
  const submittedAt = "2026-08-25T12:00:00.000Z";
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: "11111111-1111-4111-8111-111111111111",
    publicMessageId: "22222222-2222-4222-8222-222222222222",
    requestFingerprint: "a".repeat(64),
    submittedAt,
    text,
    page: {
      url: "https://example.test/catalog.html",
      widgetInstanceId: "catalog-test"
    },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: { locale: "ru-RU" },
    gate: { aiState: "ai_collecting_info", agentAllowedToReply: true },
    persistedSlots: monumentType || material
      ? {
          ...(monumentType
            ? {
                monumentType: {
                  value: monumentType,
                  source: "ai_extraction" as const,
                  confidence: 1,
                  updatedAt: submittedAt
                }
              }
            : {}),
          ...(material
            ? {
                material: {
                  value: material,
                  source: "ai_extraction" as const,
                  confidence: 1,
                  updatedAt: submittedAt
                }
              }
            : {})
        }
      : undefined
  });
}

function output(recommendationIds: string[]) {
  return {
    version: "granit_model_turn.v1",
    message: { answerText: "Показываю несколько вариантов.", question: null },
    statePatches: [],
    recommendationIds,
    handoffIntent: null
  };
}
