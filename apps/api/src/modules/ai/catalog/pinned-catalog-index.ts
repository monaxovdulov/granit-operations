import { readFile } from "node:fs/promises";

import {
  parseCatalogIndexSnapshot,
  type CatalogIndexSnapshot
} from "./catalog-index.js";

export const PINNED_CATALOG_SOURCE_REPOSITORY =
  "monaxovdulov/landing-granit-static" as const;
export const PINNED_CATALOG_SOURCE_BASE_SHA =
  "9d1710867b53323cbd9b99d6642541c7ddd4ec77" as const;
export const PINNED_CATALOG_CONTENT_HASH =
  "94038ef1954ce38691d3bc85b3f658c1d9ad1bfc7a428037d66b26f07d87d22b" as const;

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
