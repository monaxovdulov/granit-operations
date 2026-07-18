import {
  INTERNAL_CATALOG_SCHEMA_VERSION,
  type CatalogKnowledgePort,
  type CatalogSearchInput,
  type CatalogSnapshot
} from "./catalog-knowledge-port.js";

const EMPTY_CATALOG_CONTENT_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const EMPTY_CATALOG_SNAPSHOT: CatalogSnapshot = Object.freeze({
  schemaVersion: INTERNAL_CATALOG_SCHEMA_VERSION,
  catalogVersion: "empty.v1",
  contentHash: EMPTY_CATALOG_CONTENT_HASH,
  createdAt: "1970-01-01T00:00:00.000Z",
  records: Object.freeze([])
});

export class EmptyCatalogKnowledgeProvider implements CatalogKnowledgePort {
  async getSnapshot(): Promise<CatalogSnapshot> {
    return EMPTY_CATALOG_SNAPSHOT;
  }

  async search(
    _snapshot: CatalogSnapshot,
    _input: CatalogSearchInput
  ): Promise<readonly never[]> {
    return [];
  }
}

