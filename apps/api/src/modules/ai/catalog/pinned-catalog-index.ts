import { readFile } from "node:fs/promises";

import {
  parseCatalogIndexSnapshot,
  type CatalogIndexSnapshot
} from "./catalog-index.js";

export const PINNED_CATALOG_SOURCE_REPOSITORY =
  "monaxovdulov/landing-granit-static" as const;
export const PINNED_CATALOG_SOURCE_BASE_SHA =
  "bfcf9c02c0eb4b18561d8294d3d1f7deb438e4f3" as const;
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
