import { describe, expect, it } from "vitest";

import { FileCatalogKnowledgeProvider } from "../src/modules/ai/catalog/file-catalog-knowledge-provider.js";

const at = "2026-07-20T12:00:00.000Z";

describe("FileCatalogKnowledgeProvider", () => {
  it("loads the versioned non-empty snapshot and keeps review-required records draft", async () => {
    const provider = new FileCatalogKnowledgeProvider();
    const snapshot = await provider.getSnapshot();

    expect(snapshot.catalogVersion).toBe("granit-cha.catalog.2026-07-20.v1");
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.records).toHaveLength(481);
    expect(snapshot.records.filter((record) => record.status === "published")).toHaveLength(465);
    expect(snapshot.records.filter((record) => record.status === "draft")).toHaveLength(16);
    expect(snapshot.records.every((record) => record.catalogVersion === snapshot.catalogVersion)).toBe(true);
    expect(snapshot.records.every((record) => /^[a-f0-9]{64}$/.test(record.contentHash))).toBe(true);
  });

  it.each([
    ["Арфа", "ent_1395cd250bbce644514c7e44", "title"],
    ["ангел для гравировки", "ent_599f380ee563a6ae56624e36", "alias"],
    ["КПГ-1", "ent_a6a2020b618dfb0a13c0b07c", "article"],
    ["габбро диабаз", "ent_5ae714de779793982ed3676d", "material"]
  ])("finds %s by %s", async (query, expectedId) => {
    const provider = new FileCatalogKnowledgeProvider();
    const snapshot = await provider.getSnapshot();
    const results = await provider.search(snapshot, { query, at, limit: 12 });

    expect(results.map((record) => record.id)).toContain(expectedId);
  });

  it("searches section and dimensions and returns only published records", async () => {
    const provider = new FileCatalogKnowledgeProvider();
    const snapshot = await provider.getSnapshot();
    const sectionResults = await provider.search(snapshot, { query: "ограды", at, limit: 20 });
    const dimensionResults = await provider.search(snapshot, {
      query: "размер 34 x 100",
      at,
      limit: 20
    });

    expect(sectionResults.length).toBeGreaterThan(0);
    expect(sectionResults.some((record) => record.qualifiers.section === "ограды")).toBe(true);
    expect(dimensionResults.some((record) => String(record.qualifiers.dimensions).includes("34 x 100"))).toBe(true);
    expect([...sectionResults, ...dimensionResults].every((record) => record.status === "published")).toBe(true);
  });

  it("never returns review-required drafts and exposes only verified frontend links", async () => {
    const provider = new FileCatalogKnowledgeProvider();
    const snapshot = await provider.getSnapshot();
    const draftId = "ent_59c1ef69765dbd084c7dd778";
    const results = await provider.search(snapshot, {
      query: "Гранит Балтик Грин",
      at,
      limit: 20
    });
    const arfa = snapshot.records.find((record) => record.id === "ent_1395cd250bbce644514c7e44");

    expect(results.map((record) => record.id)).not.toContain(draftId);
    expect(arfa?.frontend).toEqual({
      url: "/catalog.html?section=pamyatniki&entity=ent_1395cd250bbce644514c7e44#block-vertical-monuments",
      sectionSlug: "pamyatniki",
      blockId: "block-vertical-monuments",
      anchor: "block-vertical-monuments",
      highlightEntityId: "ent_1395cd250bbce644514c7e44"
    });
  });
});
