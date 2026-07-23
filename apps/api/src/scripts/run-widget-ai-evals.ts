import { OpenAiWidgetAssistantProvider } from "../modules/ai/adapters/openai-widget-assistant-provider.js";
import { OpenAiWidgetSemanticVerifier } from "../modules/ai/adapters/openai-widget-semantic-verifier.js";
import { FileCatalogKnowledgeProvider } from "../modules/ai/catalog/file-catalog-knowledge-provider.js";
import {
  runWidgetAiEvals,
  validateWidgetAiEvalCorpus
} from "../modules/ai/eval/widget-ai-eval-runner.js";
import {
  WIDGET_AI_EVAL_CORPUS_VERSION,
  WIDGET_AI_REGRESSION_CORPUS
} from "../modules/ai/eval/widget-ai-regression-corpus.js";
import { GroundedWidgetAiService } from "../modules/ai/services/grounded-widget-ai-service.js";

const corpusValidation = validateWidgetAiEvalCorpus(WIDGET_AI_REGRESSION_CORPUS);
const dryRun = process.argv.includes("--dry-run");
const catalog = new FileCatalogKnowledgeProvider();
const catalogSnapshot = await catalog.getSnapshot();

if (!corpusValidation.valid) {
  throw new Error(`invalid eval corpus: ${corpusValidation.failures.join(", ")}`);
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "dry-run",
        corpusVersion: WIDGET_AI_EVAL_CORPUS_VERSION,
        cases: WIDGET_AI_REGRESSION_CORPUS.length,
        catalogVersion: catalogSnapshot.catalogVersion,
        catalogContentHash: catalogSnapshot.contentHash,
        publishedRecords: catalogSnapshot.records.filter(
          (record) => record.status === "published"
        ).length,
        draftRecords: catalogSnapshot.records.filter(
          (record) => record.status === "draft"
        ).length
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (process.env.AI_WIDGET_EVAL_LIVE !== "true") {
  throw new Error("set AI_WIDGET_EVAL_LIVE=true to authorize paid live model evals");
}

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required for live widget AI evals");
}

const generatorModel = process.env.OPENAI_MODEL ?? "gpt-5.5";
const verifierModel = process.env.OPENAI_VERIFIER_MODEL ?? generatorModel;
const provider = new OpenAiWidgetAssistantProvider({ apiKey, model: generatorModel });
const verifier = new OpenAiWidgetSemanticVerifier({ apiKey, model: verifierModel });
const service = new GroundedWidgetAiService({
  provider,
  verifier,
  catalog,
  modelName: generatorModel,
  verifierModelName: verifierModel,
  deadlineMs: 18000
});
const report = await runWidgetAiEvals(service, WIDGET_AI_REGRESSION_CORPUS);

console.log(
  JSON.stringify(
    {
      corpusVersion: WIDGET_AI_EVAL_CORPUS_VERSION,
      generatorModel,
      verifierModel,
      ...report
    },
    null,
    2
  )
);

process.exitCode = report.failed ? 1 : 0;
