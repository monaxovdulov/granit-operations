import { z } from 'zod';

import type { CatalogIndexSnapshot } from './catalog-index.js';

export const CATALOG_CANDIDATE_LIMIT = 8;
export const CATALOG_SEARCH_TIMEOUT_MS = 250;

export const CATALOG_CATEGORIES = [
  'monuments',
  'fences',
  'granite-plinths',
  'slabs-flower-beds',
  'crosses',
  'engraving',
  'photo-portraits',
  'special-structures',
  'other-products-services',
  'work-examples',
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const CATALOG_CATEGORY_TAXONOMY: ReadonlyArray<{
  category: CatalogCategory;
  description: string;
}> = Object.freeze([
  { category: 'monuments', description: 'памятники, формы и образцы камня' },
  { category: 'fences', description: 'ограды для захоронений' },
  {
    category: 'granite-plinths',
    description: 'гранитные цоколи и каменное закрытие земли',
  },
  {
    category: 'slabs-flower-beds',
    description: 'плиты мощения и цветники',
  },
  { category: 'crosses', description: 'кресты' },
  { category: 'engraving', description: 'гравировка и оформление надписей' },
  { category: 'photo-portraits', description: 'фотопортреты и керамика' },
  {
    category: 'special-structures',
    description: 'комплексы и специальные мемориальные конструкции',
  },
  {
    category: 'other-products-services',
    description: 'другие товары и услуги оформления',
  },
  { category: 'work-examples', description: 'примеры выполненных работ' },
]);

export const catalogSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    categories: z.array(z.enum(CATALOG_CATEGORIES)).max(10).nullish(),
    material: z.string().trim().min(1).max(120).nullish(),
    monumentType: z.string().trim().min(1).max(160).nullish(),
    limit: z.number().int().positive().max(10_000).nullish(),
  })
  .strict();

export const CATALOG_SEARCH_INPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'categories', 'material', 'monumentType', 'limit'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 500 },
    categories: {
      anyOf: [
        {
          type: 'array',
          maxItems: 10,
          items: { type: 'string', enum: [...CATALOG_CATEGORIES] },
        },
        { type: 'null' },
      ],
    },
    material: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 120 },
        { type: 'null' },
      ],
    },
    monumentType: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 160 },
        { type: 'null' },
      ],
    },
    limit: {
      anyOf: [
        { type: 'integer', minimum: 1, maximum: 10_000 },
        { type: 'null' },
      ],
    },
  },
} as const satisfies Record<string, unknown>;

export type CatalogSearchInput = z.input<typeof catalogSearchInputSchema>;
export type NormalizedCatalogSearchInput = {
  query: string;
  categories?: CatalogCategory[];
  material?: string;
  monumentType?: string;
  limit: number;
};

export type CatalogSearchCandidate = {
  id: string;
  title: string;
  category: CatalogCategory;
  group?: string;
  material?: string;
  monumentType?: string;
  shortDescription?: string;
};

export interface CatalogSearchTool {
  search(
    input: NormalizedCatalogSearchInput,
    signal: AbortSignal,
  ): Promise<readonly CatalogSearchCandidate[]>;
}

export function normalizeCatalogSearchInput(
  value: unknown,
): NormalizedCatalogSearchInput {
  const parsed = catalogSearchInputSchema.parse(value);
  const categories = parsed.categories
    ? [...new Set(parsed.categories)]
    : [];
  return {
    query: parsed.query,
    ...(categories.length > 0 ? { categories } : {}),
    ...(parsed.material ? { material: parsed.material } : {}),
    ...(parsed.monumentType ? { monumentType: parsed.monumentType } : {}),
    limit: Math.min(parsed.limit ?? CATALOG_CANDIDATE_LIMIT, CATALOG_CANDIDATE_LIMIT),
  };
}

export function createCatalogSearchTool(
  snapshot: CatalogIndexSnapshot,
): CatalogSearchTool {
  return {
    async search(input, signal) {
      if (signal.aborted) throw signal.reason;
      const candidates = searchCatalogSnapshot(snapshot, input);
      if (signal.aborted) throw signal.reason;
      return candidates;
    },
  };
}

export async function searchCatalog(
  snapshot: CatalogIndexSnapshot,
  input: CatalogSearchInput,
): Promise<CatalogSearchCandidate[]> {
  return searchCatalogSnapshot(snapshot, normalizeCatalogSearchInput(input));
}

function searchCatalogSnapshot(
  snapshot: CatalogIndexSnapshot,
  input: NormalizedCatalogSearchInput,
): CatalogSearchCandidate[] {
  const categories = input.categories ? new Set(input.categories) : null;
  const queryTerms = normalizeTerms(input.query);
  if (queryTerms.length === 0) return [];
  const materialTerms = normalizeTerms(input.material ?? '');
  const monumentTypeTerms = normalizeTerms(input.monumentType ?? '');
  const ranked = snapshot.items
    .filter((item) => !categories || categories.has(asCategory(item.categorySlug)))
    .filter((item) => matchesAllTerms(item.material.join(' '), materialTerms))
    .filter((item) => matchesAllTerms(searchableText(item), monumentTypeTerms))
    .map((item) => ({
      item,
      score: scoreTerms(searchableText(item), queryTerms),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.categorySlug.localeCompare(right.item.categorySlug, 'en') ||
        left.item.groupSlug.localeCompare(right.item.groupSlug, 'en') ||
        left.item.id.localeCompare(right.item.id, 'en'),
    );

  return selectDiverse(ranked, input.limit).map(({ item }) => toCandidate(item));
}

function selectDiverse<T extends { item: CatalogIndexSnapshot['items'][number] }>(
  ranked: readonly T[],
  limit: number,
): T[] {
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const representedCategories = new Set<string>();
  const representedGroups = new Set<string>();

  for (const entry of ranked) {
    if (representedCategories.has(entry.item.categorySlug)) continue;
    representedCategories.add(entry.item.categorySlug);
    representedGroups.add(candidateGroupKey(entry));
    selectedIds.add(entry.item.id);
    selected.push(entry);
    if (selected.length >= limit) return selected;
  }

  for (const entry of ranked) {
    const key = candidateGroupKey(entry);
    if (selectedIds.has(entry.item.id) || representedGroups.has(key)) continue;
    representedGroups.add(key);
    selectedIds.add(entry.item.id);
    selected.push(entry);
    if (selected.length >= limit) return selected;
  }

  for (const entry of ranked) {
    if (selectedIds.has(entry.item.id)) continue;
    selected.push(entry);
    if (selected.length >= limit) return selected;
  }

  return selected;
}

function candidateGroupKey<T extends { item: CatalogIndexSnapshot['items'][number] }>(
  entry: T,
): string {
  return `${entry.item.categorySlug}:${entry.item.groupSlug}`;
}

function scoreTerms(value: string, queryTerms: readonly string[]): number {
  const candidateTerms = new Set(normalizeTerms(value));
  let score = 0;
  for (const term of queryTerms) {
    if (candidateTerms.has(term)) score += 1;
  }
  return score;
}

function matchesAllTerms(value: string, requiredTerms: readonly string[]): boolean {
  if (requiredTerms.length === 0) return true;
  const candidateTerms = new Set(normalizeTerms(value));
  return requiredTerms.every((term) => candidateTerms.has(term));
}

function searchableText(item: CatalogIndexSnapshot['items'][number]): string {
  return [
    item.title,
    item.categorySlug,
    item.groupSlug,
    item.subcategory,
    item.itemType,
    ...item.searchTerms,
    ...item.material,
  ].join(' ');
}

function normalizeTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase('ru-RU')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2),
    ),
  ];
}

function toCandidate(
  item: CatalogIndexSnapshot['items'][number],
): CatalogSearchCandidate {
  const category = asCategory(item.categorySlug);
  return {
    id: item.id,
    title: item.title,
    category,
    group: item.groupSlug,
    ...(item.material.length > 0 ? { material: item.material.join(', ') } : {}),
    ...(category === 'monuments' ? { monumentType: item.subcategory } : {}),
    shortDescription: item.itemType,
  };
}

function asCategory(value: string): CatalogCategory {
  if ((CATALOG_CATEGORIES as readonly string[]).includes(value)) {
    return value as CatalogCategory;
  }
  throw new Error(`Unsupported catalog category: ${value}`);
}
