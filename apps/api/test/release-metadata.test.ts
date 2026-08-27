import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  buildOperationsReleaseMetadata,
  OPERATIONS_RELEASE_SCHEMA_VERSION
} from "../src/release-metadata.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const OPERATIONS_SHA = "e03a1789dbcfd015d3d4cc06aa553513fa0bc1fe";
const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("staging release metadata", () => {
  it("requires an exact operations SHA for staging", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://release.invalid/granit",
        DEPLOYMENT_TIER: "staging"
      })
    ).toThrow("OPERATIONS_RELEASE_SHA is required for staging");

    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://release.invalid/granit",
        DEPLOYMENT_TIER: "staging",
        OPERATIONS_RELEASE_SHA: "not-a-commit"
      })
    ).toThrow("OPERATIONS_RELEASE_SHA must be exactly 40 lowercase hex characters");
  });

  it("exposes the exact operations and pinned catalog release", async () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://release.invalid/granit",
      DEPLOYMENT_TIER: "staging",
      OPERATIONS_RELEASE_SHA: OPERATIONS_SHA
    });
    const release = buildOperationsReleaseMetadata(config.operationsReleaseSha);
    const app = buildApi({
      repository: new MemoryIntakeRepository(),
      release
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "granit-operations-api",
      release: {
        schemaVersion: OPERATIONS_RELEASE_SCHEMA_VERSION,
        operationsSha: OPERATIONS_SHA,
        catalog: {
          sourceRepository: "monaxovdulov/landing-granit-static",
          sourceBaseSha: "fcd26c9ed966177bb15e57e37204a31828bd8282",
          version: "landing-catalog.34e6b5f78a6e",
          sha256: "73086e6635f56a841df31552ef402caf2d2ac960d1e0d3f24f6aaae04139b710"
        }
      }
    });
  });
});
