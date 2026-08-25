import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolingDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolingDirectory, "..");
const source = resolve(
  repositoryRoot,
  "../landing-granit-static/assets/catalog/catalog-index.v1.json"
);
const target = resolve(
  repositoryRoot,
  "apps/api/src/modules/ai/catalog/catalog-index.v1.json"
);
const content = await readFile(source, "utf8");
const parsed = JSON.parse(content);
const shouldCheck = process.argv.slice(2).includes("--check");
const catalogAssetPath =
  /^assets\/catalog\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/;

if (
  process.argv.slice(2).some((argument) => argument !== "--check") ||
  parsed.schema_version !== "catalog-index.v1" ||
  typeof parsed.catalog_version !== "string" ||
  !Array.isArray(parsed.items) ||
  parsed.items.length === 0
) {
  throw new Error("Landing catalog index has an unsupported shape");
}

const ids = new Set();
const assetPaths = new Set();
for (const item of parsed.items) {
  if (
    !item ||
    typeof item !== "object" ||
    !/^ent_[a-f0-9]{16}$/.test(item.id) ||
    !catalogAssetPath.test(item.asset_path) ||
    !/^[a-f0-9]{12}$/.test(item.asset_revision) ||
    item.published !== true ||
    ids.has(item.id) ||
    assetPaths.has(item.asset_path)
  ) {
    throw new Error("Landing catalog index contains an invalid published item");
  }
  ids.add(item.id);
  assetPaths.add(item.asset_path);
}

if (shouldCheck) {
  const current = await readFile(target, "utf8");
  if (current !== content) {
    throw new Error("Operations catalog snapshot is out of sync with landing");
  }
} else {
  await writeFile(target, content, "utf8");
}
process.stdout.write(
  `${parsed.catalog_version} ${parsed.items.length} ${createHash("sha256")
    .update(content)
    .digest("hex")}\n`
);
