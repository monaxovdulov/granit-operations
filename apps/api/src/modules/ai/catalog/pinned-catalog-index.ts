import { readFile } from "node:fs/promises";

import {
  parseCatalogIndexSnapshot,
  type CatalogIndexSnapshot
} from "./catalog-index.js";

export const PINNED_CATALOG_SOURCE_REPOSITORY =
  "monaxovdulov/landing-granit-static" as const;
export const PINNED_CATALOG_SOURCE_BASE_SHA =
  "46b11d6b252ac6a5cf7a766343394d818d2e39c2" as const;
export const PINNED_CATALOG_VERSION = "landing-catalog.34e6b5f78a6e" as const;
export const PINNED_CATALOG_CONTENT_HASH =
  "73086e6635f56a841df31552ef402caf2d2ac960d1e0d3f24f6aaae04139b710" as const;

export async function loadPinnedCatalogIndex(): Promise<CatalogIndexSnapshot> {
  const content = await readFile(
    new URL("./catalog-index.v1.json", import.meta.url),
    "utf8"
  );
  return parseCatalogIndexSnapshot({
    sourceRepository: PINNED_CATALOG_SOURCE_REPOSITORY,
    sourceBaseSha: PINNED_CATALOG_SOURCE_BASE_SHA,
    contentHash: PINNED_CATALOG_CONTENT_HASH,
    content
  });
}
