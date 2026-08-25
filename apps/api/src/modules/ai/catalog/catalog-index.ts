import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PUBLIC_WIDGET_CATALOG_ACTION_LIMIT,
  type WidgetCatalogReference
} from "../ai-turn.js";

export const CATALOG_INDEX_SCHEMA_VERSION = "catalog-index.v1" as const;

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
    subcategory: string;
    itemType: string;
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
      subcategory: item.subcategory,
      itemType: item.item_type,
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
