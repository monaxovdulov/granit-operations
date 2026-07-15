import { and, eq } from "drizzle-orm";

import {
  aiQualityEvents,
  aiRunSpans,
  aiRuns,
  conversationMessages,
  conversations,
  createOperationsDb
} from "@granit/db";
import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE
} from "@granit/contracts";

import { buildApi } from "../app.js";
import { loadConfig } from "../config.js";
import { PostgresAiRunRepository } from "../modules/ai/repositories/postgres-ai-run-repository.js";
import type { LiveV2RuntimeFailureCategory } from "../modules/ai/adapters/mastra-live-v2-decision-generator.js";
import { PostgresIntakeRepository } from "../modules/conversations/repositories/postgres-intake-repository.js";
import { buildConfiguredWidgetAiAssembly } from "../widget-ai-runtime-assembly.js";
import {
  isSuccessfulM3Smoke,
  m3SmokeExitCode,
  summarizeM3PublicResult
} from "./m3-smoke-evidence.js";
import { assertM3SmokeGitProvenance } from "./m3-smoke-git-provenance.js";

const APPROVED_G6_BASE_SHA = "ad40c27ad2cb97b5f2249f263a64073feaea1fcf";
const SMOKE_IDEMPOTENCY_KEY = "m3-mastra-smoke-20260715-003";
const SHA_PATTERN = /^[a-f0-9]{40}$/;

let client: ReturnType<typeof createOperationsDb>["client"] | undefined;
let app: ReturnType<typeof buildApi> | undefined;
let sanitizedFailureCategory: LiveV2RuntimeFailureCategory | undefined;

try {
  assertExplicitApproval(process.env);
  assertM3SmokeGitProvenance({
    approvedBaseSha: APPROVED_G6_BASE_SHA,
    implementationSha: process.env.M3_MASTRA_SMOKE_IMPLEMENTATION_SHA!
  });
  const config = loadConfig(process.env);

  if (
    !config.widgetAi.enabled ||
    config.deploymentTier !== "staging" ||
    config.widgetAi.runtimeMode !== "mastra_openai_api"
  ) {
    throw new Error("unsafe M3 smoke runtime selection");
  }

  const database = createOperationsDb(config.databaseUrl);
  client = database.client;
  const repository = new PostgresIntakeRepository(database.db);
  const runRepository = new PostgresAiRunRepository(database.db);
  const [existing] = await database.db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.idempotencyKey, SMOKE_IDEMPOTENCY_KEY))
    .limit(1);

  if (existing) {
    throw new Error("M3 smoke idempotency key was already consumed");
  }

  const widgetAi = await buildConfiguredWidgetAiAssembly({
    config,
    runRepository,
    onSanitizedFailure(category) {
      sanitizedFailureCategory = category;
    }
  });
  app = buildApi({ repository, widgetAi, logger: false });
  const response = await app.inject({
    method: "POST",
    url: "/public/intake/site-widget/messages",
    payload: {
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
      event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
      idempotency_key: SMOKE_IDEMPOTENCY_KEY,
      submitted_at: "2026-07-15T19:15:00.000Z",
      source: {
        channel: "site_widget",
        page_url: "https://botops.ru/m3-synthetic-smoke-003",
        widget_instance_id: "m3-synthetic-smoke-003"
      },
      message: {
        role: "visitor",
        text: "Помогите спокойно выбрать подходящий памятник"
      },
      consent: { privacy_policy: true }
    }
  });
  const publicResult: unknown = response.json();
  const [run] = await database.db
    .select({
      runtimeMode: aiRuns.runtimeMode,
      decisionProfile: aiRuns.decisionProfile,
      status: aiRuns.status,
      decisionAction: aiRuns.decisionAction,
      outcomeReason: aiRuns.outcomeReason,
      failureCode: aiRuns.failureCode,
      validatorResult: aiRuns.profileValidatorResult,
      configuredModelProvider: aiRuns.configuredModelProvider,
      configuredModelName: aiRuns.configuredModelName,
      observedModelProvider: aiRuns.observedModelProvider,
      observedModelName: aiRuns.observedModelName,
      inputTokens: aiRuns.inputTokens,
      outputTokens: aiRuns.outputTokens,
      totalTokens: aiRuns.totalTokens,
      sendGateResult: aiRuns.sendGateResult,
      latencyMs: aiRuns.latencyMs,
      outboundMessageId: aiRuns.outboundMessageId,
      runtimeRunId: aiRuns.runtimeRunId,
      conversationId: aiRuns.conversationId,
      runId: aiRuns.id
    })
    .from(aiRuns)
    .innerJoin(
      conversationMessages,
      eq(aiRuns.inboundMessageId, conversationMessages.id)
    )
    .where(
      and(
        eq(conversationMessages.idempotencyKey, SMOKE_IDEMPOTENCY_KEY),
        eq(aiRuns.runtimeMode, "mastra_openai_api")
      )
    )
    .limit(1);

  if (!run) {
    throw new Error("M3 smoke did not create an app-owned run");
  }

  const spans = await database.db
    .select({ status: aiRunSpans.status })
    .from(aiRunSpans)
    .where(eq(aiRunSpans.aiRunId, run.runId));
  const qualityEvents = await database.db
    .select({
      managerVisible: aiQualityEvents.managerVisible,
      resolutionStatus: aiQualityEvents.resolutionStatus
    })
    .from(aiQualityEvents)
    .where(eq(aiQualityEvents.aiRunId, run.runId));
  const [conversation] = await database.db
    .select({ aiState: conversations.aiState })
    .from(conversations)
    .where(eq(conversations.id, run.conversationId))
    .limit(1);

  if (!conversation) {
    throw new Error("M3 smoke run has no app-owned conversation");
  }

  const implementationSha = process.env.M3_MASTRA_SMOKE_IMPLEMENTATION_SHA!;
  const publicSummary = summarizeM3PublicResult(publicResult);
  const failedSpanCount = spans.filter((span) => span.status === "failed").length;
  const openManagerQualityEventCount = qualityEvents.filter(
    (event) => event.managerVisible && event.resolutionStatus === "open"
  ).length;
  const managerReviewRequired =
    conversation.aiState === "needs_manager" || conversation.aiState === "manager_active";
  const usageLinked =
    run.inputTokens !== null &&
    run.outputTokens !== null &&
    run.totalTokens !== null &&
    run.totalTokens >= run.inputTokens + run.outputTokens;
  const smokeOk = isSuccessfulM3Smoke({
    httpStatus: response.statusCode,
    publicOk: publicSummary.ok,
    publicFresh: publicSummary.fresh,
    publicReplayed: publicSummary.replayed,
    automationReplied: publicSummary.automationReplied,
    replyPresent: publicSummary.replyPresent,
    runtimeMode: run.runtimeMode,
    decisionProfile: run.decisionProfile,
    runStatus: run.status,
    decisionAction: run.decisionAction,
    outcomeReason: run.outcomeReason,
    failureCode: run.failureCode,
    validatorResult: run.validatorResult,
    sendGateResult: run.sendGateResult,
    outboundLinked: run.outboundMessageId !== null,
    runtimeLinked: run.runtimeRunId !== null,
    usageLinked,
    spanCount: spans.length,
    failedSpanCount,
    qualityEventCount: qualityEvents.length,
    openManagerQualityEventCount,
    managerReviewRequired,
    configuredProvider: run.configuredModelProvider,
    configuredModel: run.configuredModelName,
    observedProvider: run.observedModelProvider,
    observedModel: run.observedModelName
  });
  console.log(
    JSON.stringify({
      ok: smokeOk,
      approved_g6_base_sha: APPROVED_G6_BASE_SHA,
      implementation_sha: implementationSha,
      http_status: response.statusCode,
      public_ok: publicSummary.ok,
      public_fresh: publicSummary.fresh,
      public_replayed: publicSummary.replayed,
      automation_replied: publicSummary.automationReplied,
      persisted_reply_present: publicSummary.replyPresent,
      runtime_mode: run.runtimeMode,
      decision_profile: run.decisionProfile,
      run_status: run.status,
      decision_action: run.decisionAction,
      outcome_reason: run.outcomeReason,
      failure_code: run.failureCode,
      validator_result: run.validatorResult,
      configured_provider: run.configuredModelProvider,
      configured_model: run.configuredModelName,
      observed_provider: run.observedModelProvider,
      observed_model: run.observedModelName,
      input_tokens: run.inputTokens,
      output_tokens: run.outputTokens,
      total_tokens: run.totalTokens,
      send_gate_result: run.sendGateResult,
      latency_ms: run.latencyMs,
      outbound_linked: run.outboundMessageId !== null,
      runtime_linked: run.runtimeRunId !== null,
      usage_linked: usageLinked,
      span_count: spans.length,
      failed_span_count: failedSpanCount,
      quality_event_count: qualityEvents.length,
      open_manager_quality_event_count: openManagerQualityEventCount,
      manager_review_required: managerReviewRequired,
      openai_api_key_present: Boolean(config.widgetAi.mastra.openAiApiKey),
      trace_export_enabled: config.widgetAi.mastra.traceExportEnabled,
      telemetry_disabled: config.widgetAi.mastra.telemetryDisabled,
      auto_refresh_providers: config.widgetAi.mastra.autoRefreshProviders,
      sanitized_failure_category: sanitizedFailureCategory ?? null
    })
  );
  process.exitCode = m3SmokeExitCode(smokeOk);
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error: "m3_mastra_smoke_failed",
      sanitized_failure_category: sanitizedFailureCategory ?? null
    })
  );
  process.exitCode = 1;
} finally {
  await app?.close();
  await client?.end({ timeout: 5 });
}

function assertExplicitApproval(env: NodeJS.ProcessEnv): void {
  if (
    env.M3_MASTRA_SMOKE_ONCE !== "approved" ||
    env.M3_MASTRA_SMOKE_APPROVED_BASE_SHA !== APPROVED_G6_BASE_SHA ||
    !env.M3_MASTRA_SMOKE_IMPLEMENTATION_SHA ||
    !SHA_PATTERN.test(env.M3_MASTRA_SMOKE_IMPLEMENTATION_SHA)
  ) {
    throw new Error("explicit M3 smoke approval is required");
  }
}
