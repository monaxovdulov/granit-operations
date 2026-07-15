import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const rootConfig = path.join(root, "tsconfig.json");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "granit-typecheck-"));
const TEST_BATCH_SIZE = 10;

try {
  const sourceFiles = [
    ...typescriptFiles(path.join(root, "apps", "api", "src")),
    ...typescriptFiles(path.join(root, "packages"))
  ];
  const testFiles = typescriptFiles(path.join(root, "apps", "api", "test"));

  runGroup("api source/packages", sourceFiles, 0);

  for (let offset = 0; offset < testFiles.length; offset += TEST_BATCH_SIZE) {
    const batch = testFiles.slice(offset, offset + TEST_BATCH_SIZE);
    runGroup(
      `api tests ${offset + 1}-${Math.min(offset + TEST_BATCH_SIZE, testFiles.length)}`,
      batch,
      offset / TEST_BATCH_SIZE + 1
    );
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function runGroup(label, files, index) {
  const configPath = path.join(temporaryDirectory, `tsconfig-${index}.json`);
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        extends: rootConfig,
        compilerOptions: { noEmit: true },
        files,
        include: [],
        exclude: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(`[typecheck] ${label}\n`);
  const result = spawnSync(process.execPath, [tsc, "-p", configPath], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`Typecheck failed for ${label}`);
  }
}

function typescriptFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...typescriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}
