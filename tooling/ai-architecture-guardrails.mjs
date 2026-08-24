import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const ACTIVE_AI_DOCUMENTS = [
  "AGENTS.md",
  "README.md",
  "docs/source-of-truth.md",
  "docs/AGENT_WORKFLOW.md",
  "docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md",
  "docs/AI_POLICY.md",
  "docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md",
  "docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md",
  "docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md",
  "docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md",
  "docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md",
  "docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md",
  "docs/tasks/README.md"
];

export const ARCHITECTURE_CONTRACT_PATH = "tooling/ai-architecture-contract.json";

const ASSEMBLY_DOCUMENTS = [
  "apps/api/src/app.ts",
  "apps/api/src/app-context.ts",
  "apps/api/src/config.ts",
  "apps/api/src/index.ts",
  "apps/api/src/widget-ai-runtime-assembly.ts"
];

const REVIEWED_ASSEMBLY_HASHES = {
  "apps/api/src/app.ts": "713ae56f89733ad031951618abc3a1bd3a1495867b8920b9c6f0ed8c45e57af4",
  "apps/api/src/app-context.ts": "4b8b9d4391457997af291cfe2b515390d821c201f97aa70e2a25f0ab74731539",
  "apps/api/src/config.ts": "9ede71614da02235cae39cf23c66eaca68fb079a5ea18046128d6c5417fce193",
  "apps/api/src/index.ts": "a6c75a16adb96899a862e5c4d8195a5cd82f41bd53444387bea744610dfdd462",
  "apps/api/src/widget-ai-runtime-assembly.ts":
    "e00819fe4926069a0214fe1c002f61d114c8b80d9c126068f3b9ef3ef753c9a2"
};

const RETIRED_EXTERNAL_AUTHORITIES = [
  /granit-plan-app/i,
  /ai-agent-stack-wiki/i,
  /codex-refactor-control-plane/i
];

const SELECTOR_PATTERNS = [
  /mastra_openai_api/i,
  /legacy_s05/i,
  /runtimeSelector/i,
  /AI_RUNTIME_MODE/,
  /select[A-Za-z0-9_]*Runtime/,
  /runtimeMode\s*[:=][^\n]*(?:process\.env|config|parse)/i
];

const GLOBAL_SELECTOR_PATTERNS = [
  /runtimeSelector/i,
  /runtimeChoice/i,
  /AI_RUNTIME_MODE/,
  /AI_ENGINE/,
  /process\.env(?:\.|\[["'])[A-Z0-9_]*(?:RUNTIME|ENGINE|PROVIDER|ADAPTER|BACKEND|IMPLEMENTATION|ORCHESTRATOR)/i,
  /select[A-Za-z0-9_]*Runtime/,
  /runtimeMode\s*[:=][^\n]*(?:process\.env|config|parse)/i
];

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const EXACT_CHECK_ARCHITECTURE_SCRIPT =
  "node tooling/ai-architecture-guardrails.mjs && node --test tooling/ai-architecture-guardrails.test.mjs";
const EXACT_BUILD_SCRIPT =
  "npm run check:architecture && npm run typecheck && npm -w @granit/manager run build";

export const REQUIRED_EVIDENCE = [
  {
    path: "apps/api/test/ai-schema-migration-reconciliation.test.ts",
    sha256: "1e58cafa06f42d6a530383a049ea01f502b154e59745d417aae0300e3e2ab6c2",
    minimumTests: 8,
    sentinels: [
      "applies the exact fresh narrow 0001..0022 root chain",
      "fails closed before persistent DDL for a hybrid lineage",
      "rejects cross-run attempt evidence and preserves linked evidence on delete"
    ]
  },
  {
    path: "apps/api/test/widget-ai-postgres-runtime-invariants.test.ts",
    sha256: "7140640b82acca3d2e4fd20cac64fdcd2da179aa9943d8641402dd67d228f1f7",
    minimumTests: 30,
    sentinels: [
      "allows only one concurrent lease owner for one pending job",
      "blocks an in-flight reply after manager takeover",
      "blocks persistence from a worker that lost its lease attempt",
      "atomically commits the direct model-turn body, hash, patches, handoff, run and job"
    ]
  }
];

export function evaluateArchitectureGuardrails(snapshot) {
  const failures = [];
  const files = snapshot.files;
  const fail = (code, message) => failures.push({ code, message });

  const contract = evaluateArchitectureContract(snapshot, fail);

  const guardedStatuses = snapshot.taskDocumentPaths.filter((documentPath) => {
    const source = files.get(documentPath) ?? "";
    if (documentPath === contract?.documents.active_goal) return false;
    if (!isAiTaskDocument(documentPath, source)) return false;
    const status = readCardStatus(source);
    return status === "implementing" || status === "independent_review";
  });

  if (guardedStatuses.length > 1) {
    fail(
      "AI_CARD_LIMIT",
      `more than one AI task document is active: ${guardedStatuses.join(", ")}`
    );
  }

  const taskIndex = requiredFile(files, "docs/tasks/README.md", fail);
  const indexedCards = extractIndexedAiCards(taskIndex);
  if (indexedCards.length !== 1) {
    fail(
      "ACTIVE_CARD_ROUTE",
      `docs/tasks/README.md must route to exactly one AI_REF card; found ${indexedCards.length}`
    );
  }

  for (const cardPath of indexedCards) {
    if (!files.has(cardPath)) {
      fail("ACTIVE_CARD_ROUTE", `indexed active card does not exist: ${cardPath}`);
    }
  }
  if (
    contract &&
    indexedCards.length === 1 &&
    indexedCards[0] !== contract.documents.active_card
  ) {
    fail(
      "ACTIVE_CARD_ROUTE",
      `indexed active card differs from architecture contract: ${indexedCards[0]}`
    );
  }

  const unroutedGuardedStatuses = guardedStatuses.filter(
    (documentPath) => !indexedCards.includes(documentPath)
  );
  if (unroutedGuardedStatuses.length > 0) {
    fail(
      "AI_CARD_LIMIT",
      `active AI task documents are outside the single indexed card: ${unroutedGuardedStatuses.join(", ")}`
    );
  }

  const activeRouteReferences = extractActiveRouteTaskReferences(taskIndex);
  const expectedActiveRouteReferences = [
    "docs/source-of-truth.md",
    "docs/tasks/AI_REFACTOR_SLICE_TEMPLATE_RU.md",
    contract?.documents.active_goal ?? "docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md",
    ...indexedCards
  ].sort();
  if (!arraysEqual(activeRouteReferences, expectedActiveRouteReferences)) {
    fail(
      "ACTIVE_CARD_ROUTE",
      `active AI route must contain only source map, Goal and one AI_REF card; found ${activeRouteReferences.join(", ")}`
    );
  }

  const expectedActiveDocuments = contract?.documents.active_authority_paths ??
    unique([...ACTIVE_AI_DOCUMENTS, ...indexedCards]);
  const sourceMap = requiredFile(files, "docs/source-of-truth.md", fail);
  const declaredActiveDocuments = extractActiveDocumentManifest(sourceMap);
  if (!arraysEqual(declaredActiveDocuments, expectedActiveDocuments)) {
    fail(
      "ACTIVE_DOCUMENT_ROUTE",
      `source map active-document manifest must match the reviewed route; found ${declaredActiveDocuments.join(", ")}`
    );
  }
  for (const reference of extractAuthorityDocumentReferences(sourceMap)) {
    if (!expectedActiveDocuments.includes(reference)) {
      fail(
        "ACTIVE_DOCUMENT_ROUTE",
        `source map declares authority outside the active-document manifest: ${reference}`
      );
    }
  }

  if (contract) {
    const allowedReferences = new Set([
      ...contract.documents.active_authority_paths,
      ...contract.documents.allowed_provenance_paths
    ]);
    for (const reference of extractAllDocumentReferences(sourceMap)) {
      if (!allowedReferences.has(reference)) {
        fail(
          "ACTIVE_DOCUMENT_ROUTE",
          `source map references an unreviewed document: ${reference}`
        );
      }
    }
  }

  for (const documentPath of expectedActiveDocuments) {
    const source = stripFencedCode(requiredFile(files, documentPath, fail), documentPath, fail);
    for (const retiredAuthority of RETIRED_EXTERNAL_AUTHORITIES) {
      if (retiredAuthority.test(source)) {
        fail(
          "ACTIVE_EXTERNAL_AUTHORITY",
          `${documentPath} references retired external planning authority ${retiredAuthority}`
        );
      }
    }
  }

  for (const manifestPath of snapshot.packageManifestPaths) {
    const source = requiredFile(files, manifestPath, fail);
    if (source.includes("@mastra/core")) {
      fail("MASTRA_DEPENDENCY", `${manifestPath} contains @mastra/core`);
    }
  }

  for (const sourcePath of snapshot.productionSourcePaths) {
    const source = requiredFile(files, sourcePath, fail);
    const moduleAnalysis = analyzeModuleSpecifiers(source, sourcePath);
    if (
      moduleAnalysis.specifiers.some(
        (specifier) => specifier === "@mastra/core" || specifier.startsWith("@mastra/core/")
      )
    ) {
      fail("MASTRA_IMPORT", `${sourcePath} imports @mastra/core`);
    }
    if (moduleAnalysis.unresolvedModuleLoads > 0) {
      fail(
        "UNRESOLVED_MODULE_EDGE",
        `${sourcePath} contains an import() or require() edge whose module specifier cannot be resolved statically`
      );
    }
    if (hasRuntimeSelector(source, sourcePath) && !hasAcceptedRuntimeAdr(source, snapshot, files)) {
      fail(
        "RUNTIME_SELECTOR",
        `${sourcePath} contains a runtime selector without an accepted ADR marker`
      );
    }
  }

  for (const assemblyPath of ASSEMBLY_DOCUMENTS) {
    const source = requiredFile(files, assemblyPath, fail);
    const selector = SELECTOR_PATTERNS.find((pattern) => pattern.test(source));
    const selectorFilename = /runtime-(?:mode-)?selector|runtime-resolver/i.test(assemblyPath);
    if ((selector || selectorFilename) && !hasAcceptedRuntimeAdr(source, snapshot, files)) {
      fail(
        "RUNTIME_SELECTOR",
        `${assemblyPath} contains an alternative runtime selector without an accepted ADR marker`
      );
    }
  }

  for (const [assemblyPath, reviewedHash] of Object.entries(
    snapshot.reviewedAssemblyHashes ?? {}
  )) {
    const source = requiredFile(files, assemblyPath, fail);
    if (
      source &&
      sha256(source) !== reviewedHash &&
      !hasAcceptedRuntimeAdr(source, snapshot, files)
    ) {
      fail(
        "RUNTIME_ASSEMBLY",
        `${assemblyPath} changed outside the reviewed single-runtime assembly without an accepted ADR marker`
      );
    }
  }

  for (const sourcePath of snapshot.productionSourcePaths) {
    if (!/runtime-(?:mode-)?selector|runtime-resolver/i.test(sourcePath)) continue;
    const source = requiredFile(files, sourcePath, fail);
    if (!hasAcceptedRuntimeAdr(source, snapshot, files)) {
      fail(
        "RUNTIME_SELECTOR",
        `${sourcePath} is a runtime selector/resolver without an accepted ADR marker`
      );
    }
  }

  for (const exportPath of snapshot.compatibilityExportPaths) {
    const hasConsumer = snapshot.consumerSourcePaths.some((consumerPath) =>
      sourceImportsCompatibilityPath(
        consumerPath,
        requiredFile(files, consumerPath, fail),
        exportPath
      )
    );
    const hasAdr = snapshot.acceptedAdrPaths.some((adrPath) => {
      const source = requiredFile(files, adrPath, fail);
      return isAcceptedAdr(source) && adrCoversCompatibilityExport(source, exportPath);
    });

    if (!hasConsumer && !hasAdr) {
      fail(
        "COMPATIBILITY_EXPORT",
        `${exportPath} has neither an explicit test consumer nor covering accepted ADR`
      );
    }
  }

  for (const evidence of REQUIRED_EVIDENCE) {
    const source = requiredFile(files, evidence.path, fail);
    if (!source) continue;
    const checksum = sha256(source);
    if (checksum !== evidence.sha256) {
      fail(
        "EVIDENCE_TESTS",
        `${evidence.path} checksum changed: ${checksum}; expected reviewed ${evidence.sha256}`
      );
    }
    const testNames = collectExecutableTestNames(source, evidence.path);
    if (testNames.length < evidence.minimumTests) {
      fail(
        "EVIDENCE_TESTS",
        `${evidence.path} has ${testNames.length} executable named tests; expected at least ${evidence.minimumTests}`
      );
    }
    for (const sentinel of evidence.sentinels) {
      if (!testNames.includes(sentinel)) {
        fail("EVIDENCE_TESTS", `${evidence.path} lost required sentinel: ${sentinel}`);
      }
    }
  }

  const rootPackageSource = requiredFile(files, "package.json", fail);
  if (rootPackageSource) {
    try {
      const rootPackage = JSON.parse(rootPackageSource);
      if (rootPackage.scripts?.["check:architecture"] !== EXACT_CHECK_ARCHITECTURE_SCRIPT) {
        fail("GUARD_WIRING", "check:architecture must exactly execute the guard and self-tests");
      }
      if (rootPackage.scripts?.build !== EXACT_BUILD_SCRIPT) {
        fail("GUARD_WIRING", "build must exactly preserve guard, typecheck and manager build steps");
      }
    } catch (error) {
      fail("GUARD_WIRING", `package.json is not valid JSON: ${error.message}`);
    }
  }

  return failures;
}

function evaluateArchitectureContract(snapshot, fail) {
  const contract = snapshot.architectureContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    fail("ARCHITECTURE_CONTRACT", "architecture contract is missing or is not an object");
    return undefined;
  }
  if (!hasExactKeys(contract, ["schema_version", "production", "documents", "compatibility"])) {
    fail("ARCHITECTURE_CONTRACT", "architecture contract has missing or unknown top-level fields");
    return undefined;
  }
  if (
    contract.schema_version !== 1 ||
    !hasExactKeys(contract.production, [
      "roots",
      "assembly_paths",
      "provider_boundary",
      "source_count",
      "source_paths_sha256",
      "source_contents_sha256"
    ]) ||
    !hasExactKeys(contract.documents, [
      "active_goal",
      "active_card",
      "active_authority_paths",
      "allowed_provenance_paths",
      "task_count",
      "task_paths_sha256",
      "routing_surface_hashes"
    ]) ||
    !hasExactKeys(contract.compatibility, ["legacy_roots", "entries"])
  ) {
    fail("ARCHITECTURE_CONTRACT", "architecture contract schema is unsupported or malformed");
    return undefined;
  }

  const productionPaths = unique(snapshot.productionSourcePaths);
  const production = contract.production;
  if (
    !isUniquePathArray(production.roots) ||
    !isUniquePathArray(production.assembly_paths) ||
    typeof production.provider_boundary !== "string" ||
    !productionPaths.includes(production.provider_boundary) ||
    [...production.roots, ...production.assembly_paths].some(
      (sourcePath) => !productionPaths.includes(sourcePath)
    )
  ) {
    fail("ARCHITECTURE_CONTRACT", "production roots, assembly paths or provider boundary are invalid");
  }
  const actualProductionPathsHash = pathSetHash(productionPaths);
  if (
    production.source_count !== productionPaths.length ||
    production.source_paths_sha256 !== actualProductionPathsHash
  ) {
    fail(
      "RUNTIME_SOURCE_SET",
      `production source closure changed: ${productionPaths.length} files, ${actualProductionPathsHash}`
    );
  }
  const actualProductionContentsHash = contentSetHash(productionPaths, snapshot.files, fail);
  if (production.source_contents_sha256 !== actualProductionContentsHash) {
    fail(
      "RUNTIME_CLOSURE_HASH",
      `production source closure content changed: ${actualProductionContentsHash}`
    );
  }

  const documents = contract.documents;
  if (
    !isUniquePathArray(documents.active_authority_paths) ||
    !isUniquePathArray(documents.allowed_provenance_paths) ||
    !documents.active_authority_paths.includes(documents.active_goal) ||
    !documents.active_authority_paths.includes(documents.active_card) ||
    documents.allowed_provenance_paths.some((value) =>
      documents.active_authority_paths.includes(value)
    ) ||
    !hasStringValues(documents.routing_surface_hashes)
  ) {
    fail("ARCHITECTURE_CONTRACT", "document authority contract is malformed");
  }
  const taskPaths = unique(snapshot.taskDocumentPaths);
  const actualTaskPathsHash = pathSetHash(taskPaths);
  if (
    documents.task_count !== taskPaths.length ||
    documents.task_paths_sha256 !== actualTaskPathsHash
  ) {
    fail(
      "TASK_DOCUMENT_SET",
      `task document set changed: ${taskPaths.length} files, ${actualTaskPathsHash}`
    );
  }
  for (const [documentPath, expectedHash] of Object.entries(
    documents.routing_surface_hashes ?? {}
  )) {
    const source = requiredFile(snapshot.files, documentPath, fail);
    const actualHash = sha256(source);
    if (expectedHash !== actualHash) {
      fail(
        "ROUTING_SURFACE_HASH",
        `${documentPath} routing surface changed: ${actualHash}`
      );
    }
  }

  const compatibility = contract.compatibility;
  if (!isUniquePathArray(compatibility.legacy_roots) || !Array.isArray(compatibility.entries)) {
    fail("ARCHITECTURE_CONTRACT", "compatibility contract is malformed");
    return contract;
  }
  const contractEntries = [];
  for (const entry of compatibility.entries) {
    if (
      !hasExactKeys(entry, ["path", "targets"]) ||
      typeof entry.path !== "string" ||
      !isUniqueStringArray(entry.targets) ||
      !compatibility.legacy_roots.some((root) => entry.path.startsWith(`${root}/`))
    ) {
      fail("ARCHITECTURE_CONTRACT", "compatibility entry is malformed or outside legacy roots");
      continue;
    }
    contractEntries.push(entry.path);
    const source = requiredFile(snapshot.files, entry.path, fail);
    const actualTargets = collectDirectCompatibilityTargets(source, entry.path);
    if (!actualTargets || !arraysEqual(actualTargets, unique(entry.targets))) {
      fail(
        "COMPATIBILITY_SHAPE",
        `${entry.path} is not the reviewed direct forwarding shim to ${entry.targets.join(", ")}`
      );
    }
  }
  if (unique(contractEntries).length !== compatibility.entries.length) {
    fail("ARCHITECTURE_CONTRACT", "compatibility contract contains duplicate entries");
  }
  const legacySourcePaths = productionPaths.filter((sourcePath) =>
    compatibility.legacy_roots.some((root) => sourcePath.startsWith(`${root}/`))
  );
  const reviewedEntries = unique(contractEntries);
  if (
    !arraysEqual(legacySourcePaths, reviewedEntries) ||
    !arraysEqual(unique(snapshot.compatibilityExportPaths), reviewedEntries)
  ) {
    fail(
      "COMPAT_ENTRY_SET",
      `compatibility entry set differs from the reviewed ${reviewedEntries.length}-file baseline`
    );
  }

  return contract;
}

export function loadRepositorySnapshot(root = process.cwd()) {
  const files = new Map();
  const addFile = (relativePath) => {
    const normalized = normalizePath(relativePath);
    files.set(normalized, readGuardInput(root, normalized));
    return normalized;
  };
  const addTree = (relativeRoot, predicate) =>
    listFiles(path.join(root, relativeRoot))
      .map((absolutePath) => normalizePath(path.relative(root, absolutePath)))
      .filter(predicate)
      .map(addFile);

  for (const documentPath of ACTIVE_AI_DOCUMENTS) addFile(documentPath);
  for (const assemblyPath of ASSEMBLY_DOCUMENTS) addFile(assemblyPath);
  addFile("package.json");
  const architectureContractSource = addFile(ARCHITECTURE_CONTRACT_PATH);
  const architectureContract = JSON.parse(files.get(architectureContractSource));

  const taskDocumentPaths = listFiles(path.join(root, "docs/tasks"))
    .map((absolutePath) => normalizePath(path.relative(root, absolutePath)))
    .filter((relativePath) => relativePath.endsWith(".md"))
    .map(addFile);
  const aiCardPaths = taskDocumentPaths.filter((relativePath) =>
    /^docs\/tasks\/AI_REF_.*\.md$/.test(relativePath)
  );
  const acceptedAdrPaths = addTree(
    "docs/adr",
    (relativePath) => relativePath.endsWith(".md")
  );
  const documentationPaths = addTree(
    "docs",
    (relativePath) => relativePath.endsWith(".md")
  );
  const productionSourcePaths = [
    ...addTree(
      "apps",
      (relativePath) => /\/src\/.*\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(relativePath)
    ),
    ...addTree(
      "packages",
      (relativePath) => /\/src\/.*\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(relativePath)
    )
  ];
  const packageManifestPaths = [
    "package.json",
    ...addTree("apps", (relativePath) => relativePath.endsWith("/package.json")),
    ...addTree("packages", (relativePath) => relativePath.endsWith("/package.json"))
  ];
  if (statSync(path.join(root, "package-lock.json"), { throwIfNoEntry: false })) {
    packageManifestPaths.push(addFile("package-lock.json"));
  }
  const compatibilityExportPaths = productionSourcePaths.filter(
    (relativePath) =>
      relativePath.startsWith("apps/api/src/") &&
      isCompatibilityExportSource(files.get(relativePath) ?? "", relativePath)
  );
  const consumerSourcePaths = addTree(
    "apps/api/test",
    (relativePath) => /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(relativePath)
  );

  for (const evidence of REQUIRED_EVIDENCE) addFile(evidence.path);

  return {
    files,
    architectureContract,
    aiCardPaths: unique(aiCardPaths),
    taskDocumentPaths: unique(taskDocumentPaths),
    acceptedAdrPaths: unique(acceptedAdrPaths),
    documentationPaths: unique(documentationPaths),
    productionSourcePaths: unique(productionSourcePaths),
    reviewedAssemblyHashes: { ...REVIEWED_ASSEMBLY_HASHES },
    packageManifestPaths: unique(packageManifestPaths),
    compatibilityExportPaths: unique(compatibilityExportPaths),
    consumerSourcePaths: unique(consumerSourcePaths)
  };
}

export function ensureNonSymbolicGuardInput(filePath, fileStats) {
  if (fileStats.isSymbolicLink()) {
    throw new Error(`symbolic link is not an allowed guard input: ${filePath}`);
  }
}

export function readGuardInput(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  ensureNonSymbolicGuardInput(absolutePath, lstatSync(absolutePath));
  return readFileSync(absolutePath, "utf8");
}

function requiredFile(files, filePath, fail) {
  const source = files.get(filePath);
  if (source === undefined) {
    fail("REQUIRED_FILE", `required guard input is missing: ${filePath}`);
    return "";
  }
  return source;
}

function readCardStatus(source = "") {
  const rawStatus = source.match(/^(?:Статус|Status):\s*([^\n]+)/im)?.[1] ?? "";
  const normalizedStatus = rawStatus
    .replace(/<[^>]*>/g, "")
    .trim()
    .replace(/^[`*~_]+/, "")
    .replace(/[`*~_.]+$/, "")
    .trim();
  return normalizedStatus.match(/^([a-z_]+)/i)?.[1]?.toLowerCase() ?? "unknown";
}

function isAiTaskDocument(documentPath, source) {
  const filename = path.basename(documentPath);
  const firstHeading = source.match(/^#\s+([^\n]+)/m)?.[1] ?? "";
  return (
    /(?:^|_)AI(?:_|\.)/i.test(filename) ||
    /(?:MODEL|RUNTIME|AGENT).*(?:PLAN|ROADMAP)|(?:PLAN|ROADMAP).*(?:MODEL|RUNTIME|AGENT)/i.test(
      filename
    ) ||
    /Goal:\s*`?AI-RUNTIME-CONVERGENCE/i.test(source) ||
    /\b(?:AI|ИИ)\b/i.test(firstHeading)
  );
}

function extractActiveDocumentManifest(source) {
  const block = source.match(
    /<!--\s*architecture-guard:\s*active-ai-documents\s*\n([\s\S]*?)\n\s*-->/i
  )?.[1];
  if (!block) return [];
  return unique(
    block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(?:AGENTS|README|docs\/[A-Za-z0-9_./-]+)\.md$/.test(line))
  );
}

function extractAuthorityDocumentReferences(source) {
  const authoritativeSource = stripNonAuthoritativeMarkdown(source);
  const authorityHeading = authoritativeSource.search(/^## Authority\s*$/im);
  const authorityRemainder = authorityHeading < 0
    ? []
    : authoritativeSource.slice(authorityHeading).split("\n");
  const nextHeading = authorityRemainder.findIndex(
    (line, index) => index > 0 && /^##\s/.test(line)
  );
  const authoritySection = authorityRemainder
    .slice(0, nextHeading < 0 ? undefined : nextHeading)
    .join("\n");
  const directiveLines = authoritativeSource
    .split("\n")
    .filter((line) =>
      /\b(?:active|current|authority|authoritative|canonical|governing|controlling|source[- ]of[- ]truth)\b|(?:активн|текущ|канонич|источник\s+истины|полномочи|руководящ)/i.test(
        line
      )
    )
    .join("\n");
  return unique(
    [...`${authoritySection}\n${directiveLines}`.matchAll(
      /docs\/[A-Za-z0-9_./-]+\.md/g
    )].map((match) =>
        normalizePath(path.normalize(match[0]))
      )
  );
}

function extractAllDocumentReferences(source) {
  return unique(
    [...stripNonAuthoritativeMarkdown(source).matchAll(/docs\/[A-Za-z0-9_./-]+\.md/g)].map(
      (match) => normalizePath(path.normalize(match[0]))
    )
  );
}

function extractIndexedAiCards(source) {
  const activeRoute = extractActiveRouteSection(source);
  return unique(
    [...activeRoute.matchAll(/`(AI_REF_[A-Z0-9_]+\.md)`/g)].map(
      (match) => `docs/tasks/${match[1]}`
    )
  );
}

function extractActiveRouteTaskReferences(source) {
  const section = extractActiveRouteSection(source);
  return unique(
    [...section.matchAll(/(?:\.\.\/)?[A-Za-z0-9_./-]+\.md/g)].map((match) =>
      normalizePath(path.normalize(path.join("docs/tasks", match[0])))
    )
  );
}

function extractActiveRouteSection(source) {
  const headingIndex = source.search(/^## Active AI route\s*$/m);
  if (headingIndex < 0) return "";
  const remainder = source.slice(headingIndex).split("\n");
  const nextHeadingIndex = remainder.findIndex(
    (line, index) => index > 0 && /^##\s/.test(line)
  );
  return remainder.slice(1, nextHeadingIndex < 0 ? undefined : nextHeadingIndex).join("\n");
}

function hasAcceptedRuntimeAdr(source, snapshot, files) {
  const marker = source.match(/architecture-guard:\s*accepted-adr\s+(ADR-\d+)/i)?.[1];
  if (!marker) return false;
  return snapshot.acceptedAdrPaths.some((adrPath) => {
    if (!path.basename(adrPath).startsWith(marker)) return false;
    const adrSource = files.get(adrPath) ?? "";
    const metadata = readAdrMetadata(adrSource);
    return (
      metadata.id === marker &&
      metadata.accepted &&
      /^Architecture-guard approval:\s*second-runtime\s*$/im.test(metadata.authoritativeSource)
    );
  });
}

function isAcceptedAdr(source) {
  return readAdrMetadata(source).accepted;
}

function readAdrMetadata(source) {
  const authoritativeSource = stripNonAuthoritativeMarkdown(source);
  const preamble = authoritativeSource.split(/^##\s/m, 1)[0] ?? "";
  const id = preamble.match(/^#\s+(ADR-\d+)\b/m)?.[1];
  const statuses = [...preamble.matchAll(/^(?:Status|Статус):\s*([^\n]+)$/gim)].map(
    (match) => match[1].trim()
  );
  return {
    id,
    accepted: statuses.length === 1 && /^accepted\b/i.test(statuses[0]),
    authoritativeSource
  };
}

function adrCoversCompatibilityExport(source, exportPath) {
  const metadata = readAdrMetadata(source);
  const isAdr009 = metadata.id === "ADR-009";
  const adr009Scope = /^apps\/api\/src\/(?:auth|routes|services|repositories)\//.test(exportPath);
  if (isAdr009 && adr009Scope) return true;
  const approvedScopes = [...metadata.authoritativeSource.matchAll(
    /^Architecture-guard compatibility scope:\s*`([^`]+)`\s*$/gim
  )].map((match) => normalizePath(match[1]));
  return approvedScopes.some(
    (scope) => exportPath === scope || (scope.endsWith("/") && exportPath.startsWith(scope))
  );
}

function sourceImportsCompatibilityPath(consumerPath, source, exportPath) {
  const specifiers = collectModuleSpecifiers(source, consumerPath);
  return specifiers.some((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const resolved = normalizePath(path.join(path.dirname(consumerPath), specifier));
    const withoutExtension = resolved.replace(/\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/, "");
    const targetWithoutExtension = exportPath.replace(/\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/, "");
    return withoutExtension === targetWithoutExtension;
  });
}

function collectModuleSpecifiers(source, filePath) {
  return analyzeModuleSpecifiers(source, filePath).specifiers;
}

function analyzeModuleSpecifiers(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const bindings = collectStaticStringBindings(sourceFile);
  const specifiers = [];
  let unresolvedModuleLoads = 0;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    ) {
      const specifier = staticStringValue(node.arguments[0], bindings);
      if (specifier !== undefined) specifiers.push(specifier);
      else unresolvedModuleLoads += 1;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments[0]
    ) {
      const specifier = staticStringValue(node.arguments[0], bindings);
      if (specifier !== undefined) specifiers.push(specifier);
      else unresolvedModuleLoads += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { specifiers, unresolvedModuleLoads };
}

function collectStaticStringBindings(sourceFile) {
  const bindings = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function staticStringValue(node, bindings = new Map(), resolving = new Set()) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isIdentifier(node) && bindings.has(node.text) && !resolving.has(node.text)) {
    const nextResolving = new Set(resolving).add(node.text);
    return staticStringValue(bindings.get(node.text), bindings, nextResolving);
  }
  if (ts.isParenthesizedExpression(node)) {
    return staticStringValue(node.expression, bindings, resolving);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(node.left, bindings, resolving);
    const right = staticStringValue(node.right, bindings, resolving);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = staticStringValue(span.expression, bindings, resolving);
      if (expression === undefined) return undefined;
      value += expression + span.literal.text;
    }
    return value;
  }
  return undefined;
}

export function isCompatibilityExportSource(source, filePath = "compatibility.ts") {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const directForward = sourceFile.statements.some(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /(?:^|\/)modules\//.test(statement.moduleSpecifier.text)
    );
  if (directForward) return true;

  const importedFromModules = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
        const call = declaration.initializer;
        if (
          !ts.isIdentifier(call.expression) ||
          call.expression.text !== "require" ||
          !call.arguments[0]
        ) {
          continue;
        }
        const specifier = staticStringValue(
          call.arguments[0],
          collectStaticStringBindings(sourceFile)
        );
        if (specifier === undefined || !/(?:^|\/)modules\//.test(specifier)) continue;
        collectBindingIdentifiers(declaration.name, importedFromModules);
      }
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/(?:^|\/)modules\//.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) importedFromModules.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      importedFromModules.add(clause.namedBindings.name.text);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        importedFromModules.add(element.name.text);
      }
    }
  }

  const esmForward = sourceFile.statements.some((statement) => {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.some((element) =>
        importedFromModules.has((element.propertyName ?? element.name).text)
      );
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return statement.declarationList.declarations.some(
        (declaration) =>
          declaration.initializer &&
          expressionReferencesIdentifiers(declaration.initializer, importedFromModules)
      );
    }
    return (
      ts.isExportAssignment(statement) &&
      expressionReferencesIdentifiers(statement.expression, importedFromModules)
    );
  });
  if (esmForward) return true;

  return sourceFile.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
      return false;
    }
    const assignment = statement.expression;
    if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    const leftText = assignment.left.getText(sourceFile);
    if (!/^(?:module\.exports|exports(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]+\]))$/.test(leftText)) {
      return false;
    }
    if (expressionReferencesIdentifiers(assignment.right, importedFromModules)) return true;
    const requiredModules = [];
    const collectRequires = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments[0]
      ) {
        const value = staticStringValue(node.arguments[0], collectStaticStringBindings(sourceFile));
        if (value !== undefined) requiredModules.push(value);
      }
      ts.forEachChild(node, collectRequires);
    };
    collectRequires(assignment.right);
    return requiredModules.some((specifier) => /(?:^|\/)modules\//.test(specifier));
  });
}

function collectBindingIdentifiers(name, result) {
  if (ts.isIdentifier(name)) {
    result.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingIdentifiers(element.name, result);
  }
}

function expressionReferencesIdentifiers(node, identifiers) {
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (ts.isIdentifier(current) && identifiers.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function collectExecutableTestNames(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const names = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "it" || node.expression.text === "test")
    ) {
      const [name] = node.arguments;
      if (name && (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) {
        names.push(name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function hasRuntimeSelector(source, filePath) {
  if (/runtime-(?:mode-)?selector|runtime-resolver/i.test(filePath)) return true;
  if (GLOBAL_SELECTOR_PATTERNS.some((pattern) => pattern.test(source))) return true;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const { aliases: choiceAliases, containerAliases } = collectRuntimeChoiceAliases(sourceFile);
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isSwitchStatement(node)
    ) {
      const condition = choiceCondition(node);
      const conditionText = condition?.getText(sourceFile) ?? "";
      const readsChoice =
        isRuntimeChoiceSource(conditionText) ||
        (condition && expressionReadsRuntimeChoice(
          condition,
          sourceFile,
          choiceAliases,
          containerAliases
        )) ||
        [...choiceAliases].some((alias) =>
          new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(conditionText)
        );
      if (readsChoice) found = true;
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      expressionReadsRuntimeChoice(
        node.argumentExpression,
        sourceFile,
        choiceAliases,
        containerAliases
      )
    ) {
      found = true;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      const selectorCall =
        /(?:^|\.)(?:get|select[A-Za-z0-9_$]*|resolve[A-Za-z0-9_$]*|create[A-Za-z0-9_$]*|[A-Za-z0-9_$]*(?:Factory|Selector))$/.test(
          callee
        );
      if (
        selectorCall &&
        node.arguments.some((argument) =>
          expressionReadsRuntimeChoice(
            argument,
            sourceFile,
            choiceAliases,
            containerAliases
          )
        )
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function collectRuntimeChoiceAliases(sourceFile) {
  const aliases = new Set();
  const containerAliases = new Set(["config", "settings", "options"]);
  const declarations = [];
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const initializerText = declaration.initializer.getText(sourceFile);
      if (ts.isIdentifier(declaration.name)) {
        const isContainer =
          isRuntimeChoiceContainer(initializerText, containerAliases) ||
          [...containerAliases].some((alias) =>
            new RegExp(`^\\s*${escapeRegExp(alias)}\\s*$`).test(initializerText)
          );
        if (isContainer && !containerAliases.has(declaration.name.text)) {
          containerAliases.add(declaration.name.text);
          changed = true;
        }
        const isChoice =
          expressionReadsRuntimeChoice(
            declaration.initializer,
            sourceFile,
            aliases,
            containerAliases
          ) ||
          [...aliases].some((alias) =>
            new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(initializerText)
          );
        if (isChoice && !aliases.has(declaration.name.text)) {
          aliases.add(declaration.name.text);
          changed = true;
        }
        continue;
      }
      if (
        ts.isObjectBindingPattern(declaration.name) &&
        isRuntimeChoiceContainer(initializerText, containerAliases)
      ) {
        const keyMatches = (value) =>
          (/^AI_/i.test(value) && isRuntimeChoiceEnvKey(value)) ||
          isRuntimeChoicePropertyKey(value);
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const sourceName = element.propertyName?.getText(sourceFile) ?? element.name.text;
          if (!keyMatches(sourceName) || aliases.has(element.name.text)) continue;
          aliases.add(element.name.text);
          changed = true;
        }
      }
    }
  }
  return { aliases, containerAliases };
}

function choiceCondition(node) {
  if (ts.isIfStatement(node)) return node.expression;
  if (ts.isConditionalExpression(node)) return node.condition;
  if (ts.isSwitchStatement(node)) return node.expression;
  return undefined;
}

function isRuntimeChoiceSource(source) {
  const normalized = source.replace(/\s+/g, "");
  const envKeys = [
    ...normalized.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/gi)
  ].map((match) => match[1] ?? match[2] ?? "");
  if (
    envKeys.some(
      (key) =>
        /^AI_/i.test(key) &&
        isRuntimeChoiceEnvKey(key)
    )
  ) {
    return true;
  }
  const choiceProperties = [
    ...source.matchAll(
      /\b(?:config|settings|options)(?:\?\.)?\.([A-Za-z_$][A-Za-z0-9_$]*)/gi
    ),
    ...source.matchAll(
      /\b(?:config|settings|options)(?:\?\.)?\[["']([A-Za-z_$][A-Za-z0-9_$]*)["']\]/gi
    )
  ].map((match) => match[1] ?? "");
  return choiceProperties.some(isRuntimeChoicePropertyKey);
}

function expressionReadsRuntimeChoice(node, sourceFile, aliases, containerAliases = new Set()) {
  const expressionText = node.getText(sourceFile);
  if (
    isRuntimeChoiceSource(expressionText) ||
    [...aliases].some((alias) =>
      new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(expressionText)
    )
  ) {
    return true;
  }
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(current)) {
      const container = current.expression.getText(sourceFile);
      const key = current.name.text;
      if (
        isKnownRuntimeContainer(container, containerAliases) &&
        ((/^AI_/i.test(key) && isRuntimeChoiceEnvKey(key)) ||
          isRuntimeChoicePropertyKey(key))
      ) {
        found = true;
        return;
      }
    }
    if (
      ts.isElementAccessExpression(current) &&
      current.argumentExpression &&
      (ts.isStringLiteral(current.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(current.argumentExpression))
    ) {
      const container = current.expression.getText(sourceFile);
      const key = current.argumentExpression.text;
      if (
        isKnownRuntimeContainer(container, containerAliases) &&
        ((/^AI_/i.test(key) && isRuntimeChoiceEnvKey(key)) ||
          isRuntimeChoicePropertyKey(key))
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isKnownRuntimeContainer(source, containerAliases) {
  const normalized = source.replace(/\s+/g, "");
  return (
    normalized === "process.env" ||
    containerAliases.has(normalized) ||
    /^(?:config|settings|options)$/.test(normalized)
  );
}

function isRuntimeChoiceContainer(source, containerAliases = new Set()) {
  const normalized = source.replace(/\s+/g, "");
  if (normalized === "process.env") return true;
  return containerAliases.has(normalized);
}

function isRuntimeChoiceEnvKey(value) {
  return /(?:^|_)(?:CHOICE|MODE|RUNTIME|ENGINE|PROVIDER|ADAPTER|BACKEND|IMPLEMENTATION|ORCHESTRATOR|CLIENT)(?:_|$)/i.test(
    value
  );
}

function isRuntimeChoicePropertyKey(value) {
  return /^(?:ai[A-Z_]|runtime[A-Z_]|[A-Za-z0-9_]+(?:Choice|Mode)$)/.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripFencedCode(source, documentPath, fail) {
  const lines = source.split("\n");
  let fence;
  const stripped = lines
    .filter((line) => {
      if (!fence) {
        const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (!opening) return true;
        fence = { marker: opening[1][0], length: opening[1].length };
        return false;
      }
      const closing = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
      return false;
    })
    .join("\n");
  if (fence) {
    fail("ACTIVE_DOCUMENT_FORMAT", `${documentPath} contains an unclosed fenced block`);
  }
  return stripped;
}

function stripNonAuthoritativeMarkdown(source) {
  const lines = source.split("\n");
  let fence;
  let htmlComment = false;
  let lazyBlockquote = false;
  return lines
    .filter((line) => {
      if (htmlComment) {
        if (line.includes("-->")) htmlComment = false;
        return false;
      }
      if (!fence) {
        const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (opening) {
          fence = { marker: opening[1][0], length: opening[1].length };
          return false;
        }
        const commentStart = line.indexOf("<!--");
        if (commentStart >= 0) {
          if (!line.slice(commentStart + 4).includes("-->")) htmlComment = true;
          return line.slice(0, commentStart).trim().length > 0;
        }
        if (/^(?: {4}|\t)/.test(line)) return false;
        if (/^\s*>/.test(line)) {
          lazyBlockquote = true;
          return false;
        }
        if (lazyBlockquote) {
          if (line.trim() === "") lazyBlockquote = false;
          return false;
        }
        return true;
      }
      const closing = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
      return false;
    })
    .join("\n");
}

function collectDirectCompatibilityTargets(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  if (sourceFile.parseDiagnostics.length > 0 || sourceFile.statements.length === 0) {
    return undefined;
  }
  const targets = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/(?:^|\/)modules\//.test(statement.moduleSpecifier.text)
    ) {
      return undefined;
    }
    targets.push(statement.moduleSpecifier.text);
  }
  return unique(targets);
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (IGNORED_DIRECTORIES.has(entry.name)) return [];
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic link is not an allowed guard input: ${entryPath}`);
    }
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values)].sort();
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return arraysEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function isUniqueStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length
  );
}

function isUniquePathArray(value) {
  return (
    isUniqueStringArray(value) &&
    value.every((item) => normalizePath(path.normalize(item)) === item)
  );
}

function hasStringValues(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((item) => typeof item === "string" && /^[a-f0-9]{64}$/.test(item))
  );
}

function pathSetHash(paths) {
  return sha256(`${unique(paths).join("\n")}\n`);
}

function contentSetHash(paths, files, fail) {
  return sha256(
    unique(paths)
      .map((filePath) => `${filePath}\0${sha256(requiredFile(files, filePath, fail))}`)
      .join("\n")
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const snapshot = loadRepositorySnapshot();
    const failures = evaluateArchitectureGuardrails(snapshot);
    if (failures.length > 0) {
      for (const failure of failures) {
        process.stderr.write(`[architecture-guard:${failure.code}] ${failure.message}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `[architecture-guard] passed: ${snapshot.aiCardPaths.length} AI cards, ` +
          `${snapshot.productionSourcePaths.length} production sources, ` +
          `${snapshot.compatibilityExportPaths.length} compatibility exports\n`
      );
    }
  } catch (error) {
    process.stderr.write(`[architecture-guard:UNREADABLE_INPUT] ${error.message}\n`);
    process.exitCode = 1;
  }
}
