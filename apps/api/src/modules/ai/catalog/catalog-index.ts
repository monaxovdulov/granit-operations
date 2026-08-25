import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PUBLIC_WIDGET_CATALOG_ACTION_LIMIT,
  type WidgetCatalogReference
} from "../ai-turn.js";
import type {
  LiveV2CatalogCandidate,
  LiveV2TurnView
} from "../profiles/live-v2/live-v2-contract.js";

export const CATALOG_INDEX_SCHEMA_VERSION = "catalog-index.v1" as const;
export const CATALOG_CANDIDATE_LIMIT = 8;

const CATEGORY_DOMINANCE_MIN_SHARE = 0.8;
const CATEGORY_DOMINANCE_MIN_RATIO = 3;
const RETRIEVAL_QUERY_NOISE_TERMS = new Set([
  "вариант",
  "варианты",
  "есть",
  "какие",
  "какой",
  "нужен",
  "нужны",
  "покажи",
  "показать",
  "посмотреть",
  "сравнить",
  "хочу"
]);

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const catalogItemSchema = z
  .object({
    id: z.string().regex(/^ent_[a-f0-9]{16}$/),
    title: z.string().trim().min(1).max(160),
    category_slug: slug,
    group_slug: slug,
    asset_path: z
      .string()
      .regex(
        /^assets\/catalog\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/
      ),
    asset_revision: z.string().regex(/^[a-f0-9]{12}$/),
    subcategory: z.string().trim().min(1).max(240),
    item_type: z.string().trim().min(1).max(120),
    published: z.literal(true),
    search_terms: z.array(z.string().trim().min(2).max(80)).max(80),
    material: z.array(z.string().trim().min(2).max(80)).max(16)
  })
  .strict();
const catalogIndexSchema = z
  .object({
    schema_version: z.literal(CATALOG_INDEX_SCHEMA_VERSION),
    catalog_version: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{1,158}[A-Za-z0-9]$/),
    items: z.array(catalogItemSchema).min(1).max(2_000)
  })
  .strict();

export type CatalogIndexSnapshot = {
  sourceRepository: string;
  sourceBaseSha: string;
  schemaVersion: typeof CATALOG_INDEX_SCHEMA_VERSION;
  catalogVersion: string;
  contentHash: string;
  items: ReadonlyArray<{
    id: string;
    title: string;
    categorySlug: string;
    groupSlug: string;
    assetPath: string;
    assetRevision: string;
    searchTerms: string[];
    material: string[];
  }>;
};

export function parseCatalogIndexSnapshot(input: {
  sourceRepository: string;
  sourceBaseSha: string;
  contentHash: string;
  content: string;
}): CatalogIndexSnapshot {
  if (!/^[a-f0-9]{40}$/.test(input.sourceBaseSha)) {
    throw new Error("Catalog source base SHA is invalid");
  }
  const actualHash = createHash("sha256").update(input.content).digest("hex");
  if (actualHash !== input.contentHash) {
    throw new Error("Catalog snapshot content hash mismatch");
  }

  let value: unknown;
  try {
    value = JSON.parse(input.content);
  } catch (error) {
    throw new Error("Catalog snapshot is not valid JSON", { cause: error });
  }
  const parsed = catalogIndexSchema.parse(value);
  const ids = new Set<string>();
  const assetPaths = new Set<string>();
  const items = parsed.items.map((item) => {
    if (ids.has(item.id)) throw new Error(`Duplicate catalog entity id: ${item.id}`);
    if (assetPaths.has(item.asset_path)) {
      throw new Error(`Duplicate catalog asset path: ${item.asset_path}`);
    }
    ids.add(item.id);
    assetPaths.add(item.asset_path);
    return {
      id: item.id,
      title: item.title,
      categorySlug: item.category_slug,
      groupSlug: item.group_slug,
      assetPath: item.asset_path,
      assetRevision: item.asset_revision,
      searchTerms: [...item.search_terms],
      material: [...item.material]
    };
  });

  return Object.freeze({
    sourceRepository: input.sourceRepository,
    sourceBaseSha: input.sourceBaseSha,
    schemaVersion: parsed.schema_version,
    catalogVersion: parsed.catalog_version,
    contentHash: actualHash,
    items: Object.freeze(items)
  });
}

export function retrieveCatalogCandidates(
  snapshot: CatalogIndexSnapshot,
  turn: LiveV2TurnView
): LiveV2CatalogCandidate[] {
  const query = catalogQuery(turn);
  const productCategory = selectRelevantCategory(snapshot, query.categoryTerms);
  const materialCategory = selectMaterialCategory(snapshot, query.materialTerms);
  const category = mergeCategorySelections(productCategory, materialCategory);
  const categoryItems =
    category.kind === "selected"
      ? snapshot.items.filter((item) => item.categorySlug === category.categorySlug)
      : snapshot.items;
  const rankingTerms = category.kind === "selected" ? query.combinedTerms : [];
  const ranked = categoryItems
    .map((item) => ({ item, score: scoreCatalogItem(item, rankingTerms) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.groupSlug.localeCompare(right.item.groupSlug, "en") ||
        left.item.id.localeCompare(right.item.id, "en")
    );
  const bestScore = ranked[0]?.score ?? 0;
  const scored = ranked.filter(
    (entry) => rankingTerms.length === 0 || (bestScore > 0 && entry.score === bestScore)
  );
  const source = scored.length
    ? scored
    : categoryItems.map((item) => ({ item, score: 0 }));
  const selected: LiveV2CatalogCandidate[] = [];
  const representedGroups = new Set<string>();
  const shouldDiversifyGroups = new Set(source.map((entry) => entry.item.groupSlug)).size > 1;

  for (const entry of source) {
    if (selected.length >= CATALOG_CANDIDATE_LIMIT) break;
    if (shouldDiversifyGroups && representedGroups.has(entry.item.groupSlug)) {
      continue;
    }
    representedGroups.add(entry.item.groupSlug);
    selected.push(toCandidate(entry.item));
  }

  return selected;
}

export function buildCatalogReferences(
  snapshot: CatalogIndexSnapshot,
  recommendationIds: readonly string[]
): WidgetCatalogReference[] {
  const byId = new Map(snapshot.items.map((item) => [item.id, item]));
  return recommendationIds
    .slice(0, PUBLIC_WIDGET_CATALOG_ACTION_LIMIT)
    .map((id) => {
      const item = byId.get(id);
      if (!item) {
        throw new Error(`Validated catalog entity is unavailable: ${id}`);
      }
      return {
        kind: "catalog_item",
        label: `Показать «${item.title}»`,
        title: item.title,
        entityId: item.id,
        href:
          `/catalog.html?section=${item.categorySlug}&entity=${item.id}` +
          `#block-${item.groupSlug}`
      };
    });
}

function catalogQuery(turn: LiveV2TurnView): {
  categoryTerms: string[];
  materialTerms: string[];
  combinedTerms: string[];
} {
  const currentMessage = turn.messages.at(-1);
  const currentTerms = normalizeTerms(
    currentMessage?.role === "visitor" ? currentMessage.text : ""
  );
  const monumentTypeTerms = normalizeTerms(turn.knownSlots.monumentType ?? "");
  const materialTerms = normalizeTerms(turn.knownSlots.material ?? "");
  const durableTerms = [...new Set([...monumentTypeTerms, ...materialTerms])];

  return {
    categoryTerms: [...new Set([...currentTerms, ...monumentTypeTerms])],
    materialTerms,
    combinedTerms: [...new Set([...currentTerms, ...durableTerms])].filter(
      (term) => !RETRIEVAL_QUERY_NOISE_TERMS.has(term)
    )
  };
}

type CategorySelection =
  | { kind: "selected"; categorySlug: string }
  | { kind: "mixed"; categorySlugs: string[] }
  | { kind: "unrecognized" };

function mergeCategorySelections(
  product: CategorySelection,
  material: CategorySelection
): CategorySelection {
  if (product.kind === "mixed") return product;
  if (product.kind === "unrecognized") return material;
  if (material.kind === "unrecognized") return product;
  if (material.kind === "selected") {
    return material.categorySlug === product.categorySlug
      ? product
      : mixedCategories([product.categorySlug, material.categorySlug]);
  }
  return material.categorySlugs.includes(product.categorySlug)
    ? product
    : mixedCategories([product.categorySlug, ...material.categorySlugs]);
}

function selectMaterialCategory(
  snapshot: CatalogIndexSnapshot,
  queryTerms: readonly string[]
): CategorySelection {
  const categories = new Set<string>();

  for (const item of snapshot.items) {
    const materialTerms = catalogItemMaterialTerms(item);
    if (
      queryTerms.some((query) =>
        materialTerms.some((candidate) => termsMatch(candidate, query))
      )
    ) {
      categories.add(item.categorySlug);
    }
  }

  if (categories.size === 0) return { kind: "unrecognized" };
  const categorySlugs = [...categories].sort((left, right) =>
    left.localeCompare(right, "en")
  );
  return categorySlugs.length === 1
    ? { kind: "selected", categorySlug: categorySlugs[0]! }
    : { kind: "mixed", categorySlugs };
}

function selectRelevantCategory(
  snapshot: CatalogIndexSnapshot,
  queryTerms: readonly string[],
  itemTerms: (
    item: CatalogIndexSnapshot["items"][number]
  ) => string[] = catalogItemTerms
): CategorySelection {
  const categoryWinners = new Set<string>();
  const tiedCategorySets: string[][] = [];

  for (const term of queryTerms) {
    if (RETRIEVAL_QUERY_NOISE_TERMS.has(term)) continue;
    const scores = new Map<string, number>();

    for (const item of snapshot.items) {
      if (!itemTerms(item).some((candidate) => termsMatch(candidate, term))) {
        continue;
      }
      scores.set(item.categorySlug, (scores.get(item.categorySlug) ?? 0) + 1);
    }

    const ranked = [...scores.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en")
    );
    const bestScore = ranked[0]?.[1];
    if (!bestScore) continue;
    const matchedCategories = ranked.map((entry) => entry[0]);
    const totalScore = ranked.reduce((total, entry) => total + entry[1], 0);
    const nextScore = ranked[1]?.[1] ?? 0;
    const isDominantCategory =
      matchedCategories.length === 1 ||
      (bestScore / totalScore >= CATEGORY_DOMINANCE_MIN_SHARE &&
        bestScore >= nextScore * CATEGORY_DOMINANCE_MIN_RATIO);

    if (isDominantCategory) {
      categoryWinners.add(matchedCategories[0]!);
    } else {
      tiedCategorySets.push(matchedCategories);
    }
  }

  if (categoryWinners.size > 1) return mixedCategories([...categoryWinners]);
  const selectedCategory = [...categoryWinners][0];
  if (!selectedCategory) {
    return tiedCategorySets.length > 0
      ? mixedCategories(tiedCategorySets.flat())
      : { kind: "unrecognized" };
  }
  if (tiedCategorySets.some((categories) => !categories.includes(selectedCategory))) {
    return mixedCategories([selectedCategory, ...tiedCategorySets.flat()]);
  }
  return { kind: "selected", categorySlug: selectedCategory };
}

function mixedCategories(categorySlugs: readonly string[]): CategorySelection {
  return {
    kind: "mixed",
    categorySlugs: [...new Set(categorySlugs)].sort((left, right) =>
      left.localeCompare(right, "en")
    )
  };
}

function scoreCatalogItem(
  item: CatalogIndexSnapshot["items"][number],
  queryTerms: readonly string[]
): number {
  const candidateTerms = catalogItemTerms(item);
  return queryTerms.reduce(
    (score, term) =>
      score +
      (candidateTerms.some((candidate) => termsMatch(candidate, term))
        ? 1
        : 0),
    0
  );
}

function catalogItemTerms(
  item: CatalogIndexSnapshot["items"][number]
): string[] {
  return normalizeTerms(
    [
      item.title,
      item.categorySlug,
      item.groupSlug,
      ...item.searchTerms,
      ...item.material
    ].join(" ")
  );
}

function catalogItemMaterialTerms(
  item: CatalogIndexSnapshot["items"][number]
): string[] {
  return normalizeTerms(item.material.join(" "));
}

function termsMatch(candidate: string, query: string): boolean {
  return (
    candidate === query ||
    (candidate.length >= 5 && query.length >= 5 &&
      candidate.slice(0, 5) === query.slice(0, 5))
  );
}

function normalizeTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2 && !["не", "знаю", "пока"].includes(term))
    )
  ];
}

function toCandidate(
  item: CatalogIndexSnapshot["items"][number]
): LiveV2CatalogCandidate {
  return {
    id: item.id,
    title: item.title,
    categorySlug: item.categorySlug,
    groupSlug: item.groupSlug,
    searchTerms: [...item.searchTerms],
    material: [...item.material]
  };
}
