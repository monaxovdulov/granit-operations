import { randomUUID } from "node:crypto";

import {
  PUBLIC_INTAKE_CONTRACT_VERSION,
  PUBLIC_INTAKE_EVENT_TYPE,
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SiteWidgetResponseSchema,
  type SiteFormIntakeRequest,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AI_TURN_INPUT_VERSION, type AiTurnInput } from "../src/modules/ai/ai-turn.js";
import {
  AI_TURN_DECISION_VERSION,
  type AiTurnCandidateDecision
} from "../src/modules/ai/ai-dialog-contract.js";
import { WIDGET_AI_POLICY_VERSION } from "../src/modules/ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../src/modules/ai/prompts/widget-ai-prompt.js";
import { APPROVED_WIDGET_KNOWLEDGE_VERSION } from "../src/modules/ai/knowledge/approved-widget-knowledge.js";
import { buildApi } from "../src/app.js";
import { TelegramOutboundBlockedError } from "../src/repositories/intake-repository.js";
import type { PublicWidgetAiReplyGenerator } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { FakeWidgetAiProvider } from "./helpers/fake-widget-ai-provider.js";
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
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
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
    expect(response.json().public_conversation_id).toBeUndefined();
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
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
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

  it("persists inbound before generating and returning a persisted AI reply", async () => {
    const repository = new MemoryIntakeRepository();
    let providerSawPersistedInbound = false;
    const provider = new FakeWidgetAiProvider({
      text: "Могу помочь с общими вариантами памятника. Какой формат вы рассматриваете?",
      onGenerate: () => {
        providerSawPersistedInbound = repository.leadCount === 1;
      }
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest()
    });

    expect(response.statusCode).toBe(202);
    expect(providerSawPersistedInbound).toBe(true);
    expect(response.json()).toMatchObject({
      ok: true,
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
      status: "accepted",
      automation: {
        status: "replied",
        next_step: "ai_reply_shown",
        reply: {
          sender_role: "ai_assistant",
          text: "Могу помочь с общими вариантами памятника. Какой формат вы рассматриваете?"
        }
      }
    });
    expect(response.json().automation.reply.public_message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expectNoInternalPublicFields(response.json());

    const lead = repository.onlyLead();
    expect(lead.conversations[0]?.agentAllowedToReply).toBe(true);
    expect(lead.conversations[0]?.messages).toMatchObject([
      {
        publicMessageId: response.json().public_message_id,
        direction: "inbound",
        senderRole: "visitor",
        body: "Can you help me choose a monument?"
      },
      {
        publicMessageId: response.json().automation.reply.public_message_id,
        direction: "outbound",
        senderRole: "ai_assistant",
        body: "Могу помочь с общими вариантами памятника. Какой формат вы рассматриваете?"
      }
    ]);
  });

  it("builds AI input from accepted app-owned state instead of the raw widget DTO", async () => {
    const repository = new MemoryIntakeRepository();
    let seenInput: AiTurnInput | undefined;
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply(input) {
        seenInput = input;
        expect(repository.leadCount).toBe(1);

        return {
          decision: "reply_candidate",
          text: "Могу помочь с общими вариантами памятника. Какие детали важны?",
          metadata: {
            model_provider: "fake",
            model_name: "boundary-test"
          }
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-ai-boundary-input-0001",
        messageText: "Расскажите про варианты гранита"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().automation.status).toBe("replied");
    expect(seenInput).toMatchObject({
      version: AI_TURN_INPUT_VERSION,
      channel: "site_widget",
      replyCapability: "site_widget_sync_reply",
      turn: {
        idempotencyKey: `ai-turn:${response.json().public_message_id}`,
        startedAt: "2026-05-13T10:00:00.000Z",
        inputFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
      },
      conversation: {
        publicConversationId: repository.onlyLead().conversations[0]?.publicConversationId,
        agentAllowedToReply: true,
        aiState: "ai_collecting_info"
      },
      gateSnapshot: {
        agentAllowedToReply: true,
        aiState: "ai_collecting_info",
        capturedAt: "2026-05-13T10:00:00.000Z"
      },
      inboundMessage: {
        publicMessageId: response.json().public_message_id,
        contentType: "text",
        text: "Расскажите про варианты гранита"
      },
      page: {
        url: "https://granit.example/catalog/widget",
        widgetInstanceId: "floating-widget-v1"
      },
      customer: {
        name: "Widget Visitor",
        phoneProvided: true
      },
      compactContext: {
        messages: []
      },
      knownSlots: {
        customerNameProvided: true,
        phoneProvided: true,
        emailProvided: false,
        preferredContact: "phone",
        values: {
          customerName: {
            value: "Widget Visitor",
            source: "contact"
          }
        }
      },
      boundaryConfig: {
        replyCapableChannel: "site_widget",
        maxClarifyingQuestions: 1,
        priceOrientationAllowed: false,
        telegramAiOutboundAllowed: false
      },
      approvedSources: {
        price: null,
        businessFacts: [
          {
            sourceId: "public_site.catalog.monument_types",
            version: APPROVED_WIDGET_KNOWLEDGE_VERSION,
            reviewBasis: "published_site_content"
          }
        ]
      },
      evidence: {
        boundary: "stage_a_neutral_ai_turn",
        source: "accept_inbound_message"
      }
    });
    expect(seenInput?.turn.acceptedRequestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(seenInput?.evidence.acceptedRequestFingerprint).toBe(
      seenInput?.turn.acceptedRequestFingerprint
    );
    expect(JSON.stringify(seenInput)).not.toContain("idempotency_key");
    expect(JSON.stringify(seenInput)).not.toContain("schema_version");
    expect(JSON.stringify(seenInput)).not.toContain("event_type");
  });

  it("replays a persisted AI reply without calling the generator again", async () => {
    const repository = new MemoryIntakeRepository();
    let generatorCalls = 0;
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        generatorCalls += 1;

        return {
          decision: "reply_candidate",
          text: "Могу помочь собрать детали заявки.",
          metadata: {
            model_provider: "fake",
            model_name: "replay-test"
          }
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );
    const payload = validWidgetRequest({ idempotencyKey: "widget-ai-replay-0001" });

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
    expect(generatorCalls).toBe(1);
    expect(second.json()).toMatchObject({
      ok: true,
      status: "replayed",
      automation: {
        status: "replied",
        reply: {
          public_message_id: first.json().automation.reply.public_message_id,
          text: "Могу помочь собрать детали заявки."
        }
      }
    });
  });

  it("replays a persisted AI reply even when current AI config is disabled", async () => {
    const repository = new MemoryIntakeRepository();
    let generatorCalls = 0;
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        generatorCalls += 1;

        return {
          decision: "reply_candidate",
          text: "Могу помочь собрать детали заявки.",
          metadata: {
            model_provider: "fake",
            model_name: "replay-disabled-test"
          }
        };
      }
    };
    const enabledApp = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );
    const payload = validWidgetRequest({ idempotencyKey: "widget-ai-replay-disabled-0001" });

    const first = await enabledApp.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    const disabledApp = track(buildApi({ repository }));
    const second = await disabledApp.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(generatorCalls).toBe(1);
    expect(second.json()).toMatchObject({
      ok: true,
      status: "replayed",
      automation: {
        status: "replied",
        reply: {
          public_message_id: first.json().automation.reply.public_message_id,
          text: "Могу помочь собрать детали заявки."
        }
      }
    });
  });

  it("fails closed when AI returns an invalid candidate", async () => {
    const repository = new MemoryIntakeRepository();
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        return {
          decision: "reply_candidate",
          text: { unsafe: true },
          metadata: {}
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({ idempotencyKey: "widget-invalid-candidate-0001" })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: {
        status: "degraded",
        next_step: "retry_available",
        reason: "unsafe_model_response"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.aiSaveCalls).toBe(0);
  });

  it("fails closed when a price or facts candidate lacks an approved source", async () => {
    const repository = new MemoryIntakeRepository();
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        return {
          decision: "reply_candidate",
          text: "Цена 10000 рублей.",
          metadata: {
            model_provider: "fake",
            model_name: "missing-source-test"
          },
          evidence: {
            businessFacts: [{ kind: "price" }]
          }
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-price-source-block-0001",
        messageText: "Сколько стоит памятник?"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: {
        status: "degraded",
        reason: "unsafe_model_response"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.aiSaveCalls).toBe(0);
  });

  it("allows a selected published-site fact only with matching typed source evidence", async () => {
    const repository = new MemoryIntakeRepository();
    const provider = new FakeWidgetAiProvider({
      decision: aiDecision({
        intent: "product_selection",
        replyText:
          "На сайте представлены вертикальные, горизонтальные, двойные и семейные памятники, а также мемориальные комплексы.",
        sourceEvidence: [
          {
            sourceId: "public_site.catalog.monument_types",
            version: APPROVED_WIDGET_KNOWLEDGE_VERSION,
            kind: "business_fact"
          }
        ]
      })
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: { enabled: true, provider, modelName: "gpt-5.5" }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-approved-fact-0001",
        messageText: "Какие варианты памятников у вас есть?"
      })
    });

    expect(response.json().automation.status).toBe("replied");
    expect(repository.lastAiSaveInput?.metadata).toMatchObject({
      ai_intent: "product_selection"
    });
  });

  it("fails closed when a Stage A price candidate gives amount, range or from-X orientation", async () => {
    const unsafePriceTexts = ["Цена 10000.", "Цена от 10000.", "Стоимость 10000-15000."];

    for (const [index, text] of unsafePriceTexts.entries()) {
      const repository = new MemoryIntakeRepository();
      const replyGenerator: PublicWidgetAiReplyGenerator = {
        async generateReply() {
          return {
            decision: "reply_candidate",
            text,
            metadata: {
              model_provider: "fake",
              model_name: "price-orientation-test"
            }
          };
        }
      };
      const app = track(
        buildApi({
          repository,
          widgetAi: {
            enabled: true,
            replyGenerator
          }
        })
      );

      const response = await app.inject({
        method: "POST",
        url: "/public/intake/site-widget/messages",
        payload: validWidgetRequest({
          idempotencyKey: `widget-price-orientation-block-${String(index).padStart(4, "0")}`,
          messageText: "Сколько стоит памятник?"
        })
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        automation: {
          status: "degraded",
          reason: "unsafe_model_response"
        }
      });
      expect(response.json().automation.reply).toBeUndefined();
      expect(repository.aiSaveCalls).toBe(0);
    }
  });

  it("fails closed when a candidate self-authorizes a price source", async () => {
    const repository = new MemoryIntakeRepository();
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        return {
          decision: "reply_candidate",
          text: "Цена от 10000.",
          metadata: {
            model_provider: "fake",
            model_name: "candidate-source-test"
          },
          evidence: {
            businessFacts: [{ kind: "price", approvedSourceId: "candidate-price-list-v1" }]
          }
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-self-approved-price-block-0001",
        messageText: "Сколько стоит памятник?"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: {
        status: "degraded",
        reason: "unsafe_model_response"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.aiSaveCalls).toBe(0);
  });

  it("keeps the AI input fingerprint separate from outbound persistence idempotency", async () => {
    const repository = new MemoryIntakeRepository();
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        return {
          decision: "reply_candidate",
          text: "Могу помочь собрать детали заявки.",
          metadata: {
            model_provider: "fake",
            model_name: "fingerprint-test"
          }
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({ idempotencyKey: "widget-ai-fingerprint-0001" })
    });

    const aiSaveInput = repository.lastAiSaveInput;

    expect(response.statusCode).toBe(202);
    expect(response.json().automation.status).toBe("replied");
    expect(aiSaveInput).toBeDefined();
    expect(aiSaveInput?.idempotencyKey).toBe(`ai:${response.json().public_message_id}`);
    expect(typeof aiSaveInput?.metadata.ai_input_fingerprint).toBe("string");
    expect(aiSaveInput?.metadata.ai_input_fingerprint).not.toBe(aiSaveInput?.requestFingerprint);
    expect(aiSaveInput?.metadata.ai_input_fingerprint).not.toBe(aiSaveInput?.idempotencyKey);
  });

  it("does not expose an AI reply when AI persistence fails", async () => {
    const repository = new MemoryIntakeRepository({ failAiPersistence: true });
    const provider = new FakeWidgetAiProvider({
      text: "Расскажу об общих вариантах и передам детали менеджеру."
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
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
      automation: {
        status: "degraded",
        next_step: "retry_available",
        reason: "ai_persistence_unconfirmed"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      aiState: "ai_collecting_info",
      agentAllowedToReply: true
    });
    expect(repository.onlyLead().timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.ai_degraded",
        metadata: expect.objectContaining({ reason: "ai_persistence_unconfirmed" })
      })
    );
  });

  it("falls back without false AI success when the model provider fails", async () => {
    const repository = new MemoryIntakeRepository();
    const provider = new FakeWidgetAiProvider({ fail: true });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
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
      automation: {
        status: "degraded",
        next_step: "retry_available",
        reason: "model_error"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      aiState: "ai_collecting_info",
      agentAllowedToReply: true
    });
    expect(repository.onlyLead().timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.ai_degraded",
        metadata: expect.objectContaining({ reason: "model_error" })
      })
    );
  });

  it("falls back without saving an AI reply when the model output is unsafe", async () => {
    const repository = new MemoryIntakeRepository();
    const provider = new FakeWidgetAiProvider({
      text: "Цена 10000 рублей, сделаем за 2 дня, гарантия есть."
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-unsafe-model-0001",
        messageText: "Расскажите про варианты гранита"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      ok: true,
      automation: {
        status: "degraded",
        next_step: "retry_available",
        reason: "unsafe_model_response"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("keeps ordinary price and deadline questions in a useful Consult-first dialog", async () => {
    const consultPrompts = [
      {
        text: "Сколько примерно будет стоить памятник?",
        decision: aiDecision({
          action: "clarify",
          intent: "price_intake",
          replyText:
            "Стоимость зависит от материала и размера. Какой материал вы рассматриваете?",
          requestedSlots: ["material"],
          riskFlags: ["exact_price_requested", "missing_approved_source"]
        })
      },
      {
        text: "Какие обычно сроки изготовления?",
        decision: aiDecision({
          action: "clarify",
          intent: "deadline_intake",
          replyText:
            "Срок зависит от модели и оформления. Какой тип памятника вы рассматриваете?",
          requestedSlots: ["monumentType"]
        })
      }
    ];

    for (const [index, prompt] of consultPrompts.entries()) {
      const repository = new MemoryIntakeRepository();
      let providerCalls = 0;
      const provider = new FakeWidgetAiProvider({
        decision: prompt.decision,
        onGenerate: () => {
          providerCalls += 1;
        }
      });
      const app = track(
        buildApi({
          repository,
          widgetAi: {
            enabled: true,
            provider,
            modelName: "gpt-5.5"
          }
        })
      );

      const response = await app.inject({
        method: "POST",
        url: "/public/intake/site-widget/messages",
        payload: validWidgetRequest({
          idempotencyKey: `widget-consult-first-${String(index).padStart(4, "0")}`,
          messageText: prompt.text
        })
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().automation.status).toBe("replied");
      expect(response.json().automation.reply.text).not.toMatch(/\d[\d\s]*(?:₽|руб|р\.)/i);
      expect(providerCalls).toBe(1);
      expect(repository.lastAiSaveInput?.agentAllowedToReplyAfterSend).not.toBe(false);
      expect(repository.lastAiSaveInput?.metadata).toMatchObject({
        model_provider: "fake",
        ai_action: "clarify",
        prompt_version: WIDGET_AI_PROMPT_VERSION
      });
    }
  });

  it("answers calculation requests with a deterministic clarify before model generation", async () => {
    const repository = new MemoryIntakeRepository();
    let providerCalls = 0;
    const provider = new FakeWidgetAiProvider({
      fail: true,
      onGenerate: () => {
        providerCalls += 1;
      }
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-calculation-policy-0001",
        messageText: "Нужен расчет памятника с установкой"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().automation.status).toBe("replied");
    expect(response.json().automation.reply.text).toMatch(/для расч[её]та/i);
    expect(providerCalls).toBe(0);
    expect(repository.lastAiSaveInput?.agentAllowedToReplyAfterSend).not.toBe(false);
    expect(repository.lastAiSaveInput?.metadata).toMatchObject({
      model_provider: "policy",
      model_name: "deterministic",
      fallback_mode: "none",
      policy_reason: "calculation_intake_clarify",
      policy_version: WIDGET_AI_POLICY_VERSION,
      prompt_version: WIDGET_AI_PROMPT_VERSION
    });
  });

  it("hands final quote, binding terms and legal topics to a manager without model improvisation", async () => {
    const handoffPrompts = [
      {
        text: "Назовите точную финальную цену памятника",
        reason: "final_quote_pressure"
      },
      {
        text: "Какая гарантия?",
        reason: "binding_terms_require_manager_confirmation"
      },
      {
        text: "Можно оплатить в рассрочку?",
        reason: "binding_terms_require_manager_confirmation"
      },
      {
        text: "Как оформить наследство и документы на захоронение?",
        reason: "out_of_scope_legal_funeral_inheritance"
      }
    ];

    for (const [index, prompt] of handoffPrompts.entries()) {
      const repository = new MemoryIntakeRepository();
      let providerCalls = 0;
      const provider = new FakeWidgetAiProvider({
        text: "Цена 10000 рублей, сделаем за 2 дня, гарантия есть.",
        onGenerate: () => {
          providerCalls += 1;
        }
      });
      const app = track(
        buildApi({
          repository,
          widgetAi: {
            enabled: true,
            provider,
            modelName: "gpt-5.5"
          }
        })
      );

      const response = await app.inject({
        method: "POST",
        url: "/public/intake/site-widget/messages",
        payload: validWidgetRequest({
          idempotencyKey: `widget-handoff-ai-${String(index).padStart(4, "0")}`,
          messageText: prompt.text
        })
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().automation.status).toBe("replied");
      const replyText = response.json().automation.reply.text as string;
      expect(replyText).not.toMatch(/\d[\d\s]*(?:₽|руб|р\.)/i);
      expect(replyText).not.toMatch(/(?:за|через)\s+\d+\s*(?:дн|час|нед|месяц)/i);
      expect(replyText).not.toMatch(/гарантируем|скидк[ауи]\s*\d|в наличии|рассрочк[ау]/i);
      expect(replyText).toMatch(/менеджер|подтвердит|сохранено|передам/i);
      expect(providerCalls).toBe(0);
      expect(repository.lastAiSaveInput?.agentAllowedToReplyAfterSend).toBe(false);
      expect(repository.lastAiSaveInput?.handoff).toMatchObject({
        reason:
          prompt.reason === "final_quote_pressure"
            ? "final_quote_pressure"
            : prompt.reason === "out_of_scope_legal_funeral_inheritance"
              ? "out_of_scope"
              : "binding_terms"
      });
      expect(repository.onlyLead().timeline).toContainEqual(
        expect.objectContaining({
          eventType: "conversation.ai_handoff_created"
        })
      );
      expect(repository.lastAiSaveInput?.metadata).toMatchObject({
        model_provider: "policy",
        model_name: "deterministic",
        fallback_mode: "manager_required",
        handoff_reason: prompt.reason,
        policy_version: WIDGET_AI_POLICY_VERSION,
        prompt_version: WIDGET_AI_PROMPT_VERSION
      });
    }
  });

  it("carries prior visitor and AI messages plus extracted slots into the next turn", async () => {
    const repository = new MemoryIntakeRepository();
    const seenTurns: AiTurnInput[] = [];
    const provider = new FakeWidgetAiProvider({
      decisions: [
        aiDecision({
          action: "clarify",
          intent: "product_selection",
          replyText: "Чёрный гранит подходит. Какой размер памятника нужен?",
          extractedSlots: [
            { name: "material", value: "чёрный гранит", confidence: 0.96 }
          ],
          requestedSlots: ["size"]
        }),
        aiDecision({
          action: "clarify",
          intent: "product_selection",
          replyText: "Размер записал. На каком кладбище планируется установка?",
          extractedSlots: [{ name: "size", value: "120 × 60 см", confidence: 0.94 }],
          requestedSlots: ["cemetery"]
        })
      ],
      onGenerate: (input) => {
        seenTurns.push(input.turn);
      }
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: { enabled: true, provider, modelName: "gpt-5.5" }
      })
    );

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-multiturn-0001",
        messageText: "Нужен памятник из чёрного гранита"
      })
    });
    const second = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-multiturn-0002",
        publicSessionId: first.json().public_session_id,
        messageText: "Размер примерно 120 на 60 сантиметров"
      })
    });

    expect(first.json().automation.status).toBe("replied");
    expect(second.json().automation.status).toBe("replied");
    expect(seenTurns).toHaveLength(2);
    expect(seenTurns[0]?.compactContext.messages).toEqual([]);
    expect(seenTurns[1]?.compactContext.messages).toMatchObject([
      { senderRole: "visitor", text: "Нужен памятник из чёрного гранита" },
      { senderRole: "ai_assistant", text: "Чёрный гранит подходит. Какой размер памятника нужен?" }
    ]);
    expect(seenTurns[1]?.knownSlots.values.material).toMatchObject({
      value: "чёрный гранит",
      source: "ai_extraction",
      confidence: 0.96
    });
    expect(repository.lastAiSaveInput?.slotUpdates).toMatchObject([
      { name: "size", value: "120 × 60 см", source: "ai_extraction" }
    ]);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(4);

    const restored = await app.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${first.json().public_session_id}/history`
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      ok: true,
      schema_version: "site_widget.history.v1",
      public_session_id: first.json().public_session_id,
      conversation_state: "ai_active",
      messages: [
        { sender_role: "visitor", text: "Нужен памятник из чёрного гранита" },
        { sender_role: "ai_assistant" },
        { sender_role: "visitor", text: "Размер примерно 120 на 60 сантиметров" },
        { sender_role: "ai_assistant" }
      ]
    });
  });

  it("lets a manager takeover disable later AI replies for the widget session", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    let providerCalls = 0;
    const provider = new FakeWidgetAiProvider({
      text: "Могу помочь с общими вариантами памятника. Какие детали важны?",
      onGenerate: () => {
        providerCalls += 1;
      }
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
        },
        managerAuth: {
          repository: managerAuthRepository,
          config: testManagerAuthConfig()
        }
      })
    );

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-takeover-0001",
        messageText: "Расскажите про варианты памятника"
      })
    });
    const publicSessionId = first.json().public_session_id as string;
    const leadId = repository.onlyLead().leadId;
    const publicConversationId = repository.onlyLead().conversations[0]?.publicConversationId;

    if (!publicConversationId) {
      throw new Error("expected public conversation id");
    }

    const takeover = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${leadId}/conversations/${publicConversationId}/takeover`,
      headers: { cookie: managerAuthRepository.createSessionCookie() }
    });

    const second = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-takeover-0002",
        publicSessionId,
        messageText: "Еще вопрос после takeover"
      })
    });

    expect(first.statusCode).toBe(202);
    expect(first.json().automation.status).toBe("replied");
    expect(takeover.statusCode).toBe(200);
    expect(takeover.json().lead.conversations[0]).toMatchObject({
      publicConversationId,
      channelIdentity: {
        widgetPublicSessionId: publicSessionId
      },
      agentAllowedToReply: false
    });
    expect(takeover.json().lead.timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.manager_takeover",
        metadata: expect.objectContaining({
          public_conversation_id: publicConversationId,
          previous_agent_allowed_to_reply: true,
          changed_by_manager_email: "owner@yandex.ru"
        })
      })
    );
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({
      automation: {
        status: "fallback",
        next_step: "manager_review",
        reason: "agent_reply_blocked"
      }
    });
    expect(second.json().automation.reply).toBeUndefined();
    expect(providerCalls).toBe(1);
    expect(repository.onlyLead().conversations[0]?.agentAllowedToReply).toBe(false);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(3);
    expect(repository.onlyLead().conversations[0]?.messages.at(-1)).toMatchObject({
      direction: "inbound",
      senderRole: "visitor",
      body: "Еще вопрос после takeover"
    });
  });

  it("keeps repeated manager takeover from creating stale activity", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider: new FakeWidgetAiProvider({
            text: "Могу помочь с общими вариантами памятника. Какие детали важны?"
          }),
          modelName: "gpt-5.5"
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

  it("blocks a stale AI draft when manager takeover happens before AI persistence", async () => {
    const repository = new MemoryIntakeRepository();
    const provider = new FakeWidgetAiProvider({
      text: "Могу помочь с общими вариантами памятника. Какие детали важны?",
      onGenerate: async () => {
        const lead = repository.onlyLead();
        const conversation = lead.conversations[0];

        if (!conversation) {
          throw new Error("expected conversation before model reply");
        }

        await repository.takeoverConversation({
          leadId: lead.leadId,
          publicConversationId: conversation.publicConversationId,
          changedByManagerId: "manager-stale-test",
          changedByManagerEmail: "owner@yandex.ru",
          changedByManagerRole: "owner"
        });
      }
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-stale-draft-0001",
        messageText: "Расскажите про варианты памятника"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: {
        status: "fallback",
        next_step: "manager_review",
        reason: "agent_reply_blocked"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.agentAllowedToReply).toBe(false);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(repository.onlyLead().timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.manager_takeover"
      })
    );
    expect(repository.onlyLead().timeline).not.toContainEqual(
      expect.objectContaining({
        eventType: "conversation.ai_message_sent"
      })
    );
  });

  it("stops later AI replies after the visitor asks for a manager", async () => {
    const repository = new MemoryIntakeRepository();
    const provider = new FakeWidgetAiProvider({
      text: "This fake provider should not handle manager handoff."
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          provider,
          modelName: "gpt-5.5"
        }
      })
    );

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-manager-0001",
        messageText: "я хочу менеджера"
      })
    });
    const publicSessionId = first.json().public_session_id as string;

    const second = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({
        idempotencyKey: "widget-manager-0002",
        publicSessionId,
        messageText: "+7 (900) 000-00-01"
      })
    });

    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      automation: {
        status: "replied",
        reply: {
          sender_role: "ai_assistant"
        }
      }
    });
    expect(first.json().automation.reply.text).toMatch(/менеджер/i);
    expect(repository.lastAiSaveInput?.agentAllowedToReplyAfterSend).toBe(false);
    expect(repository.lastAiSaveInput?.metadata).toMatchObject({
      model_provider: "policy",
      model_name: "deterministic",
      fallback_mode: "manager_required",
      handoff_reason: "manager_requested",
      policy_version: WIDGET_AI_POLICY_VERSION,
      prompt_version: WIDGET_AI_PROMPT_VERSION
    });
    const restored = await app.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${publicSessionId}/history`
    });
    expect(restored.json()).toMatchObject({ conversation_state: "manager_pending" });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({
      automation: {
        status: "fallback",
        reason: "agent_reply_blocked"
      }
    });
    expect(repository.onlyLead().conversations[0]?.agentAllowedToReply).toBe(false);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(3);
    expect(repository.onlyLead().conversations[0]?.messages.at(-1)).toMatchObject({
      direction: "inbound",
      senderRole: "visitor"
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

function validWidgetRequest(
  overrides: { idempotencyKey?: string; messageText?: string; publicSessionId?: string } = {}
): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
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

function expectNoInternalPublicFields(value: unknown) {
  const forbidden = new Set([
    "lead_id",
    "conversation_id",
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
