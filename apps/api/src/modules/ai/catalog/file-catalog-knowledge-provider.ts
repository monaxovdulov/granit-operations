import { createHash } from "node:crypto";

import snapshotJson from "./snapshots/catalog-knowledge.v1.json" with { type: "json" };
import {
  INTERNAL_CATALOG_SCHEMA_VERSION,
  type CatalogKnowledgePort,
  type CatalogRecord,
  type CatalogSearchInput,
  type CatalogSnapshot
} from "./catalog-knowledge-port.js";

const snapshot = validateAndFreezeSnapshot(snapshotJson);

export class FileCatalogKnowledgeProvider implements CatalogKnowledgePort {
  async getSnapshot(): Promise<CatalogSnapshot> {
    return snapshot;
  }

  async search(
    selectedSnapshot: CatalogSnapshot,
    input: CatalogSearchInput
  ): Promise<readonly CatalogRecord[]> {
    if (
      selectedSnapshot.catalogVersion !== snapshot.catalogVersion ||
      selectedSnapshot.contentHash !== snapshot.contentHash
    ) {
      throw new Error("Catalog snapshot does not belong to this provider");
    }

    const query = normalize(input.query);
    if (!query || input.limit <= 0) return [];
    const queryTokens = tokenSet(query);
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) return [];

    return snapshot.records
      .filter((record) => record.status === "published" && isActive(record, at))
      .map((record) => ({ record, score: scoreRecord(record, query, queryTokens) }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.record.id.localeCompare(right.record.id)
      )
      .slice(0, Math.min(input.limit, 50))
      .map((candidate) => candidate.record);
  }
}

function scoreRecord(record: CatalogRecord, query: string, queryTokens: Set<string>) {
  const title = normalize(record.data.title);
  const aliases = record.aliases.map(normalize);
  const article = normalize(record.qualifiers.article);
  const materials = normalize(record.qualifiers.materials);
  const section = normalize(record.qualifiers.section);
  const dimensions = normalize(record.qualifiers.dimensions);
  const searchText = normalize(record.searchText);
  let score = 0;

  if (title === query) score += 120;
  else if (title && query.includes(title)) score += 60;
  else if (title && title.includes(query)) score += 45;
  if (aliases.includes(query)) score += 110;
  if (article && (article === query || query.includes(article))) score += 130;
  if (materials && (materials.includes(query) || query.includes(materials))) score += 55;
  if (section && (section === query || query.includes(section))) score += 35;
  if (dimensions && query.split(" ").every((token) => dimensions.includes(token))) score += 50;

  const recordTokens = tokenSet(searchText);
  let matched = 0;
  for (const token of queryTokens) {
    if (recordTokens.has(token)) matched += 1;
  }
  score += matched * 7;
  if (queryTokens.size > 1 && matched === queryTokens.size) score += 25;
  return score;
}

function isActive(record: CatalogRecord, at: number) {
  const from = record.validFrom ? Date.parse(record.validFrom) : Number.NEGATIVE_INFINITY;
  const until = record.validUntil ? Date.parse(record.validUntil) : Number.POSITIVE_INFINITY;
  return Number.isFinite(from) || from === Number.NEGATIVE_INFINITY
    ? (Number.isFinite(until) || until === Number.POSITIVE_INFINITY) && from <= at && at <= until
    : false;
}

function validateAndFreezeSnapshot(value: unknown): CatalogSnapshot {
  const candidate = value as CatalogSnapshot;
  if (
    candidate.schemaVersion !== INTERNAL_CATALOG_SCHEMA_VERSION ||
    !candidate.catalogVersion ||
    !Array.isArray(candidate.records) ||
    candidate.catalogVersion === "empty.v1"
  ) {
    throw new Error("Invalid catalog knowledge snapshot");
  }
  const calculatedHash = sha256(canonicalStringify(candidate.records));
  if (calculatedHash !== candidate.contentHash) {
    throw new Error("Catalog knowledge snapshot hash mismatch");
  }
  const recordIds = new Set<string>();
  for (const record of candidate.records) {
    const { contentHash, ...recordWithoutHash } = record;
    if (
      !record.id ||
      recordIds.has(record.id) ||
      !Number.isInteger(record.revision) ||
      record.revision < 1 ||
      record.catalogVersion !== candidate.catalogVersion ||
      contentHash !== sha256(canonicalStringify(recordWithoutHash)) ||
      !Array.isArray(record.aliases) ||
      !record.searchText ||
      !record.provenance ||
      !record.data ||
      !["published", "draft", "retired"].includes(record.status)
    ) {
      throw new Error(`Invalid catalog record: ${record.id}`);
    }
    if (record.qualifiers.reviewRequired === true && record.status === "published") {
      throw new Error(`Review-required record is published: ${record.id}`);
    }
    if (!isAllowedFrontendLink(record)) {
      throw new Error(`Invalid catalog frontend link: ${record.id}`);
    }
    recordIds.add(record.id);
  }
  return deepFreeze(candidate);
}

function isAllowedFrontendLink(record: CatalogRecord) {
  const frontend = record.frontend;
  if (!frontend) return true;
  if (!/^[a-z0-9-]+$/.test(frontend.sectionSlug)) return false;

  const query = new URLSearchParams({ section: frontend.sectionSlug });
  if (!frontend.blockId) {
    return (
      frontend.url === `/catalog.html?${query.toString()}` &&
      frontend.anchor === undefined &&
      frontend.highlightEntityId === undefined
    );
  }

  query.set("entity", record.id);
  return (
    record.blockId === frontend.blockId &&
    frontend.anchor === frontend.blockId &&
    frontend.highlightEntityId === record.id &&
    frontend.url === `/catalog.html?${query.toString()}#${frontend.blockId}`
  );
}

function normalize(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSet(value: string) {
  return new Set(value.split(" ").filter((token) => token.length >= 2 || /^\d+$/.test(token)));
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as any)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as any)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
