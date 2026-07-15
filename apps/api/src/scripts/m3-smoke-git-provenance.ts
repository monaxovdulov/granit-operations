import { execFileSync, spawnSync } from "node:child_process";

export type M3SmokeGitRunner = {
  read(args: string[]): string;
  succeeds(args: string[]): boolean;
};

const systemGitRunner: M3SmokeGitRunner = {
  read(args) {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  },
  succeeds(args) {
    return spawnSync("git", args, { stdio: "ignore" }).status === 0;
  }
};

export function assertM3SmokeGitProvenance(
  input: {
    approvedBaseSha: string;
    implementationSha: string;
  },
  git: M3SmokeGitRunner = systemGitRunner
): void {
  const head = git.read(["rev-parse", "HEAD"]);
  const status = git.read(["status", "--porcelain", "--untracked-files=all"]);

  if (
    head !== input.implementationSha ||
    status !== "" ||
    !git.succeeds([
      "merge-base",
      "--is-ancestor",
      input.approvedBaseSha,
      input.implementationSha
    ])
  ) {
    throw new Error("M3 smoke git provenance check failed");
  }
}
