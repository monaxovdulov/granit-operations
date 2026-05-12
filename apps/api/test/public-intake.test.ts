import { randomUUID } from "node:crypto";

import {
  PUBLIC_INTAKE_CONTRACT_VERSION,
  PUBLIC_INTAKE_EVENT_TYPE,
  type SiteFormIntakeRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import {
  IdempotencyConflictError,
  type IntakeRepository,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult
} from "../src/repositories/intake-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("public site_form intake", () => {
  it("returns public success only after persistence and exposes manager visibility", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));

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

    const managerList = await app.inject({ method: "GET", url: "/manager/leads" });
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
      url: `/manager/leads/${managerList.json().leads[0].leadId}`
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

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
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

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    return Array.from(this.leads.values()).map(({ timeline, internalNotePlaceholder, ...lead }) => lead);
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    return this.leads.get(leadId) ?? null;
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
        createdAt
      }
    ],
    internalNotePlaceholder: ""
  };
}
