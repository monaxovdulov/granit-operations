import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ARCHITECTURE_CONTRACT_PATH,
  ensureNonSymbolicGuardInput,
  evaluateArchitectureGuardrails,
  isCompatibilityExportSource,
  loadRepositorySnapshot,
  REQUIRED_EVIDENCE
} from "./ai-architecture-guardrails.mjs";

const ACTIVE_DOCUMENTS = [
  "AGENTS.md",
  "README.md",
  "docs/source-of-truth.md",
  "docs/AGENT_WORKFLOW.md",
  "docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md",
  "docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md",
  "docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md",
  "docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md",
  "docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md",
  "docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md",
  "docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md",
  "docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md"
];

const ASSEMBLY_DOCUMENTS = [
  "apps/api/src/app.ts",
  "apps/api/src/app-context.ts",
  "apps/api/src/config.ts",
  "apps/api/src/index.ts",
  "apps/api/src/widget-ai-runtime-assembly.ts"
];

test("passing fixture exercises the same evaluator as the CLI", () => {
  assert.deepEqual(evaluateArchitectureGuardrails(passingSnapshot()), []);
});

test("filesystem fixture exercises the repository loader before evaluation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "granit-architecture-guard-"));
  try {
    materializeSnapshot(root, passingSnapshot());
    mkdirSync(path.join(root, "packages"), { recursive: true });
    const snapshot = loadRepositorySnapshot(root);
    snapshot.reviewedAssemblyHashes = Object.fromEntries(
      ASSEMBLY_DOCUMENTS.map((assemblyPath) => [
        assemblyPath,
        createHash("sha256").update(snapshot.files.get(assemblyPath)).digest("hex")
      ])
    );
    assert.deepEqual(evaluateArchitectureGuardrails(snapshot), []);

    const dynamicImportPath = "apps/api/src/modules/ai/dynamic-runtime.ts";
    writeFixtureFile(root, dynamicImportPath, "export const load = (name) => import(name);\n");
    const mutated = loadRepositorySnapshot(root);
    mutated.reviewedAssemblyHashes = snapshot.reviewedAssemblyHashes;
    assertFailure(mutated, "UNRESOLVED_MODULE_EDGE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects more than one implementing or independent-review AI card", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set("docs/tasks/AI_REF_SECOND.md", "Статус: `independent_review`.\n");
  snapshot.aiCardPaths.push("docs/tasks/AI_REF_SECOND.md");
  snapshot.taskDocumentPaths.push("docs/tasks/AI_REF_SECOND.md");
  assertFailure(snapshot, "AI_CARD_LIMIT");
});

test("allows the long-lived implementing Goal while its card is in independent review", () => {
  const snapshot = passingSnapshot();
  const activeCard = snapshot.aiCardPaths[0];
  snapshot.files.set(activeCard, "Статус: `independent_review`.\n");
  snapshot.files.set("docs/tasks/OPERATIONS_TASK.md", "Status: implementing\n");
  snapshot.taskDocumentPaths.push("docs/tasks/OPERATIONS_TASK.md");
  refreshArchitectureContract(snapshot);
  assert.deepEqual(evaluateArchitectureGuardrails(snapshot), []);
});

test("rejects a second active task document even when it is not named AI_REF", () => {
  const snapshot = passingSnapshot();
  const secondPlan = "docs/tasks/SECOND_ACTIVE_AI_PLAN.md";
  snapshot.files.set(secondPlan, "Status: implementing\n");
  snapshot.taskDocumentPaths.push(secondPlan);
  assertFailure(snapshot, "AI_CARD_LIMIT");

  const routedSnapshot = passingSnapshot();
  routedSnapshot.files.set(secondPlan, "Status: historical\n");
  routedSnapshot.taskDocumentPaths.push(secondPlan);
  routedSnapshot.files.set(
    "docs/tasks/README.md",
    activeRouteIndex("AI_REF_CONV_5_FIXTURE.md", "4. `SECOND_ACTIVE_AI_PLAN.md`\n")
  );
  assertFailure(routedSnapshot, "ACTIVE_CARD_ROUTE");

  const formattedStatusSnapshot = passingSnapshot();
  formattedStatusSnapshot.files.set(secondPlan, "Status: **implementing**\n");
  formattedStatusSnapshot.taskDocumentPaths.push(secondPlan);
  assertFailure(formattedStatusSnapshot, "AI_CARD_LIMIT");

  const linkedSnapshot = passingSnapshot();
  linkedSnapshot.files.set(secondPlan, "Status: historical\n");
  linkedSnapshot.taskDocumentPaths.push(secondPlan);
  linkedSnapshot.files.set(
    "docs/tasks/README.md",
    activeRouteIndex(
      "AI_REF_CONV_5_FIXTURE.md",
      "4. [Second](SECOND_ACTIVE_AI_PLAN.md)\n"
    )
  );
  assertFailure(linkedSnapshot, "ACTIVE_CARD_ROUTE");

  const technicalDoneSnapshot = passingSnapshot();
  technicalDoneSnapshot.files.set(
    technicalDoneSnapshot.aiCardPaths[0],
    "Статус: `technical_done`.\n"
  );
  const semanticPlan = "docs/tasks/MODEL_RUNTIME_PLAN.md";
  technicalDoneSnapshot.files.set(
    semanticPlan,
    "# AI model runtime plan\n\nStatus: implementing\n"
  );
  technicalDoneSnapshot.taskDocumentPaths.push(semanticPlan);
  assertFailure(technicalDoneSnapshot, "AI_CARD_LIMIT");
});

test("rejects retired external planning authority in the active route", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set("docs/source-of-truth.md", "Use granit-plan-app as authority.\n");
  assertFailure(snapshot, "ACTIVE_EXTERNAL_AUTHORITY");

  const indirectionSnapshot = passingSnapshot();
  const indirectAuthority = "docs/architecture/NEW_MODEL_PLAN.md";
  indirectionSnapshot.files.set(
    "docs/source-of-truth.md",
    `Current authority: ${indirectAuthority}\n`
  );
  indirectionSnapshot.files.set(
    indirectAuthority,
    "Use granit-plan-app as authority.\n"
  );
  assertFailure(indirectionSnapshot, "ACTIVE_DOCUMENT_ROUTE");

  const canonicalSnapshot = passingSnapshot();
  canonicalSnapshot.files.set(
    "docs/source-of-truth.md",
    activeDocumentManifest(canonicalSnapshot.aiCardPaths[0]) +
      "\nCanonical source: docs/architecture/NEW_MODEL_PLAN.md\n"
  );
  canonicalSnapshot.files.set(
    "docs/architecture/NEW_MODEL_PLAN.md",
    "Use granit-plan-app as authority.\n"
  );
  assertFailure(canonicalSnapshot, "ACTIVE_DOCUMENT_ROUTE");

  for (const declaration of [
    "Governing document: docs/architecture/UNDECLARED_MODEL_PLAN.md",
    "Главный руководящий документ: docs/architecture/UNDECLARED_MODEL_PLAN.md",
    "Follow docs/architecture/UNDECLARED_MODEL_PLAN.md as the controlling document"
  ]) {
    const naturalAuthoritySnapshot = passingSnapshot();
    naturalAuthoritySnapshot.files.set(
      "docs/source-of-truth.md",
      activeDocumentManifest(naturalAuthoritySnapshot.aiCardPaths[0]) + `\n${declaration}\n`
    );
    assertFailure(naturalAuthoritySnapshot, "ACTIVE_DOCUMENT_ROUTE");
  }
});

test("rejects an unclosed active-document fence", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set("docs/source-of-truth.md", "```text\nUse granit-plan-app as authority.\n");
  assertFailure(snapshot, "ACTIVE_DOCUMENT_FORMAT");

  const shortClosingFence = passingSnapshot();
  shortClosingFence.files.set(
    "docs/source-of-truth.md",
    "````text\nUse granit-plan-app as authority.\n```\n"
  );
  assertFailure(shortClosingFence, "ACTIVE_DOCUMENT_FORMAT");
});

test("rejects a Mastra package dependency and production import", () => {
  const dependencySnapshot = passingSnapshot();
  dependencySnapshot.files.set("package-lock.json", '"@mastra/core": "1.0.0"');
  dependencySnapshot.packageManifestPaths.push("package-lock.json");
  assertFailure(dependencySnapshot, "MASTRA_DEPENDENCY");

  const importSnapshot = passingSnapshot();
  importSnapshot.files.set("apps/api/src/feature.ts", "await import(`@mastra/core`);");
  importSnapshot.productionSourcePaths.push("apps/api/src/feature.ts");
  assertFailure(importSnapshot, "MASTRA_IMPORT");

  const computedImportSnapshot = passingSnapshot();
  computedImportSnapshot.files.set(
    "apps/api/src/feature.mts",
    'await import("@mastra/" + "core");\n'
  );
  computedImportSnapshot.productionSourcePaths.push("apps/api/src/feature.mts");
  assertFailure(computedImportSnapshot, "MASTRA_IMPORT");

  const variableImportSnapshot = passingSnapshot();
  variableImportSnapshot.files.set(
    "apps/api/src/variable-import.ts",
    'const dependency = "@mastra/core";\nexport const loaded = import(dependency);\n'
  );
  variableImportSnapshot.productionSourcePaths.push("apps/api/src/variable-import.ts");
  assertFailure(variableImportSnapshot, "MASTRA_IMPORT");

  const templateExpressionSnapshot = passingSnapshot();
  templateExpressionSnapshot.files.set(
    "apps/api/src/template-import.ts",
    'const scope = "@mastra";\nexport const loaded = import(`${scope}/core`);\n'
  );
  templateExpressionSnapshot.productionSourcePaths.push("apps/api/src/template-import.ts");
  assertFailure(templateExpressionSnapshot, "MASTRA_IMPORT");

  const unresolvedImportSnapshot = passingSnapshot();
  unresolvedImportSnapshot.files.set(
    "apps/api/src/unresolved-import.ts",
    "export const load = (dependency) => import(dependency);\n"
  );
  unresolvedImportSnapshot.productionSourcePaths.push("apps/api/src/unresolved-import.ts");
  assertFailure(unresolvedImportSnapshot, "UNRESOLVED_MODULE_EDGE");
});

test("rejects an alternative runtime selector without an accepted ADR", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set("apps/api/src/app-context.ts", "const runtimeSelector = choose();\n");
  assertFailure(snapshot, "RUNTIME_SELECTOR");

  const genericSnapshot = passingSnapshot();
  genericSnapshot.files.set(
    "apps/api/src/modules/ai/runtime-choice.ts",
    'const engine = process.env.AI_ENGINE === "second" ? directEngine : alternativeEngine;\n'
  );
  genericSnapshot.productionSourcePaths.push("apps/api/src/modules/ai/runtime-choice.ts");
  assertFailure(genericSnapshot, "RUNTIME_SELECTOR");

  const buildDirectorySnapshot = passingSnapshot();
  buildDirectorySnapshot.files.set(
    "apps/api/src/build/provider-choice.ts",
    "const client = process.env.AI_PROVIDER ? primaryClient : alternateClient;\n"
  );
  buildDirectorySnapshot.productionSourcePaths.push(
    "apps/api/src/build/provider-choice.ts"
  );
  assertFailure(buildDirectorySnapshot, "RUNTIME_SELECTOR");

  const aliasedChoiceSnapshot = passingSnapshot();
  aliasedChoiceSnapshot.files.set(
    "apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts",
    "const runtimeChoice = process.env.AI_CHOICE;\n" +
      "const selectedClient = runtimeChoice === 'primary' ? primaryClient : alternateClient;\n"
  );
  aliasedChoiceSnapshot.productionSourcePaths.push(
    "apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts"
  );
  assertFailure(aliasedChoiceSnapshot, "RUNTIME_SELECTOR");

  const settingsChoiceSnapshot = passingSnapshot();
  settingsChoiceSnapshot.files.set(
    "apps/api/src/modules/ai/client-choice.ts",
    "const selectedClient = settings.aiProvider === 'primary' ? primaryClient : alternateClient;\n"
  );
  settingsChoiceSnapshot.productionSourcePaths.push(
    "apps/api/src/modules/ai/client-choice.ts"
  );
  assertFailure(settingsChoiceSnapshot, "RUNTIME_SELECTOR");

  const destructuredChoiceSnapshot = passingSnapshot();
  destructuredChoiceSnapshot.files.set(
    "apps/api/src/modules/ai/destructured-choice.ts",
    "const { AI_CHOICE } = process.env;\n" +
      "const selected = AI_CHOICE === 'primary' ? primary : alternate;\n"
  );
  destructuredChoiceSnapshot.productionSourcePaths.push(
    "apps/api/src/modules/ai/destructured-choice.ts"
  );
  assertFailure(destructuredChoiceSnapshot, "RUNTIME_SELECTOR");

  const multiHopChoiceSnapshot = passingSnapshot();
  multiHopChoiceSnapshot.files.set(
    "apps/api/src/modules/ai/multi-hop-choice.ts",
    "const raw = process.env.AI_CHOICE;\n" +
      "const choice = raw;\n" +
      "const selected = choice === 'primary' ? primary : alternate;\n"
  );
  multiHopChoiceSnapshot.productionSourcePaths.push(
    "apps/api/src/modules/ai/multi-hop-choice.ts"
  );
  assertFailure(multiHopChoiceSnapshot, "RUNTIME_SELECTOR");

  const lookupChoiceSnapshot = passingSnapshot();
  lookupChoiceSnapshot.files.set(
    "apps/api/src/modules/ai/lookup-choice.ts",
    "const { AI_CHOICE } = process.env;\n" +
      "const choices = { one: createOne(), two: createTwo() };\n" +
      "export const selected = choices[AI_CHOICE];\n"
  );
  lookupChoiceSnapshot.productionSourcePaths.push(
    "apps/api/src/modules/ai/lookup-choice.ts"
  );
  assertFailure(lookupChoiceSnapshot, "RUNTIME_SELECTOR");

  const containerAliasSnapshot = passingSnapshot();
  containerAliasSnapshot.files.set(
    "apps/api/src/modules/ai/container-choice.ts",
    "const runtimeEnvironment = process.env;\n" +
      "const { AI_PROVIDER: choice } = runtimeEnvironment;\n" +
      "export const selected = choice === 'one' ? createOne() : createTwo();\n"
  );
  containerAliasSnapshot.productionSourcePaths.push(
    "apps/api/src/modules/ai/container-choice.ts"
  );
  assertFailure(containerAliasSnapshot, "RUNTIME_SELECTOR");

  const transitiveAdapterPath =
    "apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts";
  for (const source of [
    "const envAlias = process.env;\n" +
      "const choice = envAlias.AI_PROVIDER;\n" +
      "const choices = { one: createOne(), two: createTwo() };\n" +
      "export const selected = choices[choice];\n",
    "const envAlias = process.env;\n" +
      'const choice = envAlias["AI_PROVIDER"];\n' +
      "export const selected = choice === 'one' ? createOne() : createTwo();\n",
    "const envAlias = process.env;\n" +
      "export const selected = envAlias.AI_PROVIDER === 'one' ? createOne() : createTwo();\n",
    "const envAlias = process.env;\n" +
      "const choice = envAlias.AI_PROVIDER;\n" +
      "const choices = new Map();\n" +
      "export const selected = choices.get(choice);\n"
  ]) {
    const transitiveAliasSnapshot = passingSnapshot();
    transitiveAliasSnapshot.files.set(transitiveAdapterPath, source);
    transitiveAliasSnapshot.productionSourcePaths.push(transitiveAdapterPath);
    assertFailure(transitiveAliasSnapshot, "RUNTIME_SELECTOR");
  }
});

test("rejects an unreviewed change to the runtime assembly", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set(
    "apps/api/src/index.ts",
    'import { alternate } from "./alternate-ai-entrypoint.js";\nalternate();\n'
  );
  assertFailure(snapshot, "RUNTIME_ASSEMBLY");
});

test("accepts a runtime selector only with a matching accepted ADR marker", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set(
    "apps/api/src/app-context.ts",
    "// architecture-guard: accepted-adr ADR-099\nconst runtimeSelector = choose();\n"
  );
  snapshot.files.set(
    "docs/adr/ADR-099-SECOND-RUNTIME.md",
    "# ADR-099\nStatus: accepted\nArchitecture-guard approval: second-runtime\n"
  );
  snapshot.acceptedAdrPaths.push("docs/adr/ADR-099-SECOND-RUNTIME.md");
  refreshArchitectureContract(snapshot);
  assert.deepEqual(evaluateArchitectureGuardrails(snapshot), []);

  const prohibitingSnapshot = passingSnapshot();
  prohibitingSnapshot.files.set(
    "apps/api/src/app-context.ts",
    "// architecture-guard: accepted-adr ADR-010\nconst runtimeSelector = choose();\n"
  );
  prohibitingSnapshot.files.set(
    "docs/adr/ADR-010-PROHIBITION.md",
    "# ADR-010\nStatus: accepted\nA second runtime requires a new ADR.\n"
  );
  prohibitingSnapshot.acceptedAdrPaths.push("docs/adr/ADR-010-PROHIBITION.md");
  assertFailure(prohibitingSnapshot, "RUNTIME_SELECTOR");

  const fencedApprovalSnapshot = passingSnapshot();
  fencedApprovalSnapshot.files.set(
    "apps/api/src/app-context.ts",
    "// architecture-guard: accepted-adr ADR-099\nconst runtimeSelector = choose();\n"
  );
  fencedApprovalSnapshot.files.set(
    "docs/adr/ADR-099-PROPOSED.md",
    "# ADR-099\nStatus: proposed\n\n```text\nStatus: accepted\n" +
      "Architecture-guard approval: second-runtime\n```\n"
  );
  fencedApprovalSnapshot.acceptedAdrPaths.push("docs/adr/ADR-099-PROPOSED.md");
  assertFailure(fencedApprovalSnapshot, "RUNTIME_SELECTOR");

  for (const adrSource of [
    "# ADR-099\n> Proposed metadata example:\nStatus: accepted\n" +
      "Architecture-guard approval: second-runtime\n",
    "# ADR-099\n<!--\nStatus: accepted\n" +
      "Architecture-guard approval: second-runtime\n-->\n"
  ]) {
    const nonAuthoritativeApprovalSnapshot = passingSnapshot();
    nonAuthoritativeApprovalSnapshot.files.set(
      "apps/api/src/app-context.ts",
      "// architecture-guard: accepted-adr ADR-099\nconst runtimeSelector = choose();\n"
    );
    nonAuthoritativeApprovalSnapshot.files.set(
      "docs/adr/ADR-099-NON-AUTHORITATIVE.md",
      adrSource
    );
    nonAuthoritativeApprovalSnapshot.acceptedAdrPaths.push(
      "docs/adr/ADR-099-NON-AUTHORITATIVE.md"
    );
    assertFailure(nonAuthoritativeApprovalSnapshot, "RUNTIME_SELECTOR");
  }
});

test("rejects an unjustified compatibility export", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set("apps/api/src/legacy/new-export.ts", 'export * from "../modules/new.js";');
  snapshot.compatibilityExportPaths.push("apps/api/src/legacy/new-export.ts");
  assertFailure(snapshot, "COMPATIBILITY_EXPORT");
});

test("discovers a forwarding compatibility export outside legacy folder names", () => {
  assert.equal(
    isCompatibilityExportSource(
      'export * from "../modules/new-domain/new-service.js";\n',
      "apps/api/src/unexpected/new-service.ts"
    ),
    true
  );
  assert.equal(
    isCompatibilityExportSource(
      'export * from "../modules/new-domain/new-service.js";\nconst keep = true;\n',
      "apps/api/src/unexpected/new-service.ts"
    ),
    true
  );
  assert.equal(
    isCompatibilityExportSource(
      'export { value } from "./ordinary-neighbor.js";\n',
      "apps/api/src/unexpected/ordinary.ts"
    ),
    false
  );
  assert.equal(
    isCompatibilityExportSource(
      'import { value } from "../modules/new-domain/new-service.js";\nexport { value };\n',
      "apps/api/src/unexpected/new-service.ts"
    ),
    true
  );
  assert.equal(
    isCompatibilityExportSource(
      'module.exports = require("../modules/new-domain/new-service.cjs");\n',
      "apps/api/src/unexpected/new-service.cjs"
    ),
    true
  );
  assert.equal(
    isCompatibilityExportSource(
      'const implementation = require("../modules/new-domain/new-service.cjs");\n' +
        "module.exports = implementation;\n",
      "apps/api/src/unexpected/new-service.cjs"
    ),
    true
  );
  assert.equal(
    isCompatibilityExportSource(
      'import * as implementation from "../modules/new-domain/new-service.js";\n' +
        "export const service = implementation.service;\n",
      "apps/api/src/unexpected/new-service.ts"
    ),
    true
  );
});

test("does not let a test consumer authorize an unreviewed compatibility shim", () => {
  const commentSnapshot = passingSnapshot();
  const exportPath = "apps/api/src/unexpected/new-export.ts";
  const consumerPath = "apps/api/test/comment-consumer.test.ts";
  commentSnapshot.files.set(exportPath, 'export * from "../modules/ai/index.js";\n');
  commentSnapshot.compatibilityExportPaths.push(exportPath);
  commentSnapshot.files.set(consumerPath, '// import "../src/unexpected/new-export.js";\n');
  commentSnapshot.consumerSourcePaths.push(consumerPath);
  assertFailure(commentSnapshot, "COMPATIBILITY_EXPORT");

  const mjsSnapshot = passingSnapshot();
  const mjsExport = "apps/api/src/unexpected/new-export.mjs";
  const mjsConsumer = "apps/api/test/new-export-consumer.mjs";
  mjsSnapshot.files.set(mjsExport, 'export * from "../modules/ai/index.mjs";\n');
  mjsSnapshot.compatibilityExportPaths.push(mjsExport);
  mjsSnapshot.files.set(mjsConsumer, 'import "../src/unexpected/new-export.mjs";\n');
  mjsSnapshot.consumerSourcePaths.push(mjsConsumer);
  assertFailure(mjsSnapshot, "COMPAT_ENTRY_SET");

  const mtsSnapshot = passingSnapshot();
  const mtsExport = "apps/api/src/unexpected/new-export.mts";
  const mtsConsumer = "apps/api/test/new-export-consumer.mts";
  mtsSnapshot.files.set(mtsExport, 'export * from "../modules/ai/index.mjs";\n');
  mtsSnapshot.compatibilityExportPaths.push(mtsExport);
  mtsSnapshot.files.set(mtsConsumer, 'import "../src/unexpected/new-export.mts";\n');
  mtsSnapshot.consumerSourcePaths.push(mtsConsumer);
  assertFailure(mtsSnapshot, "COMPAT_ENTRY_SET");
});

test("closes runtime, document and compatibility bypasses with the reviewed contract", () => {
  const computedKey = passingSnapshot();
  computedKey.files.set(
    computedKey.architectureContract.production.provider_boundary,
    'const env = process.env;\nconst key = "AI_PROVIDER";\n' +
      "const choice = env[key];\nexport const selected = implementations[choice];\n"
  );
  assertFailure(computedKey, "RUNTIME_CLOSURE_HASH");

  const crossFile = passingSnapshot();
  const choiceSource = "apps/api/src/modules/ai/review-choice.ts";
  crossFile.files.set(choiceSource, "export const choice = settings.aiProvider;\n");
  crossFile.productionSourcePaths.push(choiceSource);
  crossFile.files.set(
    crossFile.architectureContract.production.provider_boundary,
    'import { choice } from "../review-choice.js";\n' +
      "export const selected = choice ? primary : alternate;\n"
  );
  assertFailure(crossFile, "RUNTIME_SOURCE_SET");
  assertFailure(crossFile, "RUNTIME_CLOSURE_HASH");

  const computedRequire = passingSnapshot();
  computedRequire.files.set(
    computedRequire.architectureContract.production.provider_boundary,
    "export const load = (name) => require(name);\n"
  );
  assertFailure(computedRequire, "UNRESOLVED_MODULE_EDGE");

  const naturalAuthority = passingSnapshot();
  naturalAuthority.files.set(
    "docs/source-of-truth.md",
    naturalAuthority.files.get("docs/source-of-truth.md") +
      "\nThe AI roadmap lives in docs/architecture/SECOND_AI_PLAN.md.\n"
  );
  assertFailure(naturalAuthority, "ACTIVE_DOCUMENT_ROUTE");
  assertFailure(naturalAuthority, "ROUTING_SURFACE_HASH");

  const htmlStatus = passingSnapshot();
  const htmlPlan = "docs/tasks/SECOND_AI_PLAN.md";
  htmlStatus.files.set(htmlPlan, "# AI plan\n\nStatus: <code>implementing</code>\n");
  htmlStatus.taskDocumentPaths.push(htmlPlan);
  assertFailure(htmlStatus, "AI_CARD_LIMIT");
  assertFailure(htmlStatus, "TASK_DOCUMENT_SET");

  const aliasHop = passingSnapshot();
  const compatibilityPath = aliasHop.compatibilityExportPaths[0];
  aliasHop.files.set(
    compatibilityPath,
    'import { session as imported } from "../modules/auth/session.js";\n' +
      "const forwarded = imported;\nexport { forwarded };\n"
  );
  assertFailure(aliasHop, "COMPATIBILITY_SHAPE");

  const adrCoveredNewShim = passingSnapshot();
  const newShim = "apps/api/src/services/new-runtime.ts";
  const consumer = "apps/api/test/new-runtime.test.ts";
  adrCoveredNewShim.files.set(newShim, 'export * from "../modules/ai/index.js";\n');
  adrCoveredNewShim.productionSourcePaths.push(newShim);
  adrCoveredNewShim.compatibilityExportPaths.push(newShim);
  adrCoveredNewShim.files.set(consumer, `if (false) await import("../src/services/new-runtime.js");\n`);
  adrCoveredNewShim.consumerSourcePaths.push(consumer);
  assertFailure(adrCoveredNewShim, "COMPAT_ENTRY_SET");
});

test("fails closed for malformed or silently extended architecture contracts", () => {
  const unknownField = passingSnapshot();
  unknownField.architectureContract.extra = true;
  assertFailure(unknownField, "ARCHITECTURE_CONTRACT");

  const duplicateEntry = passingSnapshot();
  duplicateEntry.architectureContract.compatibility.entries.push({
    ...duplicateEntry.architectureContract.compatibility.entries[0]
  });
  assertFailure(duplicateEntry, "ARCHITECTURE_CONTRACT");
});

test("rejects missing or hollowed migration/concurrency/send-gate evidence", () => {
  const missingSnapshot = passingSnapshot();
  missingSnapshot.files.delete(REQUIRED_EVIDENCE[0].path);
  assertFailure(missingSnapshot, "REQUIRED_FILE");

  const hollowSnapshot = passingSnapshot();
  hollowSnapshot.files.set(
    REQUIRED_EVIDENCE[1].path,
    `${REQUIRED_EVIDENCE[1].sentinels.join("\n")}\n` +
      Array.from(
        { length: REQUIRED_EVIDENCE[1].minimumTests },
        (_, index) => `it.skip("fake ${index}", () => {});`
      ).join("\n")
  );
  assertFailure(hollowSnapshot, "EVIDENCE_TESTS");

  const removedParameterizedTest = passingSnapshot();
  const evidence = REQUIRED_EVIDENCE[1];
  removedParameterizedTest.files.set(
    evidence.path,
    removedParameterizedTest.files.get(evidence.path).replace("it.each(", "it.skip.each(")
  );
  assertFailure(removedParameterizedTest, "EVIDENCE_TESTS");
});

test("rejects removal of guard execution from the build path", () => {
  const snapshot = passingSnapshot();
  snapshot.files.set(
    "package.json",
    JSON.stringify({ scripts: { build: "npm run typecheck", "check:architecture": "true" } })
  );
  assertFailure(snapshot, "GUARD_WIRING");

  const noOpSnapshot = passingSnapshot();
  noOpSnapshot.files.set(
    "package.json",
    JSON.stringify({
      scripts: {
        build: "echo npm run check:architecture",
        "check:architecture":
          "echo node tooling/ai-architecture-guardrails.mjs && echo node --test tooling/ai-architecture-guardrails.test.mjs"
      }
    })
  );
  assertFailure(noOpSnapshot, "GUARD_WIRING");

  const guardOnlyBuildSnapshot = passingSnapshot();
  guardOnlyBuildSnapshot.files.set(
    "package.json",
    JSON.stringify({
      scripts: {
        build: "npm run check:architecture",
        "check:architecture":
          "node tooling/ai-architecture-guardrails.mjs && node --test tooling/ai-architecture-guardrails.test.mjs"
      }
    })
  );
  assertFailure(guardOnlyBuildSnapshot, "GUARD_WIRING");
});

test("rejects a symbolic link used as a direct guard input", () => {
  assert.throws(
    () =>
      ensureNonSymbolicGuardInput("/repo/package.json", {
        isSymbolicLink: () => true
      }),
    /symbolic link is not an allowed guard input/
  );
});

function passingSnapshot() {
  const files = new Map();
  for (const documentPath of ACTIVE_DOCUMENTS) files.set(documentPath, "current\n");
  for (const assemblyPath of ASSEMBLY_DOCUMENTS) files.set(assemblyPath, "direct only\n");

  const activeCard = "docs/tasks/AI_REF_CONV_5_FIXTURE.md";
  files.set("docs/source-of-truth.md", activeDocumentManifest(activeCard));
  files.set(activeCard, "Статус: `implementing`.\n");
  files.set(
    "docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md",
    "Статус: `implementing`.\n"
  );
  files.set(
    "docs/tasks/README.md",
    activeRouteIndex("AI_REF_CONV_5_FIXTURE.md")
  );
  files.set(
    "package.json",
    JSON.stringify({
      scripts: {
        build:
          "npm run check:architecture && npm run typecheck && npm -w @granit/manager run build",
        "check:architecture":
          "node tooling/ai-architecture-guardrails.mjs && node --test tooling/ai-architecture-guardrails.test.mjs"
      }
    })
  );

  const compatibilityExport = "apps/api/src/auth/session.ts";
  files.set(compatibilityExport, 'export * from "../modules/auth/session.js";\n');
  const providerBoundary =
    "apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts";
  files.set(providerBoundary, "export const directProvider = true;\n");
  const compatibilityAdr = "docs/adr/ADR-009-COMPATIBILITY_EXPORT_POLICY_RU.md";
  files.set(
    compatibilityAdr,
    "# ADR-009: Compatibility Export Policy\nStatus: accepted\n"
  );

  for (const evidence of REQUIRED_EVIDENCE) {
    files.set(evidence.path, readFileSync(evidence.path, "utf8"));
  }

  const snapshot = {
    files,
    architectureContract: {
      schema_version: 1,
      production: {
        roots: ["apps/api/src/app.ts", "apps/api/src/index.ts"],
        assembly_paths: ["apps/api/src/widget-ai-runtime-assembly.ts"],
        provider_boundary: providerBoundary,
        source_count: 0,
        source_paths_sha256: "",
        source_contents_sha256: ""
      },
      documents: {
        active_goal: "docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md",
        active_card: activeCard,
        active_authority_paths: [...ACTIVE_DOCUMENTS, "docs/tasks/README.md", activeCard].sort(),
        allowed_provenance_paths: ["docs/tasks/ARCHIVE_RU.md"],
        task_count: 0,
        task_paths_sha256: "",
        routing_surface_hashes: {
          "docs/source-of-truth.md": "",
          "docs/tasks/README.md": ""
        }
      },
      compatibility: {
        legacy_roots: [
          "apps/api/src/auth",
          "apps/api/src/repositories",
          "apps/api/src/routes",
          "apps/api/src/services"
        ],
        entries: [
          {
            path: compatibilityExport,
            targets: ["../modules/auth/session.js"]
          }
        ]
      }
    },
    aiCardPaths: [activeCard],
    taskDocumentPaths: [
      activeCard,
      "docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md",
      "docs/tasks/README.md"
    ],
    acceptedAdrPaths: [compatibilityAdr],
    productionSourcePaths: [...ASSEMBLY_DOCUMENTS, providerBoundary, compatibilityExport],
    reviewedAssemblyHashes: Object.fromEntries(
      ASSEMBLY_DOCUMENTS.map((assemblyPath) => [
        assemblyPath,
        createHash("sha256").update(files.get(assemblyPath)).digest("hex")
      ])
    ),
    packageManifestPaths: ["package.json"],
    compatibilityExportPaths: [compatibilityExport],
    consumerSourcePaths: []
  };
  refreshArchitectureContract(snapshot);
  return snapshot;
}

function refreshArchitectureContract(snapshot) {
  const productionPaths = [...new Set(snapshot.productionSourcePaths)].sort();
  const taskPaths = [...new Set(snapshot.taskDocumentPaths)].sort();
  snapshot.architectureContract.production.source_count = productionPaths.length;
  snapshot.architectureContract.production.source_paths_sha256 = pathSetHash(productionPaths);
  snapshot.architectureContract.production.source_contents_sha256 = contentSetHash(
    productionPaths,
    snapshot.files
  );
  snapshot.architectureContract.documents.task_count = taskPaths.length;
  snapshot.architectureContract.documents.task_paths_sha256 = pathSetHash(taskPaths);
  for (const documentPath of Object.keys(
    snapshot.architectureContract.documents.routing_surface_hashes
  )) {
    snapshot.architectureContract.documents.routing_surface_hashes[documentPath] = sha256(
      snapshot.files.get(documentPath)
    );
  }
  snapshot.files.set(
    ARCHITECTURE_CONTRACT_PATH,
    `${JSON.stringify(snapshot.architectureContract, null, 2)}\n`
  );
}

function pathSetHash(paths) {
  return sha256(`${[...new Set(paths)].sort().join("\n")}\n`);
}

function contentSetHash(paths, files) {
  return sha256(
    [...new Set(paths)]
      .sort()
      .map((filePath) => `${filePath}\0${sha256(files.get(filePath))}`)
      .join("\n")
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function activeDocumentManifest(activeCard) {
  return (
    "<!-- architecture-guard: active-ai-documents\n" +
    [...ACTIVE_DOCUMENTS, "docs/tasks/README.md", activeCard].sort().join("\n") +
    "\n-->\n"
  );
}

function materializeSnapshot(root, snapshot) {
  for (const [relativePath, source] of snapshot.files) {
    writeFixtureFile(root, relativePath, source);
  }
}

function writeFixtureFile(root, relativePath, source) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source, "utf8");
}

function activeRouteIndex(cardName, extra = "") {
  return (
    "# Task Docs\n\n## Active AI route\n\n" +
    "1. `../source-of-truth.md`\n" +
    "2. `AI_RUNTIME_CONVERGENCE_GOAL_RU.md`\n" +
    `3. \`${cardName}\`\n` +
    "Шаблон: `AI_REFACTOR_SLICE_TEMPLATE_RU.md`.\n" +
    extra +
    "\n## Historical records\n"
  );
}

function assertFailure(snapshot, code) {
  const failures = evaluateArchitectureGuardrails(snapshot);
  assert.ok(
    failures.some((failure) => failure.code === code),
    `expected ${code}, received ${JSON.stringify(failures)}`
  );
}
