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
  IdempotencyConflictError,
  type ChangeManagerLeadStatusInput,
  type IntakeRepository,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult
} from "../src/repositories/intake-repository.js";

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

function validWidgetRequest(): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: "widget-key-0000001",
    submitted_at: "2026-05-13T10:00:00.000Z",
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
      text: "Can you help me choose a monument?"
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
  private readonly sessionLeads = new Map<string, string>();

  constructor(private readonly options: { failPersistence?: boolean } = {}) {}

  get leadCount() {
    return this.leads.size;
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

      return {
        leadId: existing.leadId,
        publicSessionId: existing.publicSessionId,
        publicMessageId: existing.publicMessageId,
        replayed: true
      };
    }

    const now = new Date().toISOString();
    const publicSessionId = input.publicSessionId;
    let leadId = this.sessionLeads.get(publicSessionId);
    let lead = leadId ? this.leads.get(leadId) : undefined;

    if (!leadId || !lead) {
      leadId = randomUUID();
      lead = toManagerWidgetLead(input, leadId, now);
      this.leads.set(leadId, lead);
      this.sessionLeads.set(publicSessionId, leadId);
    } else {
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
      publicSessionId,
      publicMessageId: input.publicMessageId,
      replayed: false
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
          automation_status: "disabled"
        },
        createdAt
      },
      {
        eventType: "conversation.message_received",
        summary: "Website widget message received",
        metadata: {
          public_message_id: input.publicMessageId,
          public_session_id: input.publicSessionId,
          automation_status: "disabled"
        },
        createdAt
      }
    ],
    conversations: [
      {
        channel: "site_widget",
        publicSessionId: input.publicSessionId,
        status: "open",
        agentAllowedToReply: false,
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
