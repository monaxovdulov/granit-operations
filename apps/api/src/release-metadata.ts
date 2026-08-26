import {
  PINNED_CATALOG_CONTENT_HASH,
  PINNED_CATALOG_SOURCE_BASE_SHA,
  PINNED_CATALOG_SOURCE_REPOSITORY,
  PINNED_CATALOG_VERSION
} from "./modules/ai/catalog/pinned-catalog-index.js";

export const OPERATIONS_RELEASE_SCHEMA_VERSION =
  "granit-operations-release.v1" as const;

export type OperationsReleaseMetadata = Readonly<{
  schemaVersion: typeof OPERATIONS_RELEASE_SCHEMA_VERSION;
  operationsSha: string;
  catalog: Readonly<{
    sourceRepository: typeof PINNED_CATALOG_SOURCE_REPOSITORY;
    sourceBaseSha: typeof PINNED_CATALOG_SOURCE_BASE_SHA;
    version: typeof PINNED_CATALOG_VERSION;
    sha256: typeof PINNED_CATALOG_CONTENT_HASH;
  }>;
}>;

export function buildOperationsReleaseMetadata(
  operationsSha: string | undefined
): OperationsReleaseMetadata | undefined {
  if (!operationsSha) return undefined;

  return Object.freeze({
    schemaVersion: OPERATIONS_RELEASE_SCHEMA_VERSION,
    operationsSha,
    catalog: Object.freeze({
      sourceRepository: PINNED_CATALOG_SOURCE_REPOSITORY,
      sourceBaseSha: PINNED_CATALOG_SOURCE_BASE_SHA,
      version: PINNED_CATALOG_VERSION,
      sha256: PINNED_CATALOG_CONTENT_HASH
    })
  });
}
