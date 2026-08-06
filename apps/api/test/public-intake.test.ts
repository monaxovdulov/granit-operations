import { randomUUID } from "node:crypto";

import {
  PUBLIC_INTAKE_CONTRACT_VERSION,
  PUBLIC_INTAKE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SiteWidgetResponseSchema,
  type SiteFormIntakeRequest,
  type SiteWidgetMessageRequest,
  type SiteWidgetV2MessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AI_TURN_INPUT_VERSION, type AiTurnInput } from "../src/modules/ai/ai-turn.js";
import {
  AI_TURN_DECISION_VERSION,
  GROUNDED_AI_TURN_DECISION_VERSION,
  type AiTurnCandidateDecision,
  type GroundedAiTurnCandidateDecision
} from "../src/modules/ai/ai-dialog-contract.js";
import { WIDGET_AI_POLICY_VERSION } from "../src/modules/ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../src/modules/ai/prompts/widget-ai-prompt.js";
import type { RunningAiRunRecord } from "../src/modules/ai/repositories/ai-run-repository.js";
import {
  GroundedWidgetAiService,
  type GroundedWidgetAiProvider,
  type GroundedWidgetAiProviderInput,
  type GroundedWidgetAiProviderResult
} from "../src/modules/ai/services/grounded-widget-ai-service.js";
import {
  WIDGET_AI_VERIFIER_VERSION,
  type WidgetAiSemanticVerifier,
  type WidgetAiVerification,
  type WidgetAiVerifierInput,
  type WidgetAiVerifierResult
} from "../src/modules/ai/verification/widget-ai-semantic-verifier.js";
import { APPROVED_WIDGET_KNOWLEDGE_VERSION } from "../src/modules/ai/knowledge/approved-widget-knowledge.js";
import { buildApi } from "../src/app.js";
import {
  AgentReplyBlockedError,
  TelegramOutboundBlockedError,
  type ClaimedSiteWidgetAiJob,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult
} from "../src/repositories/intake-repository.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";
import {
  MemoryManagerAuthRepository,
  testManagerAuthConfig
} from "./helpers/memory-manager-auth-repository.js";
import {
  boundTelegramManagerApp,
  readFixtureSource,
  telegramCallbackUpdate,
  telegramTextUpdate,
  testTelegramBotOptions,
  testTelegramSecretHeader,
  validTelegramInbound
} from "./helpers/telegram-fixtures.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function aiDecision(
  overrides: Partial<AiTurnCandidateDecision> = {}
): AiTurnCandidateDecision {
  return {
    version: AI_TURN_DECISION_VERSION,
    action: "answer",
    intent: "general_question",
    replyText: "Могу помочь собрать детали заявки.",
    extractedSlots: [],
    requestedSlots: [],
    riskFlags: [],
    handoffReason: null,
    sourceEvidence: [],
    confidence: 0.9,
    ...overrides
  };
}

async function waitForNextClockTick() {
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

describe("public site_form intake", () => {
  it("returns public success only after persistence and exposes manager visibility", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );
    const managerCookie = managerAuthRepository.createSessionCookie();

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: validRequest()
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({
      ok: true,
      schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
      status: "accepted",
      action: "show_thank_you"
    });
    expect(body.public_submission_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body.lead_id).toBeUndefined();
    expect(body.trace_id).toBeUndefined();

    const unauthenticatedManagerList = await app.inject({ method: "GET", url: "/manager/leads" });
    expect(unauthenticatedManagerList.statusCode).toBe(401);

    const managerList = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: managerCookie }
    });
    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().leads).toHaveLength(1);
    expect(managerList.json().leads[0]).toMatchObject({
      publicSubmissionId: body.public_submission_id,
      status: "new",
      source: {
        channel: "site_form",
        pageUrl: "https://granit.example/catalog/memorial",
        formKind: "catalog_request"
      },
      contact: {
        name: "Test Visitor",
        phone: "+15551234567",
        preferredContact: "phone"
      },
      request: {
        text: "Need a consultation for a family monument"
      }
    });

    const detail = await app.inject({
      method: "GET",
      url: `/manager/leads/${managerList.json().leads[0].leadId}`,
      headers: { cookie: managerCookie }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().lead).toMatchObject({
      publicSubmissionId: body.public_submission_id,
      source: {
        pageUrl: "https://granit.example/catalog/memorial",
        formKind: "catalog_request",
        referrerUrl: "https://granit.example/"
      },
      timeline: [
        {
          eventType: "lead.created_from_site_form",
          summary: "Lead created from public website form"
        }
      ]
    });

    const statusChange = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${managerList.json().leads[0].leadId}/status`,
      headers: { cookie: managerCookie },
      payload: { status: "in_progress" }
    });
    expect(statusChange.statusCode).toBe(200);
    expect(statusChange.json().lead).toMatchObject({
      status: "in_progress",
      timeline: [
        {
          eventType: "lead.created_from_site_form"
        },
        {
          eventType: "lead.status_changed",
          metadata: {
            from_status: "new",
            to_status: "in_progress",
            changed_by_manager_email: "owner@yandex.ru",
            changed_by_manager_role: "owner"
          }
        }
      ]
    });

    const invalidStatusChange = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${managerList.json().leads[0].leadId}/status`,
      headers: { cookie: managerCookie },
      payload: { status: "waiting" }
    });
    expect(invalidStatusChange.statusCode).toBe(400);

    const unauthenticatedStatusChange = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${managerList.json().leads[0].leadId}/status`,
      payload: { status: "closed" }
    });
    expect(unauthenticatedStatusChange.statusCode).toBe(401);
  });

  it("does not return false success when persistence is not confirmed", async () => {
    const repository = new MemoryIntakeRepository({ failPersistence: true });
    const app = track(buildApi({ repository }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: validRequest()
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
      error: {
        type: "retryable_backend_failure",
        code: "persistence_unconfirmed",
        action: "retry_or_show_fallback",
        retry_after_seconds: 30
      }
    });
    expect(response.json().public_submission_id).toBeUndefined();
    expect(repository.leadCount).toBe(0);
  });

  it("raises manager-touched leads to the top of the manager list", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );
    const managerCookie = managerAuthRepository.createSessionCookie();

    await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: {
        ...validRequest(),
        idempotency_key: "form-manager-touch-order-0001"
      }
    });
    const firstLeadId = repository.onlyLead().leadId;

    await waitForNextClockTick();
    await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: {
        ...validRequest(),
        idempotency_key: "form-manager-touch-order-0002"
      }
    });

    let managerList = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: managerCookie }
    });

    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().leads).toHaveLength(2);
    expect(managerList.json().leads[0].leadId).not.toBe(firstLeadId);

    await waitForNextClockTick();
    const statusChange = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${firstLeadId}/status`,
      headers: { cookie: managerCookie },
      payload: { status: "in_progress" }
    });
    managerList = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: managerCookie }
    });

    expect(statusChange.statusCode).toBe(200);
    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().leads[0]).toMatchObject({
      leadId: firstLeadId,
      status: "in_progress",
      nextStep: {
        summary: "Связаться с клиентом",
        channel: "manager_call"
      },
      updatedAt: statusChange.json().lead.updatedAt
    });
    expect(managerList.json().leads[0].updatedAt).not.toBe(managerList.json().leads[0].createdAt);
  });

  it("keeps viewer manager role read-only for status changes", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository("viewer");
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );

    const intakeResponse = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: validRequest()
    });
    const managerList = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: managerAuthRepository.createSessionCookie() }
    });
    const statusChange = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${managerList.json().leads[0].leadId}/status`,
      headers: { cookie: managerAuthRepository.createSessionCookie() },
      payload: { status: "closed" }
    });

    expect(intakeResponse.statusCode).toBe(202);
    expect(managerList.statusCode).toBe(200);
    expect(statusChange.statusCode).toBe(403);
    expect(statusChange.json()).toEqual({ error: "manager_forbidden" });
  });

  it("returns typed unsupported-version errors before persistence", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));
    const payload = { ...validRequest(), schema_version: "site_form.v2" };

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      ok: false,
      schema_version: "site_form.v2",
      error: {
        type: "unsupported_version",
        code: "unsupported_schema_version",
        action: "show_fallback_contact",
        supported_versions: [PUBLIC_INTAKE_CONTRACT_VERSION]
      }
    });
    expect(repository.saveCalls).toBe(0);
  });

  it("returns typed validation errors before persistence", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));
    const payload = validRequest();
    delete (payload.contact as { phone?: string }).phone;
    delete (payload.contact as { email?: string }).email;

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);
    expect(response.json().error.type).toBe("validation");
    expect(response.json().error.fields).toContainEqual({
      path: "contact.phone",
      message: "Provide at least phone or email"
    });
    expect(repository.saveCalls).toBe(0);
  });

  it("replays accepted submissions for the same idempotency key without duplicate leads", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));
    const payload = validRequest();

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({
      ok: true,
      status: "replayed",
      public_submission_id: first.json().public_submission_id
    });
    expect(repository.leadCount).toBe(1);
  });

  it("rejects reused idempotency keys for different payloads", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));
    const firstPayload = validRequest();
    const conflictingPayload = {
      ...validRequest(),
      source: {
        ...validRequest().source,
        page_url: "https://granit.example/different-page"
      }
    };

    await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: firstPayload
    });
    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: conflictingPayload
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      type: "validation",
      code: "idempotency_conflict",
      action: "show_validation_errors"
    });
    expect(repository.leadCount).toBe(1);
  });
});

describe("public site_widget intake", () => {
  it("rejects retired site_widget.v1 before persistence", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: {
        ...validWidgetRequest(),
        schema_version: "site_widget.v1"
      }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      ok: false,
      schema_version: "site_widget.v1",
      error: {
        type: "unsupported_version",
        code: "unsupported_schema_version",
        action: "show_fallback_contact",
        supported_versions: [SITE_WIDGET_V2_CONTRACT_VERSION]
      }
    });
    expect(repository.leadCount).toBe(0);
  });

  it("acknowledges v2 immediately and returns the durable reply through history", async () => {
    const repository = new MemoryIntakeRepository();
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generateDecision = async () => {
        await generationGate;
        return {
          candidate: {
            version: "granit_model_turn.v1" as const,
            message: {
              answerText:
                "Подойдёт модель «Арфа». Откройте карточку, чтобы посмотреть детали.",
              question: null
            },
            statePatches: [],
            recommendationIds: [],
            handoffIntent: null
          },
          observation: {
            observedModelProvider: "openai" as const,
            observedModelName: "gpt-5.6-luna"
          }
        };
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS
          },
          jobWorker: {
            enabled: true,
            pollIntervalMs: 25,
            leaseMs: 5_000,
            retryBackoffMs: 25,
            maxAttempts: 3
          }
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetV2Request({
        idempotencyKey: "widget-v2-async-0001",
        messageText: "Покажите модель Арфа"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      ok: true,
      schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
      status: "accepted",
      automation: {
        status: "processing",
        next_step: "poll_history",
        conversation_state: "ai_active"
      }
    });
    expect(response.json().public_conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.json().submitted_at).not.toBe("2020-01-01T00:00:00.000Z");
    expect(SiteWidgetResponseSchema.safeParse(response.json()).success).toBe(true);

    const pendingHistory = await app.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${response.json().public_session_id}/history?schema_version=site_widget.history.v2`
    });
    expect(pendingHistory.json()).toMatchObject({
      schema_version: "site_widget.history.v2",
      poll_after_ms: 700,
      messages: [
        {
          public_message_id: response.json().public_message_id,
          sender_role: "visitor",
          delivery_state: "accepted",
          automation: { status: expect.stringMatching(/pending|processing/) }
        }
      ]
    });

    releaseGeneration();
    let completedHistory = pendingHistory.json();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const historyResponse = await app.inject({
        method: "GET",
        url: `/public/intake/site-widget/sessions/${response.json().public_session_id}/history?schema_version=site_widget.history.v2`
      });
      completedHistory = historyResponse.json();

      if (
        completedHistory.messages?.length === 2 &&
        completedHistory.messages[0]?.automation?.status === "replied"
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(completedHistory.poll_after_ms).toBeUndefined();
    expect(completedHistory.messages).toMatchObject([
      {
        sender_role: "visitor",
        submitted_at: response.json().submitted_at,
        automation: { status: "replied" }
      },
      {
        sender_role: "ai_assistant",
        text: "Подойдёт модель «Арфа». Откройте карточку, чтобы посмотреть детали.",
        delivery_state: "accepted"
      }
    ]);
    expect(JSON.stringify(completedHistory.messages[1])).not.toContain("https://");
  });

  it("keeps memory job and ledger transitions honest across pre-begin retry gaps", async () => {
    const repository = new MemoryIntakeRepository();
    const publicSessionId = randomUUID();
    const publicMessageId = randomUUID();
    await repository.saveAcceptedSiteWidgetMessage({
      publicMessageId,
      publicSessionId,
      agentAllowedToReply: true,
      request: validWidgetV2Request({
        idempotencyKey: "widget-v2-memory-attempt-gap",
        publicSessionId
      }),
      requestFingerprint: "a".repeat(64),
      enqueueAiJob: true,
      aiJobMaxAttempts: 4,
      aiJobRuntimeMode: "direct_openai"
    });
    const firstClaimAt = new Date(Date.now() + 1_000);

    const beginClaimedAttempt = (job: ClaimedSiteWidgetAiJob, startedAt: Date) =>
      repository.beginOrReplay({
        traceId: randomUUID(),
        leadId: job.leadId,
        conversationId: job.conversationId,
        inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
        channel: "site_widget",
        runtimeMode: "direct_openai",
        decisionProfile: "live_v2",
        idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
        attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:${job.attemptCount}`,
        attemptNumber: job.attemptCount,
        jobId: job.id,
        jobAttemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        inputFingerprint: "b".repeat(64),
        versions: {
          policyVersion: "memory_policy.v1",
          promptVersion: "memory_prompt.v1",
          toolVersion: "memory_tools.none.v1",
          disclosureVersion: "memory_disclosure.v1",
          modelProfileVersion: "memory_model_profile.v1"
        },
        model: {
          modelProvider: "fake",
          requestedModelName: "memory-recorded-fake",
          reasoningEffort: "none"
        },
        startedAt
      });
    const failAttempt = async (run: RunningAiRunRecord, completedAt: Date) => {
      await repository.failAttempt({
        run,
        completion: {
          status: "failed",
          normalizedAction: "no_reply",
          outcomeReason: "generator_failed",
          failureCode: "runtime_failure",
          validatorResult: "failed",
          observedModelProvider: "none",
          sendGateResult: "not_checked",
          completedAt,
          latencyMs: Math.max(0, completedAt.getTime() - run.startedAt.getTime()),
          spans: [],
          qualityEvents: []
        }
      });
    };

    const first = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: firstClaimAt });
    if (!first) throw new Error("expected first memory claim");
    const firstStarted = await beginClaimedAttempt(first, firstClaimAt);
    if (firstStarted.kind !== "started") throw new Error("expected first memory attempt");
    const firstFailedAt = new Date(firstClaimAt.getTime() + 100);
    await failAttempt(firstStarted.run, firstFailedAt);
    await repository.finishSiteWidgetAiJob({
      jobId: first.id,
      attemptCount: first.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: firstFailedAt,
      completedAt: firstFailedAt
    });

    const secondClaimAt = new Date(firstClaimAt.getTime() + 200);
    const second = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: secondClaimAt });
    if (!second) throw new Error("expected second memory claim");
    const secondFailedAt = new Date(secondClaimAt.getTime() + 100);
    await repository.finishSiteWidgetAiJob({
      jobId: second.id,
      attemptCount: second.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: secondFailedAt,
      completedAt: secondFailedAt
    });

    const thirdClaimAt = new Date(firstClaimAt.getTime() + 400);
    const third = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: thirdClaimAt });
    if (!third) throw new Error("expected third memory claim");
    const thirdStarted = await beginClaimedAttempt(third, thirdClaimAt);
    if (thirdStarted.kind !== "started") throw new Error("expected memory attempt after gap");
    const thirdFailedAt = new Date(thirdClaimAt.getTime() + 100);
    await failAttempt(thirdStarted.run, thirdFailedAt);
    await repository.finishSiteWidgetAiJob({
      jobId: third.id,
      attemptCount: third.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: thirdFailedAt,
      completedAt: thirdFailedAt
    });

    const fourthClaimAt = new Date(firstClaimAt.getTime() + 600);
    const fourth = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: fourthClaimAt });
    if (!fourth) throw new Error("expected final memory claim");
    const fourthFailedAt = new Date(fourthClaimAt.getTime() + 100);
    await repository.finishSiteWidgetAiJob({
      jobId: fourth.id,
      attemptCount: fourth.attemptCount,
      status: "failed",
      terminalReason: "worker_failed",
      completedAt: fourthFailedAt
    });

    await expect(beginClaimedAttempt(fourth, fourthClaimAt)).rejects.toBeInstanceOf(
      AgentReplyBlockedError
    );
    expect(repository.listWidgetAiJobs()).toMatchObject([
      { status: "failed", attemptCount: 4, terminalReason: "worker_failed" }
    ]);
    expect(repository.listAiRuns()).toMatchObject([
      {
        status: "failed",
        outcomeReason: "generator_failed",
        failureCode: "runtime_failure"
      }
    ]);
    expect(repository.listAiAttempts()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "failed" },
      { attemptNumber: 3, jobAttemptCount: 3, status: "failed" }
    ]);
  });

  it("rejects forged memory attempt numbering and max-attempt failure identity", async () => {
    const repository = new MemoryIntakeRepository();
    const publicSessionId = randomUUID();
    await repository.saveAcceptedSiteWidgetMessage({
      publicMessageId: randomUUID(),
      publicSessionId,
      agentAllowedToReply: true,
      request: validWidgetV2Request({
        idempotencyKey: "widget-v2-memory-forged-attempt",
        publicSessionId
      }),
      requestFingerprint: "c".repeat(64),
      enqueueAiJob: true,
      aiJobMaxAttempts: 4,
      aiJobRuntimeMode: "direct_openai"
    });
    const claimedAt = new Date(Date.now() + 1_000);
    const job = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: claimedAt });
    if (!job) throw new Error("expected claimed memory job");
    const beginInput = {
      traceId: randomUUID(),
      leadId: job.leadId,
      conversationId: job.conversationId,
      inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
      channel: "site_widget" as const,
      runtimeMode: "direct_openai" as const,
      decisionProfile: "live_v2" as const,
      idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
      attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:1`,
      attemptNumber: 1,
      jobId: job.id,
      jobAttemptCount: 1,
      maxAttempts: 4,
      inputFingerprint: "d".repeat(64),
      versions: {
        policyVersion: "memory_policy.v1",
        promptVersion: "memory_prompt.v1",
        toolVersion: "memory_tools.none.v1",
        disclosureVersion: "memory_disclosure.v1",
        modelProfileVersion: "memory_model_profile.v1"
      },
      model: {
        modelProvider: "fake" as const,
        requestedModelName: "memory-recorded-fake",
        reasoningEffort: "none" as const
      },
      startedAt: claimedAt
    };

    await expect(
      repository.beginOrReplay({
        ...beginInput,
        attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:2`,
        attemptNumber: 2
      })
    ).rejects.toBeInstanceOf(AgentReplyBlockedError);
    const started = await repository.beginOrReplay(beginInput);
    if (started.kind !== "started") throw new Error("expected honest memory attempt");
    const completedAt = new Date(claimedAt.getTime() + 100);
    await repository.failRecordedSiteWidgetAiAttempt({
      run: started.run,
      completion: {
        status: "failed",
        normalizedAction: "no_reply",
        outcomeReason: "generator_failed",
        failureCode: "runtime_failure",
        validatorResult: "failed",
        observedModelProvider: "none",
        sendGateResult: "not_checked",
        completedAt,
        latencyMs: 100,
        spans: [],
        qualityEvents: []
      },
      inboundPublicMessageId: job.inboundPublicMessageId,
      expectedGenerationEpoch: job.expectedGenerationEpoch,
      respondsThroughSequence: job.respondsThroughSequence,
      runtimeMode: job.runtimeMode,
      jobCommit: { jobId: job.id, attemptCount: 1, maxAttempts: 1 }
    });

    expect(repository.listWidgetAiJobs()).toMatchObject([{ status: "processing", maxAttempts: 4 }]);
    expect(repository.listAiRuns()).toMatchObject([{ status: "running" }]);
    expect(repository.listAiAttempts()).toMatchObject([{ status: "fenced" }]);
  });

  it("returns public success only after widget message persistence and exposes manager dialog", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest()
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      ok: true,
      schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
      status: "accepted",
      action: "show_widget_saved",
      automation: {
        status: "disabled",
        next_step: "manager_review"
      }
    });
    expect(SiteWidgetResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json().public_session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.json().public_message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.json().lead_id).toBeUndefined();
    expect(response.json().conversation_id).toBeUndefined();
    expect(response.json().publicConversationId).toBeUndefined();
    expect(response.json().public_conversation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.json().trace_id).toBeUndefined();

    const managerList = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: managerAuthRepository.createSessionCookie() }
    });
    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().leads).toHaveLength(1);
    expect(managerList.json().leads[0]).toMatchObject({
      publicSubmissionId: response.json().public_message_id,
      status: "new",
      source: {
        channel: "site_widget",
        pageUrl: "https://granit.example/catalog/widget",
        formKind: "site_widget",
        widgetInstanceId: "floating-widget-v1"
      },
      contact: {
        name: "Widget Visitor",
        phone: "+15557654321",
        preferredContact: "phone"
      },
      request: {
        text: "Can you help me choose a monument?"
      }
    });

    const detail = await app.inject({
      method: "GET",
      url: `/manager/leads/${managerList.json().leads[0].leadId}`,
      headers: { cookie: managerAuthRepository.createSessionCookie() }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().lead).toMatchObject({
      conversations: [
        {
          channel: "site_widget",
          publicConversationId: expect.any(String),
          channelIdentity: {
            widgetPublicSessionId: response.json().public_session_id,
            widgetInstanceId: "floating-widget-v1"
          },
          agentAllowedToReply: false,
          messages: [
            {
              publicMessageId: response.json().public_message_id,
              direction: "inbound",
              senderRole: "visitor",
              body: "Can you help me choose a monument?"
            }
          ]
        }
      ],
      timeline: [
        {
          eventType: "lead.created_from_site_widget"
        },
        {
          eventType: "conversation.message_received",
          metadata: {
            public_message_id: response.json().public_message_id,
            automation_status: "disabled"
          }
        }
      ]
    });
  });

  it("raises returning widget sessions to the top of the manager list after new activity", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );
    const managerCookie = managerAuthRepository.createSessionCookie();

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-returning-session-0001",
        messageText: "Первый диалог"
      })
    });
    const firstLeadId = repository.onlyLead().leadId;
    const firstPublicSessionId = first.json().public_session_id as string;

    await waitForNextClockTick();
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-returning-session-0002",
        messageText: "Более новый отдельный диалог"
      })
    });

    await waitForNextClockTick();
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-returning-session-0003",
        publicSessionId: firstPublicSessionId,
        messageText: "Вернулся в старую сессию"
      })
    });

    const managerList = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: managerCookie }
    });

    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().leads).toHaveLength(2);
    expect(managerList.json().leads[0].leadId).toBe(firstLeadId);
    expect(managerList.json().leads[0].updatedAt).not.toBe(managerList.json().leads[0].createdAt);

    const detail = await app.inject({
      method: "GET",
      url: `/manager/leads/${firstLeadId}`,
      headers: { cookie: managerCookie }
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().lead.conversations[0].messages.at(-1)).toMatchObject({
      body: "Вернулся в старую сессию"
    });
  });

  it("does not return widget success when message persistence is not confirmed", async () => {
    const repository = new MemoryIntakeRepository({ failPersistence: true });
    const app = track(buildApi({ repository }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest()
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
      error: {
        type: "retryable_backend_failure",
        code: "persistence_unconfirmed",
        action: "retry_or_show_fallback",
        retry_after_seconds: 30
      }
    });
    expect(response.json().public_message_id).toBeUndefined();
    expect(repository.leadCount).toBe(0);
  });

  it("replays accepted widget messages for the same idempotency key", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));
    const payload = validWidgetRequest();

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({
      ok: true,
      status: "replayed",
      public_session_id: first.json().public_session_id,
      public_message_id: first.json().public_message_id
    });
    expect(repository.leadCount).toBe(1);
  });

  it("keeps repeated manager takeover from creating stale activity", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: {
              async generateDecision() {
                return {
                  candidate: {
                    version: "granit_model_turn.v1",
                    message: {
                      answerText: "Могу помочь с общими вариантами памятника.",
                      question: { text: "Какие детали важны?", target: "material" }
                    },
                    statePatches: [],
                    recommendationIds: [],
                    handoffIntent: null
                  },
                  observation: {
                    observedModelProvider: "openai",
                    observedModelName: "gpt-5.6-luna"
                  }
                };
              }
            },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS
          }
        },
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );
    const managerCookie = managerAuthRepository.createSessionCookie();

    const firstMessage = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-repeat-takeover-0001",
        messageText: "Расскажите про варианты памятника"
      })
    });
    const publicSessionId = firstMessage.json().public_session_id as string;
    const leadId = repository.onlyLead().leadId;
    const publicConversationId = repository.onlyLead().conversations[0]?.publicConversationId;

    if (!publicConversationId) {
      throw new Error("expected public conversation id");
    }

    const firstTakeover = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${leadId}/conversations/${publicConversationId}/takeover`,
      headers: { cookie: managerCookie }
    });
    await waitForNextClockTick();
    const repeatedTakeover = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${leadId}/conversations/${publicConversationId}/takeover`,
      headers: { cookie: managerCookie }
    });

    expect(firstMessage.statusCode).toBe(202);
    expect(firstTakeover.statusCode).toBe(200);
    expect(repeatedTakeover.statusCode).toBe(200);
    expect(repeatedTakeover.json().lead.updatedAt).toBe(firstTakeover.json().lead.updatedAt);
    expect(
      repeatedTakeover
        .json()
        .lead.timeline.filter(
          (event: { eventType: string }) => event.eventType === "conversation.manager_takeover"
        )
    ).toHaveLength(1);
    expect(repeatedTakeover.json().lead.conversations[0]).toMatchObject({
      publicConversationId,
      channelIdentity: {
        widgetPublicSessionId: publicSessionId
      },
      agentAllowedToReply: false
    });
  });

});

describe("channel-neutral conversation use cases", () => {
  it("accepts Telegram text inbound without widget-only fields and reuses provider identity", async () => {
    const repository = new MemoryIntakeRepository();
    const first = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-text-0001",
        providerMessageId: "tg-msg-1",
        providerUpdateId: "tg-update-1",
        text: "Здравствуйте, нужен памятник"
      })
    );
    const second = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-text-0002",
        providerMessageId: "tg-msg-2",
        providerUpdateId: "tg-update-2",
        text: "Город Чикаго"
      })
    );
    const replay = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-text-0002-retry",
        providerMessageId: "tg-msg-2",
        providerUpdateId: "tg-update-2",
        text: "Город Чикаго"
      })
    );

    expect(first.widgetPublicSessionId).toBeUndefined();
    expect(second).toMatchObject({
      leadId: first.leadId,
      conversationId: first.conversationId,
      publicConversationId: first.publicConversationId,
      channelIdentityId: first.channelIdentityId,
      agentAllowedToReply: true,
      aiState: "ai_collecting_info"
    });
    expect(replay).toMatchObject({
      publicMessageId: second.publicMessageId,
      replayed: true
    });
    expect(repository.onlyLead().source.pageUrl).toBeUndefined();
    expect(repository.onlyLead().source.formKind).toBeUndefined();
    expect(repository.onlyLead()).toMatchObject({
      source: {
        channel: "telegram"
      },
      conversations: [
        {
          channel: "telegram",
          publicConversationId: first.publicConversationId,
          channelIdentity: {
            provider: "telegram_bot",
            externalChatId: "chat-42",
            externalUserId: "user-42"
          },
          messages: [
            { body: "Здравствуйте, нужен памятник", contentType: "text" },
            { body: "Город Чикаго", contentType: "text" }
          ]
        }
      ]
    });
  });

  it("uses one manager takeover route and state transition for Telegram conversations", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const inbound = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-takeover-0001",
        providerMessageId: "tg-takeover-msg-1",
        providerUpdateId: "tg-takeover-update-1",
        text: "Хочу поговорить с менеджером"
      })
    );
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );

    const takeover = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${inbound.leadId}/conversations/${inbound.publicConversationId}/takeover`,
      headers: { cookie: managerAuthRepository.createSessionCookie() }
    });

    expect(takeover.statusCode).toBe(200);
    expect(takeover.json().lead.conversations[0]).toMatchObject({
      publicConversationId: inbound.publicConversationId,
      channel: "telegram",
      aiState: "manager_active",
      agentAllowedToReply: false
    });
    expect(takeover.json().lead.nextStep).toMatchObject({
      summary: "Связаться с клиентом",
      channel: "telegram"
    });
    expect(takeover.json().lead.timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.manager_takeover",
        metadata: expect.objectContaining({
          public_conversation_id: inbound.publicConversationId,
          channel: "telegram"
        })
      })
    );
  });

  it("keeps viewer managers read-only for conversation takeover", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository("viewer");
    const inbound = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-viewer-takeover-0001",
        providerMessageId: "tg-viewer-msg-1",
        providerUpdateId: "tg-viewer-update-1"
      })
    );
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );

    const takeover = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${inbound.leadId}/conversations/${inbound.publicConversationId}/takeover`,
      headers: { cookie: managerAuthRepository.createSessionCookie() }
    });

    expect(takeover.statusCode).toBe(403);
    expect(takeover.json()).toEqual({ error: "manager_forbidden" });
  });

  it("persists Telegram media as manager-visible needs-manager inbound without AI outbound", async () => {
    const repository = new MemoryIntakeRepository();

    const inbound = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-media-0001",
        providerMessageId: "tg-media-msg-1",
        providerUpdateId: "tg-media-update-1",
        text: "",
        contentType: "voice",
        providerFileId: "voice-file-1",
        caption: "Голосовое про заказ"
      })
    );

    expect(inbound).toMatchObject({
      agentAllowedToReply: false,
      aiState: "needs_manager"
    });
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      channel: "telegram",
      aiState: "needs_manager",
      agentAllowedToReply: false,
      messages: [
        {
          body: "Голосовое про заказ",
          contentType: "voice",
          providerFileId: "voice-file-1"
        }
      ]
    });
    expect(repository.onlyLead().timeline).toContainEqual(
      expect.objectContaining({
        eventType: "manager.notification_enqueued",
        metadata: expect.objectContaining({
          status: "blocked_no_destination",
          public_message_id: inbound.publicMessageId
        })
      })
    );
    expect(repository.aiSaveCalls).toBe(0);
  });

  it("blocks Telegram AI outbound until app-owned delivery worker exists", async () => {
    const repository = new MemoryIntakeRepository();
    const inbound = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "telegram-outbound-block-0001",
        providerMessageId: "tg-outbound-msg-1",
        providerUpdateId: "tg-outbound-update-1"
      })
    );

    await expect(
      repository.persistAiReplyWithSendGate({
        leadId: inbound.leadId,
        conversationId: inbound.conversationId,
        publicConversationId: inbound.publicConversationId,
        channel: "telegram",
        provider: "telegram_bot",
        publicMessageId: randomUUID(),
        inboundPublicMessageId: inbound.publicMessageId,
        idempotencyKey: `ai:${inbound.publicMessageId}`,
        requestFingerprint: "telegram-ai-outbound-block-fingerprint",
        expectedGenerationEpoch: 0,
        respondsThroughSequence: 1,
        body: "AI reply should not be sent",
        metadata: {}
      })
    ).rejects.toBeInstanceOf(TelegramOutboundBlockedError);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("records phone and WhatsApp contact as timeline and next-step state, not chat messages", async () => {
    const repository = new MemoryIntakeRepository();
    const saved = await repository.saveAcceptedSiteFormSubmission({
      publicSubmissionId: randomUUID(),
      request: {
        ...validRequest(),
        idempotency_key: "manual-contact-form-0001"
      },
      requestFingerprint: "manual-contact-form-fingerprint"
    });

    const updated = await repository.recordManualContact({
      leadId: saved.leadId,
      contactChannel: "whatsapp",
      summary: "Менеджер написал клиенту в WhatsApp",
      contactedAt: "2026-05-18T12:00:00.000Z",
      nextStepAt: "2026-05-19T09:00:00.000Z",
      nextStepSummary: "Проверить ответ клиента",
      changedByManagerId: "manager-manual-contact",
      changedByManagerEmail: "owner@yandex.ru",
      changedByManagerRole: "owner"
    });

    expect(updated?.nextStep).toEqual({
      at: "2026-05-19T09:00:00.000Z",
      summary: "Проверить ответ клиента",
      channel: "whatsapp"
    });
    expect(updated?.timeline).toContainEqual(
      expect.objectContaining({
        eventType: "lead.manual_contact_recorded",
        metadata: expect.objectContaining({
          contact_channel: "whatsapp",
          next_step_at: "2026-05-19T09:00:00.000Z"
        })
      })
    );
    expect(updated?.conversations).toEqual([]);
  });
});

describe("Telegram manager mini-panel webhook", () => {
  it("keeps the webhook disabled by default", async () => {
    const app = track(buildApi({ repository: new MemoryIntakeRepository() }));

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      payload: telegramTextUpdate()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "telegram_bot_disabled" });
  });

  it("validates the webhook secret before accepting Telegram updates", async () => {
    const app = track(
      buildApi({
        repository: new MemoryIntakeRepository(),
        telegramBot: testTelegramBotOptions()
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
      payload: telegramTextUpdate()
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "telegram_webhook_secret_invalid" });
  });

  it("binds a manager Telegram chat through a web-panel token", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        },
        telegramBot: testTelegramBotOptions()
      })
    );
    const cookie = managerAuthRepository.createSessionCookie();

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/manager/me/telegram-bind-token",
      headers: { cookie }
    });
    const token = tokenResponse.json().bindToken.token as string;
    const bind = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2001,
        messageId: 501,
        chatId: 9001,
        fromId: 9001,
        username: "owner_manager",
        text: `/start ${token}`
      })
    });
    const me = await app.inject({
      method: "GET",
      url: "/manager/me",
      headers: { cookie }
    });

    expect(tokenResponse.statusCode).toBe(200);
    expect(bind.statusCode).toBe(200);
    expect(bind.json()).toEqual({ ok: true, status: "bound_manager" });
    expect(me.json().telegramBinding).toMatchObject({
      bound: true,
      username: "owner_manager"
    });
  });

  it("does not bind a manager token from non-private Telegram chats", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        },
        telegramBot: testTelegramBotOptions()
      })
    );
    const cookie = managerAuthRepository.createSessionCookie();
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/manager/me/telegram-bind-token",
      headers: { cookie }
    });
    const token = tokenResponse.json().bindToken.token as string;

    const groupBind = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2051,
        messageId: 551,
        chatId: -1009001,
        chatType: "group",
        fromId: 9001,
        username: "owner_manager",
        text: `/start ${token}`
      })
    });
    const meAfterGroup = await app.inject({
      method: "GET",
      url: "/manager/me",
      headers: { cookie }
    });
    const privateBind = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2052,
        messageId: 552,
        chatId: 9001,
        chatType: "private",
        fromId: 9001,
        username: "owner_manager",
        text: `/start ${token}`
      })
    });

    expect(groupBind.statusCode).toBe(200);
    expect(groupBind.json()).toEqual({ ok: true, status: "ignored_unsupported_update" });
    expect(meAfterGroup.json().telegramBinding).toEqual({ bound: false });
    expect(privateBind.json()).toEqual({ ok: true, status: "bound_manager" });
  });

  it("persists customer inbound and queues a manager notification after binding", async () => {
    const { app, repository } = await boundTelegramManagerApp(track);

    const first = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2101,
        messageId: 601,
        chatId: 42,
        fromId: 42,
        username: "customer",
        text: "Срочно нужен памятник"
      })
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2101,
        messageId: 601,
        chatId: 42,
        fromId: 42,
        username: "customer",
        text: "Срочно нужен памятник"
      })
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, status: "accepted" });
    expect(duplicate.statusCode).toBe(200);
    expect(repository.leadCount).toBe(1);
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      channel: "telegram",
      aiState: "needs_manager",
      agentAllowedToReply: false,
      messages: [
        {
          direction: "inbound",
          senderRole: "visitor",
          body: "Срочно нужен памятник"
        }
      ]
    });
    expect(repository.onlyLead().timeline).toContainEqual(
      expect.objectContaining({
        eventType: "manager.notification_enqueued",
        metadata: expect.objectContaining({
          status: "pending",
          needs_manager_reason: "telegram_urgent"
        })
      })
    );
  });

  it("blocks Telegram manager replies until takeover creates an active reply context", async () => {
    const { app, repository } = await boundTelegramManagerApp(track);
    await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2201,
        messageId: 701,
        chatId: 77,
        fromId: 77,
        text: "Нужен человек"
      })
    });
    const publicConversationId = repository.onlyLead().conversations[0]?.publicConversationId;

    if (!publicConversationId) {
      throw new Error("expected telegram conversation");
    }

    const replyAction = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramCallbackUpdate({
        updateId: 2202,
        chatId: 9001,
        fromId: 9001,
        data: `reply:${publicConversationId}`
      })
    });
    const managerText = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2203,
        messageId: 702,
        chatId: 9001,
        fromId: 9001,
        text: "Здравствуйте, я менеджер"
      })
    });

    expect(replyAction.json()).toEqual({ ok: true, status: "manager_reply_requires_takeover" });
    expect(managerText.json()).toEqual({ ok: true, status: "manager_reply_context_missing" });
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("blocks Telegram viewer text replies from a bound manager chat", async () => {
    const repository = new MemoryIntakeRepository();
    const bindToken = await repository.createManagerTelegramBindToken({
      managerUserId: "viewer-manager-1",
      managerEmail: "viewer@example.com",
      managerRole: "viewer"
    });
    await repository.bindManagerTelegramChat({
      token: bindToken.token,
      providerAccountId: "bot-main",
      externalChatId: "9002",
      externalUserId: "9002",
      username: "viewer_manager"
    });
    const app = track(
      buildApi({
        repository,
        telegramBot: testTelegramBotOptions()
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2251,
        messageId: 751,
        chatId: 9002,
        fromId: 9002,
        text: "Попробую ответить клиенту"
      })
    });

    expect(response.json()).toEqual({ ok: true, status: "manager_forbidden" });
    await expect(repository.listManagerLeads()).resolves.toEqual([]);
  });

  it("allows Telegram manager reply after takeover and records pending delivery state", async () => {
    const { app, repository } = await boundTelegramManagerApp(track);
    await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2301,
        messageId: 801,
        chatId: 88,
        fromId: 88,
        text: "Нужен менеджер"
      })
    });
    const publicConversationId = repository.onlyLead().conversations[0]?.publicConversationId;

    if (!publicConversationId) {
      throw new Error("expected telegram conversation");
    }

    const takeover = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramCallbackUpdate({
        updateId: 2302,
        chatId: 9001,
        fromId: 9001,
        data: `takeover:${publicConversationId}`
      })
    });
    const replyContext = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramCallbackUpdate({
        updateId: 2303,
        chatId: 9001,
        fromId: 9001,
        data: `reply:${publicConversationId}`
      })
    });
    const reply = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: testTelegramSecretHeader(),
      payload: telegramTextUpdate({
        updateId: 2304,
        messageId: 802,
        chatId: 9001,
        fromId: 9001,
        text: "Здравствуйте. Уточню детали заказа."
      })
    });

    expect(takeover.json()).toEqual({ ok: true, status: "manager_takeover_done" });
    expect(replyContext.json()).toEqual({ ok: true, status: "manager_reply_context_created" });
    expect(reply.json()).toEqual({ ok: true, status: "manager_reply_queued" });
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      aiState: "manager_active",
      agentAllowedToReply: false,
      messages: [
        expect.objectContaining({ senderRole: "visitor" }),
        expect.objectContaining({
          direction: "outbound",
          senderRole: "manager",
          body: "Здравствуйте. Уточню детали заказа.",
          delivery: expect.objectContaining({
            status: "pending",
            attemptCount: 0
          })
        })
      ]
    });
    expect(repository.onlyLead().timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.manager_message_queued",
        metadata: expect.objectContaining({
          delivery_status: "pending"
        })
      })
    );
  });

  it("keeps the webhook free of direct Telegram provider sends", () => {
    const serviceSource = readFixtureSource(
      "apps/api/src/modules/telegram/inbound/telegram-bot-service.ts"
    );
    const routeSource = readFixtureSource(
      "apps/api/src/modules/telegram/inbound/routes/telegram-routes.ts"
    );
    const runtimeSource = `${serviceSource}\n${routeSource}`;

    expect(runtimeSource).not.toMatch(/\bsendMessage\b/);
    expect(runtimeSource).not.toMatch(/\bforwardMessage\b/);
    expect(runtimeSource).not.toMatch(/\bcopyMessage\b/);
  });
});

function validRequest(): SiteFormIntakeRequest {
  return {
    schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
    event_type: PUBLIC_INTAKE_EVENT_TYPE,
    idempotency_key: "test-key-00000001",
    submitted_at: "2026-05-11T10:00:00.000Z",
    source: {
      channel: "site_form",
      page_url: "https://granit.example/catalog/memorial",
      form_kind: "catalog_request",
      referrer_url: "https://granit.example/",
      utm: {
        source: "site",
        medium: "form",
        campaign: "s01"
      }
    },
    contact: {
      name: "Test Visitor",
      phone: "+15551234567",
      preferred_contact: "phone",
      city: "Chicago"
    },
    request: {
      message: "Need a consultation for a family monument",
      product_interest: "memorial"
    },
    consent: {
      privacy_policy: true
    }
  };
}

class MismatchedAiExecutionContextRepository extends MemoryIntakeRepository {
  override async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    const saved = await super.saveAcceptedSiteWidgetMessage(input);

    return saved.aiTurnExecutionContext
      ? {
          ...saved,
          aiTurnExecutionContext: {
            ...saved.aiTurnExecutionContext,
            internal: {
              ...saved.aiTurnExecutionContext.internal,
              conversationId: randomUUID()
            }
          }
        }
      : saved;
  }
}

function validWidgetRequest(
  overrides: { idempotencyKey?: string; messageText?: string; publicSessionId?: string } = {}
): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: overrides.idempotencyKey ?? "widget-key-0000001",
    submitted_at: "2026-05-13T10:00:00.000Z",
    public_session_id: overrides.publicSessionId,
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "floating-widget-v1",
      referrer_url: "https://granit.example/",
      page_title: "Widget test page",
      utm: {
        source: "site",
        medium: "widget",
        campaign: "s04"
      }
    },
    contact: {
      name: "Widget Visitor",
      phone: "+15557654321",
      preferred_contact: "phone"
    },
    message: {
      role: "visitor",
      text: overrides.messageText ?? "Can you help me choose a monument?"
    },
    visitor_context: {
      locale: "en-US",
      timezone: "UTC"
    },
    consent: {
      privacy_policy: true
    }
  };
}

function validWidgetV2Request(
  overrides: { idempotencyKey?: string; messageText?: string; publicSessionId?: string } = {}
): SiteWidgetV2MessageRequest {
  return {
    ...validWidgetRequest(overrides),
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    submitted_at: "2020-01-01T00:00:00.000Z"
  };
}

class FakeGroundedPlanningProvider implements GroundedWidgetAiProvider {
  readonly attempts: Array<"initial" | "repair"> = [];

  constructor(private readonly decisions: GroundedAiTurnCandidateDecision[]) {}

  async generateGroundedReply(
    input: GroundedWidgetAiProviderInput
  ): Promise<GroundedWidgetAiProviderResult> {
    this.attempts.push(input.attempt);
    const decision = this.decisions.shift();

    if (!decision) {
      throw new Error("missing fake grounded decision");
    }

    return {
      decision,
      modelProvider: "fake",
      modelName: "fake-grounded-planner"
    };
  }
}

class FakeGroundedVerifier implements WidgetAiSemanticVerifier {
  constructor(private readonly verifications: WidgetAiVerification[]) {}

  async verify(_input: WidgetAiVerifierInput): Promise<WidgetAiVerifierResult> {
    const verification = this.verifications.shift();

    if (!verification) {
      throw new Error("missing fake grounded verification");
    }

    return {
      verification,
      modelProvider: "fake",
      modelName: "fake-grounded-verifier"
    };
  }
}

function groundedDecision(
  overrides: Partial<GroundedAiTurnCandidateDecision> = {}
): GroundedAiTurnCandidateDecision {
  return {
    version: GROUNDED_AI_TURN_DECISION_VERSION,
    action: "clarify",
    intent: "product_selection",
    replyText: "Могу помочь собрать детали заявки.",
    extractedSlots: [],
    extractedRequirements: [],
    requestedSlots: ["material"],
    riskFlags: [],
    handoffReason: null,
    confidence: 0.9,
    ...overrides
  };
}

function groundedVerification(
  verdict: WidgetAiVerification["verdict"],
  requiredAction: WidgetAiVerification["requiredAction"]
): WidgetAiVerification {
  return {
    version: WIDGET_AI_VERIFIER_VERSION,
    verdict,
    requiredAction,
    violations: [],
    factualClaimsPresent: false,
    claimCoverageComplete: true,
    claimVerdicts: [],
    slotVerdicts: [],
    requirementVerdicts: [],
    confidence: 0.97
  };
}

function expectNoInternalPublicFields(value: unknown) {
  const forbidden = new Set([
    "lead_id",
    "leadId",
    "conversation_id",
    "conversationId",
    "internal_message_id",
    "internalMessageId",
    "inbound_message_id",
    "inboundMessageId",
    "ai_turn_execution_context",
    "aiTurnExecutionContext",
    "publicConversationId",
    "public_conversation_id",
    "trace_id"
  ]);

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      expectNoInternalPublicFields(item);
    }

    return;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    expect(forbidden.has(key)).toBe(false);
    expectNoInternalPublicFields(entryValue);
  }
}
