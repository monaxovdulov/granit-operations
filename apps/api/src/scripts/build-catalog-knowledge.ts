import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { INTERNAL_CATALOG_SCHEMA_VERSION } from "../modules/ai/catalog/catalog-knowledge-port.js";

const CATALOG_VERSION = "granit-cha.catalog.2026-07-20.v1";
const CREATED_AT = "2026-07-20T00:00:00.000Z";

type JsonObject = Record<string, any>;

const args = process.argv.slice(2);
const valueAfter = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const sourceRoot = resolve(valueAfter("--source-root") ?? "../pdf-analiz");
const outputPath = resolve(
  valueAfter("--output") ??
    "apps/api/src/modules/ai/catalog/snapshots/catalog-knowledge.v1.json"
);

const entities = await readJsonLines(
  resolve(sourceRoot, "output/catalog-granit-cha-search-ready/entities.jsonl")
);
const pageGroups = await readJsonLines(
  resolve(sourceRoot, "output/catalog-granit-cha-search-ready/page_groups.jsonl")
);
const webModel = JSON.parse(
  await readFile(
    resolve(sourceRoot, "output/catalog-granit-cha-web-model/web_catalog_model.json"),
    "utf8"
  )
) as JsonObject;

const sectionsById = new Map<string, JsonObject>(
  webModel.sections.map((section: JsonObject) => [section.section_id, section])
);
const sectionByNormalizedTitle = new Map<string, JsonObject>();
for (const section of webModel.sections as JsonObject[]) {
  sectionByNormalizedTitle.set(normalize(section.section_title), section);
  sectionByNormalizedTitle.set(normalize(section.slug), section);
}

const blocksByPageGroup = new Map<string, JsonObject>(
  webModel.blocks.map((block: JsonObject) => [block.page_group_id, block])
);
const modelEntitiesById = new Map<string, JsonObject>(
  webModel.entities.map((entity: JsonObject) => [entity.entity_id, entity])
);
const pageGroupsById = new Map<string, JsonObject>(
  pageGroups.map((group) => [group.page_group_id, group])
);

const records = entities
  .map((entity) => buildRecord(entity))
  .sort((left, right) => left.id.localeCompare(right.id));
const contentHash = sha256(canonicalStringify(records));
const snapshot = {
  schemaVersion: INTERNAL_CATALOG_SCHEMA_VERSION,
  catalogVersion: CATALOG_VERSION,
  contentHash,
  createdAt: CREATED_AT,
  records
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const published = records.filter((record) => record.status === "published").length;
const draft = records.filter((record) => record.status === "draft").length;
console.log(
  JSON.stringify({
    output: outputPath,
    catalogVersion: CATALOG_VERSION,
    contentHash,
    records: records.length,
    published,
    draft,
    frontendLinks: records.filter((record) => record.frontend).length
  })
);

function buildRecord(entity: JsonObject) {
  const modelEntity = modelEntitiesById.get(entity.entity_id);
  const pageGroupId = modelEntity?.page_group_id ?? entity.page_group_id ?? null;
  const block = pageGroupId ? blocksByPageGroup.get(pageGroupId) : undefined;
  const section = block
    ? sectionsById.get(block.section_id)
    : sectionByNormalizedTitle.get(normalize(entity.normalized_section ?? entity.display_title));
  const aliases = uniqueStrings([
    entity.source_title,
    entity.normalized_title,
    ...(entity.source_articles ?? []),
    ...(entity.normalized_articles ?? []),
    ...(entity.alternative_spellings ?? []).flatMap((alias: JsonObject | string) =>
      typeof alias === "string" ? [alias] : [alias.value, alias.normalized_value]
    )
  ]).filter((value) => normalize(value) !== normalize(entity.display_title));
  const dimensions = (entity.dimensions ?? []).map((dimension: JsonObject) => ({
    field: dimension.field,
    value: dimension.normalized_value ?? dimension.source_value,
    unit: dimension.unit,
    values: dimension.values
  }));
  const frontend = buildFrontend(entity.entity_id, section, block);
  const provenance = {
    source: entity.source,
    sourceRecordId: entity.source_record_id,
    sourceSchemaVersion: entity.schema_version,
    method: entity.provenance?.method,
    confidence: entity.provenance?.confidence,
    pdfPages: entity.pdf_pages ?? [],
    pageGroupId,
    sourcePdf: pageGroupId ? pageGroupsById.get(pageGroupId)?.source?.pdf_file : undefined
  };
  const base = {
    id: entity.entity_id,
    revision: 1,
    kind: recordKind(entity.entity_type),
    status: entity.review?.required ? "draft" : "published",
    catalogVersion: CATALOG_VERSION,
    aliases,
    searchText: uniqueStrings([
      entity.display_title,
      ...aliases,
      entity.normalized_article,
      ...(entity.normalized_articles ?? []),
      ...(entity.normalized_materials ?? []),
      entity.normalized_section,
      entity.normalized_subsection,
      entity.entity_type,
      ...dimensions.map((dimension: JsonObject) => dimension.value),
      entity.source_page_context
    ]).join(" | "),
    qualifiers: compactObject({
      entityType: entity.entity_type,
      article: entity.normalized_article,
      articles: uniqueStrings(entity.normalized_articles ?? []).join(" | "),
      materials: uniqueStrings(entity.normalized_materials ?? []).join(" | "),
      section: entity.normalized_section,
      subsection: entity.normalized_subsection,
      dimensions: dimensions.map((dimension: JsonObject) => dimension.value).join(" | "),
      pageGroupId,
      blockId: block?.block_id,
      reviewRequired: Boolean(entity.review?.required)
    }),
    sectionId: section?.section_id,
    blockId: block?.block_id,
    provenance,
    frontend,
    data: {
      title: entity.display_title,
      entityType: entity.entity_type,
      article: entity.normalized_article,
      articles: entity.normalized_articles ?? [],
      materials: entity.normalized_materials ?? [],
      dimensions,
      attributes: entity.normalized_attributes ?? {},
      section: entity.normalized_section,
      subsection: entity.normalized_subsection,
      catalogEntity: Boolean(entity.catalog_entity),
      sectionId: section?.section_id ?? null,
      blockId: block?.block_id ?? null,
      pageGroupId,
      frontend,
      provenance
    }
  };

  return { ...base, contentHash: sha256(canonicalStringify(base)) };
}

function buildFrontend(entityId: string, section?: JsonObject, block?: JsonObject) {
  if (!section) return null;
  const query = new URLSearchParams({ section: section.slug });
  if (block) query.set("entity", entityId);
  const anchor = block?.block_id;
  return {
    url: `/catalog.html?${query.toString()}${anchor ? `#${anchor}` : ""}`,
    sectionSlug: section.slug,
    ...(block
      ? {
          blockId: block.block_id,
          anchor: block.block_id,
          highlightEntityId: entityId
        }
      : {})
  };
}

function recordKind(entityType: string) {
  if (entityType === "material") return "material";
  if (entityType === "service" || entityType === "instruction") return "service";
  if (entityType === "section") return "business_fact";
  return "product";
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "")
  );
}

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const trimmed = value.trim();
    const key = normalize(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
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

async function readJsonLines(path: string) {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonObject);
}
