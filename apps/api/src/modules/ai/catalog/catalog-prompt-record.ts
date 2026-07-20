import type { CatalogRecord } from "./catalog-knowledge-port.js";

export function toCatalogPromptRecord(record: CatalogRecord) {
  return {
    id: record.id,
    revision: record.revision,
    kind: record.kind,
    status: record.status,
    catalogVersion: record.catalogVersion,
    contentHash: record.contentHash,
    validFrom: record.validFrom,
    validUntil: record.validUntil,
    aliases: record.aliases,
    qualifiers: record.qualifiers,
    sectionId: record.sectionId,
    blockId: record.blockId,
    provenance: record.provenance,
    frontend: record.frontend,
    data: record.data
  };
}

