import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  parseCatalogIndexSnapshot,
  type CatalogIndexSnapshot,
} from '../src/modules/ai/catalog/catalog-index.js';
import {
  CATALOG_CANDIDATE_LIMIT,
  searchCatalog,
} from '../src/modules/ai/catalog/catalog-search-tool.js';

const SOURCE_REPOSITORY = 'monaxovdulov/landing-granit-static';
const SOURCE_BASE_SHA = '9d1710867b53323cbd9b99d6642541c7ddd4ec77';

describe('search_catalog', () => {
  it('rejects unpublished snapshot records before they can become candidates', () => {
    const index = catalogIndex();
    index.items[0]!.published = false;

    expect(() => snapshot(index)).toThrow();
  });

  it('applies explicit category, material and monument type filters', async () => {
    const result = await searchCatalog(snapshot(), {
      query: 'вертикальные памятники из гранита',
      categories: ['monuments'],
      material: 'гранит',
      monumentType: 'вертикальные памятники',
      limit: 8,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'ent_1111111111111111',
        category: 'monuments',
        group: 'vertical',
        material: 'гранит',
      }),
    ]);
  });

  it('keeps multiple requested categories and diversifies categories and groups', async () => {
    const result = await searchCatalog(snapshot(), {
      query: 'памятники ограды',
      categories: ['monuments', 'fences'],
      limit: 8,
    });

    expect(new Set(result.map((candidate) => candidate.category))).toEqual(
      new Set(['monuments', 'fences']),
    );
    expect(new Set(result.map(candidateKey)).size).toBe(result.length);
  });

  it('does not dilute matching results with zero-score categories', async () => {
    const result = await searchCatalog(snapshot(), {
      query: 'памятники',
      limit: 8,
    });

    expect(result.map((candidate) => candidate.category)).toEqual([
      'monuments',
      'monuments',
    ]);
  });

  it('treats an empty optional category list as no category filter', async () => {
    const catalogSnapshot = snapshot();
    const result = await searchCatalog(catalogSnapshot, {
      query: 'памятники',
      categories: [],
      limit: 8,
    });
    const withoutFilter = await searchCatalog(catalogSnapshot, {
      query: 'памятники',
      limit: 8,
    });

    expect(result).toEqual(withoutFilter);
  });

  it('caps an oversized model limit at eight', async () => {
    const result = await searchCatalog(snapshot(catalogIndex(20)), {
      query: 'товарная модель',
      limit: 500,
    });

    expect(result).toHaveLength(CATALOG_CANDIDATE_LIMIT);
  });

  it('returns an empty array for an exact structured filter with no matches', async () => {
    await expect(
      searchCatalog(snapshot(), {
        query: 'памятники',
        categories: ['monuments'],
        material: 'несуществующий материал',
      }),
    ).resolves.toEqual([]);
  });

  it('is stable and never exposes URLs, paths or search terms', async () => {
    const input = { query: 'разные варианты', limit: 8 } as const;
    const first = await searchCatalog(snapshot(), input);
    const second = await searchCatalog(snapshot(), input);
    const serialized = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
    expect(new Set(first.map((candidate) => candidate.category)).size).toBeGreaterThan(1);
    expect(serialized).not.toContain('asset');
    expect(serialized).not.toContain('catalog.html');
    expect(serialized).not.toContain('searchTerms');
  });
});

function candidateKey(candidate: { category: string; group?: string }): string {
  return `${candidate.category}:${candidate.group ?? ''}`;
}

function snapshot(index = catalogIndex()): CatalogIndexSnapshot {
  const content = `${JSON.stringify(index, null, 2)}\n`;
  return parseCatalogIndexSnapshot({
    sourceRepository: SOURCE_REPOSITORY,
    sourceBaseSha: SOURCE_BASE_SHA,
    contentHash: createHash('sha256').update(content).digest('hex'),
    content,
  });
}

function catalogIndex(extraItems = 0) {
  const items = [
    item(
      'ent_1111111111111111',
      'Арфа',
      'monuments',
      'vertical',
      ['вертикальные', 'памятники', 'товарная', 'модель', 'разные', 'варианты'],
      ['гранит'],
    ),
    item(
      'ent_2222222222222222',
      'Парус',
      'monuments',
      'horizontal',
      ['горизонтальные', 'памятники', 'товарная', 'модель'],
    ),
    item(
      'ent_3333333333333333',
      'Ограда',
      'fences',
      'standard',
      ['ограды', 'товарная', 'модель', 'разные', 'варианты'],
      ['чугун'],
    ),
  ];

  for (let index = 0; index < extraItems; index += 1) {
    const suffix = (index + 4).toString(16).padStart(16, '0');
    items.push(
      item(
        `ent_${suffix}`,
        `Модель ${index + 4}`,
        index % 2 === 0 ? 'monuments' : 'fences',
        `group-${index}`,
        ['товарная', 'модель'],
      ),
    );
  }

  return {
    schema_version: 'catalog-index.v1',
    catalog_version: 'landing-catalog.search-test.v1',
    items,
  };
}

function item(
  id: string,
  title: string,
  categorySlug: string,
  groupSlug: string,
  searchTerms: string[],
  material: string[] = [],
) {
  return {
    id,
    title,
    category_slug: categorySlug,
    group_slug: groupSlug,
    asset_path: `assets/catalog/${id}.webp`,
    asset_revision: '1234567890ab',
    subcategory: searchTerms.slice(0, 2).join(' '),
    item_type: 'товарная модель',
    published: true,
    search_terms: searchTerms,
    material,
  };
}
