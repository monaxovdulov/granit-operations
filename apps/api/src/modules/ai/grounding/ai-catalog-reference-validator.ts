import type { CatalogReference } from "../ai-dialog-contract.js";
import type { CatalogRecord, CatalogSnapshot } from "../catalog/catalog-knowledge-port.js";

export const WIDGET_AI_SYSTEM_POLICY_IDS = new Set([
  "widget.disclosure",
  "widget.commercial_boundary",
  "widget.missing_knowledge",
  "widget.handoff"
]);

export type CatalogReferenceResolution =
  | { found: false }
  | { found: true; value: unknown };

export function resolveCatalogReferenceValue(
  reference: CatalogReference,
  snapshot: CatalogSnapshot,
  selectedRecords: readonly CatalogRecord[],
  at: string
): CatalogReferenceResolution {
  if (reference.catalogVersion !== snapshot.catalogVersion) {
    return { found: false };
  }

  const selectedRecord = selectedRecords.find(
    (candidate) =>
      candidate.id === reference.recordId &&
      candidate.revision === reference.revision &&
      candidate.status === "published"
  );
  const snapshotRecord = snapshot.records.find(
    (candidate) =>
      candidate.id === reference.recordId &&
      candidate.revision === reference.revision &&
      candidate.status === "published"
  );

  if (!selectedRecord || !snapshotRecord || !isCatalogRecordActive(snapshotRecord, at)) {
    return { found: false };
  }

  if (reference.path === "/frontend/url") {
    const url = snapshotRecord.frontend?.url;

    return typeof url === "string" && url.length > 0
      ? { found: true, value: url }
      : { found: false };
  }

  return resolveJsonPointer(snapshotRecord.data, reference.path);
}

function isCatalogRecordActive(record: CatalogRecord, at: string): boolean {
  const timestamp = Date.parse(at);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  if (record.validFrom) {
    const validFrom = Date.parse(record.validFrom);

    if (!Number.isFinite(validFrom) || validFrom > timestamp) {
      return false;
    }
  }

  if (record.validUntil) {
    const validUntil = Date.parse(record.validUntil);

    if (!Number.isFinite(validUntil) || validUntil < timestamp) {
      return false;
    }
  }

  return true;
}

function resolveJsonPointer(
  value: unknown,
  path: string
): CatalogReferenceResolution {
  if (path === "") {
    return { found: true, value };
  }

  if (!path.startsWith("/")) {
    return { found: false };
  }

  let current = value;

  for (const encodedSegment of path.slice(1).split("/")) {
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");

    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        return { found: false };
      }

      const index = Number(segment);

      if (index >= current.length) {
        return { found: false };
      }

      current = current[index];
      continue;
    }

    if (
      !current ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { found: false };
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}
