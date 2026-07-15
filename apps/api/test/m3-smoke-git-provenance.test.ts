import { describe, expect, it, vi } from "vitest";

import {
  assertM3SmokeGitProvenance,
  type M3SmokeGitRunner
} from "../src/scripts/m3-smoke-git-provenance.js";

const BASE = "ad40c27ad2cb97b5f2249f263a64073feaea1fcf";
const HEAD = "1111111111111111111111111111111111111111";

describe("M3 smoke git provenance", () => {
  it("accepts only an exact clean HEAD descended from the approved G6 base", () => {
    const git = fakeGit({ head: HEAD, status: "", ancestor: true });

    expect(() =>
      assertM3SmokeGitProvenance(
        { approvedBaseSha: BASE, implementationSha: HEAD },
        git
      )
    ).not.toThrow();
    expect(git.succeeds).toHaveBeenCalledWith([
      "merge-base",
      "--is-ancestor",
      BASE,
      HEAD
    ]);
  });

  it.each([
    ["mismatched HEAD", { head: BASE, status: "", ancestor: true }],
    ["dirty tree", { head: HEAD, status: " M apps/api/src/index.ts", ancestor: true }],
    ["unapproved ancestry", { head: HEAD, status: "", ancestor: false }]
  ])("rejects %s before staging work", (_label, state) => {
    expect(() =>
      assertM3SmokeGitProvenance(
        { approvedBaseSha: BASE, implementationSha: HEAD },
        fakeGit(state)
      )
    ).toThrow("git provenance check failed");
  });
});

function fakeGit(state: {
  head: string;
  status: string;
  ancestor: boolean;
}): M3SmokeGitRunner {
  return {
    read: vi.fn((args: string[]) =>
      args[0] === "rev-parse" ? state.head : state.status
    ),
    succeeds: vi.fn(() => state.ancestor)
  };
}
