import type { AiTurnIntent } from "../ai-dialog-contract.js";

export const INTERNAL_CATALOG_SCHEMA_VERSION = "granit_catalog_knowledge.internal.v1";

export const CATALOG_RECORD_KINDS = [
  "product",
  "material",
  "service",
  "price",
  "commercial_term",
  "business_fact"
] as const;

export type CatalogRecordKind = (typeof CATALOG_RECORD_KINDS)[number];
export type CatalogRecordStatus = "draft" | "published" | "retired";

export type CatalogRecord = {
  id: string;
  revision: number;
  kind: CatalogRecordKind;
  status: CatalogRecordStatus;
  catalogVersion: string;
  contentHash: string;
  validFrom?: string;
  validUntil?: string;
  aliases: string[];
  searchText: string;
  qualifiers: Record<string, string | number | boolean>;
  sectionId?: string;
  blockId?: string;
  provenance: Record<string, unknown>;
  frontend: {
    url: string;
    sectionSlug: string;
    blockId?: string;
    anchor?: string;
    highlightEntityId?: string;
  } | null;
  data: Record<string, unknown>;
};

export type CatalogSnapshot = {
  schemaVersion: typeof INTERNAL_CATALOG_SCHEMA_VERSION;
  catalogVersion: string;
  contentHash: string;
  createdAt: string;
  records: readonly CatalogRecord[];
};

export type CatalogSearchInput = {
  query: string;
  intents?: AiTurnIntent[];
  at: string;
  limit: number;
};

export interface CatalogKnowledgePort {
  getSnapshot(): Promise<CatalogSnapshot>;
  search(
    snapshot: CatalogSnapshot,
    input: CatalogSearchInput
  ): Promise<readonly CatalogRecord[]>;
}

export type CatalogReference = {
  recordId: string;
  revision: number;
  path: string;
  catalogVersion: string;
};

