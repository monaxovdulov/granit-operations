import { randomUUID } from "node:crypto";

import {
  PUBLIC_INTAKE_CONTRACT_VERSION,
  PUBLIC_INTAKE_EVENT_TYPE,
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteFormIntakeRequest,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER_SESSION_COOKIE,
  hashSessionToken
} from "../src/auth/session.js";
import { buildApi } from "../src/app.js";
import type {
  AuthenticatedManager,
  CompleteYandexLoginResult,
  CreateManagerSessionInput,
  ManagerAuthRepository,
  YandexManagerProfile
} from "../src/repositories/manager-auth-repository.js";
import {
  AgentReplyBlockedError,
  IdempotencyConflictError,
  type ChangeManagerLeadStatusInput,
  type IntakeRepository,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult,
  type SaveSiteWidgetAiMessageInput,
  type SaveSiteWidgetAiMessageResult,
  type TakeoverSiteWidgetConversationInput
} from "../src/repositories/intake-repository.js";
import type {
  WidgetAiProvider,
  WidgetAiProviderInput,
  WidgetAiProviderResult
} from "../src/services/widget-ai-service.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

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
    expect(response.json().public_session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.json().public_message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.json().lead_id).toBeUndefined();
    expect(response.json().conversation_id).toBeUndefined();
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
          publicSessionId: response.json().public_session_id,
          agentAllowedToReply: false,
          widgetInstanceId: "floating-widget-v1",
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
        status: "fallback",
        next_step: "manager_review",
        reason: "ai_persistence_unconfirmed"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
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
        status: "fallback",
        next_step: "manager_review",
        reason: "model_error"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
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
        status: "fallback",
        next_step: "manager_review",
        reason: "unsafe_model_response"
      }
    });
    expect(response.json().automation.reply).toBeUndefined();
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("keeps safe wording for price, deadline, warranty, contract, discount, availability, payment and legal prompts", async () => {
    const unsafePrompts = [
      "Сколько точно будет стоить памятник?",
      "Сделаете завтра и в какой точный срок?",
      "Какая гарантия?",
      "Какие условия договора?",
      "Дадите скидку?",
      "Есть ли модель в наличии?",
      "Можно оплатить в рассрочку?",
      "Как оформить наследство и документы на захоронение?"
    ];

    for (const [index, text] of unsafePrompts.entries()) {
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
          idempotencyKey: `widget-safe-ai-${String(index).padStart(4, "0")}`,
          messageText: text
        })
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().automation.status).toBe("replied");
      const replyText = response.json().automation.reply.text as string;
      expect(replyText).not.toMatch(/\d[\d\s]*(?:₽|руб|р\.)/i);
      expect(replyText).not.toMatch(/(?:за|через)\s+\d+\s*(?:дн|час|нед|месяц)/i);
      expect(replyText).not.toMatch(/гарантируем|скидк[ауи]\s*\d|в наличии|рассрочк[ау]/i);
      expect(replyText).toMatch(/менеджер|подтвердит|сохранено|передам/i);
    }
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

    const takeover = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${leadId}/conversations/${publicSessionId}/takeover`,
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
      publicSessionId,
      agentAllowedToReply: false
    });
    expect(takeover.json().lead.timeline).toContainEqual(
      expect.objectContaining({
        eventType: "conversation.manager_takeover",
        metadata: expect.objectContaining({
          public_session_id: publicSessionId,
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

        await repository.takeoverSiteWidgetConversation({
          leadId: lead.leadId,
          publicSessionId: conversation.publicSessionId,
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

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function testManagerAuthConfig() {
  return {
    yandexClientId: "test-client-id",
    yandexClientSecret: "test-client-secret",
    yandexRedirectUri: "https://manager.example/auth/yandex/callback",
    sessionSecret: "test-session-secret-for-manager-auth",
    cookieSecure: false
  };
}

class MemoryIntakeRepository implements IntakeRepository {
  saveCalls = 0;
  aiSaveCalls = 0;
  private readonly leads = new Map<string, ManagerLeadDetail>();
  private readonly idempotency = new Map<
    string,
    {
      leadId: string;
      publicSubmissionId: string;
      requestFingerprint: string;
    }
  >();
  private readonly widgetIdempotency = new Map<
    string,
    {
      leadId: string;
      publicSessionId: string;
      publicMessageId: string;
      requestFingerprint: string;
    }
  >();
  private readonly widgetAiIdempotency = new Map<
    string,
    {
      publicMessageId: string;
      body: string;
      createdAt: string;
      requestFingerprint: string;
    }
  >();
  private readonly sessionLeads = new Map<string, string>();
  private readonly sessionConversations = new Map<string, string>();
  private readonly conversationLeads = new Map<string, string>();
  private readonly conversationSessions = new Map<string, string>();

  constructor(
    private readonly options: { failPersistence?: boolean; failAiPersistence?: boolean } = {}
  ) {}

  get leadCount() {
    return this.leads.size;
  }

  onlyLead() {
    const [lead] = Array.from(this.leads.values());

    if (!lead) {
      throw new Error("expected one memory lead");
    }

    return lead;
  }

  async saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult> {
    this.saveCalls += 1;

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.idempotency.get(input.request.idempotency_key);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        leadId: existing.leadId,
        publicSubmissionId: existing.publicSubmissionId,
        replayed: true
      };
    }

    const leadId = randomUUID();
    const now = new Date().toISOString();
    const lead = toManagerLead(input, leadId, now);
    this.leads.set(leadId, lead);
    this.idempotency.set(input.request.idempotency_key, {
      leadId,
      publicSubmissionId: input.publicSubmissionId,
      requestFingerprint: input.requestFingerprint
    });

    return {
      leadId,
      publicSubmissionId: input.publicSubmissionId,
      replayed: false
    };
  }

  async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    this.saveCalls += 1;

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.widgetIdempotency.get(input.request.idempotency_key);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      const aiReply = this.widgetAiIdempotency.get(`ai:${existing.publicMessageId}`);

      return {
        leadId: existing.leadId,
        conversationId: this.sessionConversations.get(existing.publicSessionId) ?? randomUUID(),
        publicSessionId: existing.publicSessionId,
        publicMessageId: existing.publicMessageId,
        agentAllowedToReply:
          this.leads
            .get(existing.leadId)
            ?.conversations.find(
              (conversation) => conversation.publicSessionId === existing.publicSessionId
            )?.agentAllowedToReply ?? false,
        replayed: true,
        aiReply: aiReply
          ? {
              publicMessageId: aiReply.publicMessageId,
              body: aiReply.body,
              createdAt: aiReply.createdAt
            }
          : undefined
      };
    }

    const now = new Date().toISOString();
    const publicSessionId = input.publicSessionId;
    let leadId = this.sessionLeads.get(publicSessionId);
    let conversationId = this.sessionConversations.get(publicSessionId);
    let lead = leadId ? this.leads.get(leadId) : undefined;

    if (!leadId || !lead) {
      leadId = randomUUID();
      conversationId = randomUUID();
      lead = toManagerWidgetLead(input, leadId, conversationId, now);
      this.leads.set(leadId, lead);
      this.sessionLeads.set(publicSessionId, leadId);
      this.sessionConversations.set(publicSessionId, conversationId);
      this.conversationLeads.set(conversationId, leadId);
      this.conversationSessions.set(conversationId, publicSessionId);
    } else {
      if (!conversationId) {
        conversationId = randomUUID();
        this.sessionConversations.set(publicSessionId, conversationId);
        this.conversationLeads.set(conversationId, leadId);
        this.conversationSessions.set(conversationId, publicSessionId);
      }

      lead = {
        ...lead,
        timeline: [
          ...lead.timeline,
          {
            eventType: "conversation.message_received",
            summary: "Website widget message received",
            metadata: {
              public_message_id: input.publicMessageId,
              public_session_id: publicSessionId,
              automation_status: "disabled"
            },
            createdAt: now
          }
        ],
        conversations: lead.conversations.map((conversation) =>
          conversation.publicSessionId === publicSessionId
            ? {
                ...conversation,
                agentAllowedToReply: input.agentAllowedToReply && conversation.agentAllowedToReply,
                updatedAt: now,
                messages: [
                  ...conversation.messages,
                  {
                    publicMessageId: input.publicMessageId,
                    direction: "inbound",
                    senderRole: "visitor",
                    body: input.request.message.text,
                    createdAt: now
                  }
                ]
              }
            : conversation
        )
      };
      this.leads.set(leadId, lead);
    }

    this.widgetIdempotency.set(input.request.idempotency_key, {
      leadId,
      publicSessionId,
      publicMessageId: input.publicMessageId,
      requestFingerprint: input.requestFingerprint
    });

    return {
      leadId,
      conversationId,
      publicSessionId,
      publicMessageId: input.publicMessageId,
      agentAllowedToReply:
        this.leads
          .get(leadId)
          ?.conversations.find((conversation) => conversation.publicSessionId === publicSessionId)
          ?.agentAllowedToReply ?? false,
      replayed: false
    };
  }

  async saveSiteWidgetAiMessage(
    input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    this.aiSaveCalls += 1;

    if (this.options.failAiPersistence) {
      throw new Error("ai persistence unavailable");
    }

    const existing = this.widgetAiIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        publicMessageId: existing.publicMessageId,
        body: existing.body,
        createdAt: existing.createdAt
      };
    }

    const leadId = this.conversationLeads.get(input.conversationId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);
    const lead = leadId ? this.leads.get(leadId) : undefined;

    if (!lead || !publicSessionId || leadId !== input.leadId) {
      throw new Error("memory conversation not found");
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicSessionId === publicSessionId
    );

    if (!conversation?.agentAllowedToReply) {
      throw new AgentReplyBlockedError();
    }

    const createdAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_message_sent",
          summary: "Website widget AI reply persisted",
          metadata: {
            ...input.metadata,
            public_message_id: input.publicMessageId,
            inbound_public_message_id: input.inboundPublicMessageId
          },
          createdAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicSessionId === publicSessionId
          ? {
              ...candidate,
              agentAllowedToReply:
                input.agentAllowedToReplyAfterSend ?? candidate.agentAllowedToReply,
              updatedAt: createdAt,
              messages: [
                ...candidate.messages,
                {
                  publicMessageId: input.publicMessageId,
                  direction: "outbound",
                  senderRole: "ai_assistant",
                  body: input.body,
                  createdAt
                }
              ]
            }
          : candidate
      )
    };

    this.leads.set(lead.leadId, updatedLead);
    this.widgetAiIdempotency.set(input.idempotencyKey, {
      publicMessageId: input.publicMessageId,
      body: input.body,
      createdAt,
      requestFingerprint: input.requestFingerprint
    });

    return {
      publicMessageId: input.publicMessageId,
      body: input.body,
      createdAt
    };
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    return Array.from(this.leads.values()).map(
      ({ timeline, conversations, internalNotePlaceholder, ...lead }) => lead
    );
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    return this.leads.get(leadId) ?? null;
  }

  async changeManagerLeadStatus(
    input: ChangeManagerLeadStatusInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    if (lead.status === input.status) {
      return lead;
    }

    const updatedLead: ManagerLeadDetail = {
      ...lead,
      status: input.status,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.status_changed",
          summary: `Lead status changed from ${lead.status} to ${input.status}`,
          metadata: {
            from_status: lead.status,
            to_status: input.status,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: new Date().toISOString()
        }
      ]
    };
    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async takeoverSiteWidgetConversation(
    input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicSessionId === input.publicSessionId
    );

    if (!conversation) {
      return null;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.manager_takeover",
          summary: "Manager takeover disabled AI replies",
          metadata: {
            public_session_id: input.publicSessionId,
            previous_agent_allowed_to_reply: conversation.agentAllowedToReply,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicSessionId === input.publicSessionId
          ? {
              ...candidate,
              agentAllowedToReply: false,
              updatedAt: changedAt
            }
          : candidate
      )
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }
}

function toManagerLead(
  input: SaveAcceptedSiteFormSubmissionInput,
  leadId: string,
  createdAt: string
): ManagerLeadDetail {
  return {
    leadId,
    publicSubmissionId: input.publicSubmissionId,
    status: "new",
    source: {
      channel: "site_form",
      pageUrl: input.request.source.page_url,
      formKind: input.request.source.form_kind,
      referrerUrl: input.request.source.referrer_url,
      utm: input.request.source.utm
    },
    contact: {
      name: input.request.contact.name,
      phone: input.request.contact.phone,
      email: input.request.contact.email,
      preferredContact: input.request.contact.preferred_contact,
      city: input.request.contact.city
    },
    request: {
      text: input.request.request?.message,
      productInterest: input.request.request?.product_interest
    },
    submittedAt: input.request.submitted_at,
    createdAt,
    timeline: [
      {
        eventType: "lead.created_from_site_form",
        summary: "Lead created from public website form",
        metadata: {},
        createdAt
      }
    ],
    conversations: [],
    internalNotePlaceholder: ""
  };
}

function toManagerWidgetLead(
  input: SaveAcceptedSiteWidgetMessageInput,
  leadId: string,
  _conversationId: string,
  createdAt: string
): ManagerLeadDetail {
  return {
    leadId,
    publicSubmissionId: input.publicMessageId,
    status: "new",
    source: {
      channel: "site_widget",
      pageUrl: input.request.source.page_url,
      formKind: "site_widget",
      referrerUrl: input.request.source.referrer_url,
      utm: input.request.source.utm,
      widgetInstanceId: input.request.source.widget_instance_id
    },
    contact: {
      name: input.request.contact?.name ?? "Site visitor",
      phone: input.request.contact?.phone,
      email: input.request.contact?.email,
      preferredContact: input.request.contact?.preferred_contact,
      city: input.request.contact?.city
    },
    request: {
      text: input.request.message.text
    },
    submittedAt: input.request.submitted_at,
    createdAt,
    timeline: [
      {
        eventType: "lead.created_from_site_widget",
        summary: "Lead created from public website widget",
        metadata: {
          public_session_id: input.publicSessionId,
          automation_status: input.agentAllowedToReply ? "enabled" : "disabled"
        },
        createdAt
      },
      {
        eventType: "conversation.message_received",
        summary: "Website widget message received",
        metadata: {
          public_message_id: input.publicMessageId,
          public_session_id: input.publicSessionId,
          automation_status: input.agentAllowedToReply ? "enabled" : "disabled"
        },
        createdAt
      }
    ],
    conversations: [
      {
        channel: "site_widget",
        publicSessionId: input.publicSessionId,
        status: "open",
        agentAllowedToReply: input.agentAllowedToReply,
        sourcePageUrl: input.request.source.page_url,
        widgetInstanceId: input.request.source.widget_instance_id,
        createdAt,
        updatedAt: createdAt,
        messages: [
          {
            publicMessageId: input.publicMessageId,
            direction: "inbound",
            senderRole: "visitor",
            body: input.request.message.text,
            createdAt
          }
        ]
      }
    ],
    internalNotePlaceholder: ""
  };
}

function expectNoInternalPublicFields(value: unknown) {
  const forbidden = new Set(["lead_id", "conversation_id", "trace_id"]);

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

class FakeWidgetAiProvider implements WidgetAiProvider {
  constructor(
    private readonly options: {
      text?: string;
      fail?: boolean;
      onGenerate?: (input: WidgetAiProviderInput) => void | Promise<void>;
    }
  ) {}

  async generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult> {
    await this.options.onGenerate?.(input);

    if (this.options.fail) {
      throw new Error("fake model failure");
    }

    return {
      text: this.options.text ?? "Могу помочь собрать детали заявки.",
      modelProvider: "fake",
      modelName: "fake-widget-ai",
      responseId: "resp_fake",
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18
      }
    };
  }
}

class MemoryManagerAuthRepository implements ManagerAuthRepository {
  private readonly user: AuthenticatedManager;
  private readonly sessions = new Map<string, { user: AuthenticatedManager; expiresAt: Date }>();

  constructor(role: AuthenticatedManager["role"] = "owner") {
    this.user = {
      id: randomUUID(),
      email: "owner@yandex.ru",
      yandexUid: "yandex-owner-1",
      role,
      status: "active",
      lastLoginAt: new Date().toISOString()
    };
  }

  createSessionCookie() {
    const token = `test-manager-session-${randomUUID()}`;
    this.sessions.set(hashSessionToken(token), {
      user: this.user,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    return `${MANAGER_SESSION_COOKIE}=${token}`;
  }

  async completeYandexLogin(_profile: YandexManagerProfile): Promise<CompleteYandexLoginResult> {
    return { ok: true, user: this.user };
  }

  async createManagerSession(input: CreateManagerSessionInput): Promise<void> {
    this.sessions.set(input.sessionTokenHash, {
      user: this.user,
      expiresAt: input.expiresAt
    });
  }

  async findManagerSession(
    sessionTokenHash: string,
    now: Date
  ): Promise<AuthenticatedManager | null> {
    const session = this.sessions.get(sessionTokenHash);

    if (!session || session.expiresAt <= now) {
      return null;
    }

    return session.user;
  }

  async revokeManagerSession(sessionTokenHash: string): Promise<void> {
    this.sessions.delete(sessionTokenHash);
  }
}
