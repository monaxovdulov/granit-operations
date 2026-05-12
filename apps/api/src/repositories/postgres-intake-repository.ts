import { eq, desc } from "drizzle-orm";

import {
  intakeSubmissions,
  leadTimelineEvents,
  leads,
  type OperationsDb
} from "@granit/db";
import type { SiteFormIntakeRequest } from "@granit/contracts";

import {
  IdempotencyConflictError,
  type IntakeRepository,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult
} from "./intake-repository.js";

export class PostgresIntakeRepository implements IntakeRepository {
  constructor(private readonly db: OperationsDb) {}

  async saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult> {
    const existing = await this.findExistingByIdempotencyKey(input.request.idempotency_key);

    if (existing) {
      return this.replayExisting(existing, input.requestFingerprint);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [lead] = await tx
          .insert(leads)
          .values(toLeadInsert(input.request))
          .returning({ id: leads.id });

        if (!lead) {
          throw new Error("lead insert returned no row");
        }

        const [submission] = await tx
          .insert(intakeSubmissions)
          .values({
            publicSubmissionId: input.publicSubmissionId,
            schemaVersion: input.request.schema_version,
            eventType: input.request.event_type,
            idempotencyKey: input.request.idempotency_key,
            requestFingerprint: input.requestFingerprint,
            leadId: lead.id,
            sourceChannel: input.request.source.channel,
            sourcePageUrl: input.request.source.page_url,
            sourceFormKind: input.request.source.form_kind,
            requestPayload: input.request
          })
          .returning({
            leadId: intakeSubmissions.leadId,
            publicSubmissionId: intakeSubmissions.publicSubmissionId
          });

        if (!submission) {
          throw new Error("intake submission insert returned no row");
        }

        await tx.insert(leadTimelineEvents).values({
          leadId: lead.id,
          eventType: "lead.created_from_site_form",
          summary: "Lead created from public website form",
          metadata: {
            public_submission_id: submission.publicSubmissionId,
            source_page_url: input.request.source.page_url,
            source_form_kind: input.request.source.form_kind
          }
        });

        return {
          leadId: submission.leadId,
          publicSubmissionId: submission.publicSubmissionId,
          replayed: false
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findExistingByIdempotencyKey(input.request.idempotency_key);

        if (replay) {
          return this.replayExisting(replay, input.requestFingerprint);
        }
      }

      throw error;
    }
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    const rows = await this.db
      .select()
      .from(leads)
      .innerJoin(intakeSubmissions, eq(intakeSubmissions.leadId, leads.id))
      .orderBy(desc(leads.createdAt));

    return rows.map(({ leads: lead, intake_submissions: submission }) =>
      toManagerLeadListItem(lead, submission.publicSubmissionId)
    );
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    const [row] = await this.db
      .select()
      .from(leads)
      .innerJoin(intakeSubmissions, eq(intakeSubmissions.leadId, leads.id))
      .where(eq(leads.id, leadId))
      .limit(1);

    if (!row) {
      return null;
    }

    const timelineRows = await this.db
      .select()
      .from(leadTimelineEvents)
      .where(eq(leadTimelineEvents.leadId, leadId))
      .orderBy(leadTimelineEvents.createdAt);

    return {
      ...toManagerLeadListItem(row.leads, row.intake_submissions.publicSubmissionId),
      timeline: timelineRows.map((event) => ({
        eventType: event.eventType,
        summary: event.summary,
        createdAt: event.createdAt.toISOString()
      })),
      internalNotePlaceholder: ""
    };
  }

  private async findExistingByIdempotencyKey(idempotencyKey: string) {
    const [existing] = await this.db
      .select({
        leadId: intakeSubmissions.leadId,
        publicSubmissionId: intakeSubmissions.publicSubmissionId,
        requestFingerprint: intakeSubmissions.requestFingerprint
      })
      .from(intakeSubmissions)
      .where(eq(intakeSubmissions.idempotencyKey, idempotencyKey))
      .limit(1);

    return existing ?? null;
  }

  private replayExisting(
    existing: {
      leadId: string;
      publicSubmissionId: string;
      requestFingerprint: string;
    },
    requestFingerprint: string
  ): SaveAcceptedSiteFormSubmissionResult {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new IdempotencyConflictError();
    }

    return {
      leadId: existing.leadId,
      publicSubmissionId: existing.publicSubmissionId,
      replayed: true
    };
  }
}

function toLeadInsert(request: SiteFormIntakeRequest): typeof leads.$inferInsert {
  return {
    status: "new",
    sourceChannel: request.source.channel,
    sourcePageUrl: request.source.page_url,
    sourceFormKind: request.source.form_kind,
    contactName: request.contact.name,
    contactPhone: request.contact.phone ?? null,
    contactEmail: request.contact.email ?? null,
    contactPreferred: request.contact.preferred_contact ?? null,
    contactCity: request.contact.city ?? null,
    requestText: request.request?.message ?? null,
    requestProductInterest: request.request?.product_interest ?? null,
    submittedAt: new Date(request.submitted_at),
    referrerUrl: request.source.referrer_url ?? null,
    utm: request.source.utm ?? null,
    metadata: {
      contract_version: request.schema_version,
      event_type: request.event_type
    }
  };
}

function toManagerLeadListItem(
  lead: typeof leads.$inferSelect,
  publicSubmissionId: string
): ManagerLeadListItem {
  return {
    leadId: lead.id,
    publicSubmissionId,
    status: "new",
    source: {
      channel: "site_form",
      pageUrl: lead.sourcePageUrl,
      formKind: lead.sourceFormKind,
      referrerUrl: lead.referrerUrl ?? undefined,
      utm: lead.utm ?? undefined
    },
    contact: {
      name: lead.contactName,
      phone: lead.contactPhone ?? undefined,
      email: lead.contactEmail ?? undefined,
      preferredContact: normalizePreferredContact(lead.contactPreferred),
      city: lead.contactCity ?? undefined
    },
    request: {
      text: lead.requestText ?? undefined,
      productInterest: lead.requestProductInterest ?? undefined
    },
    submittedAt: lead.submittedAt.toISOString(),
    createdAt: lead.createdAt.toISOString()
  };
}

function normalizePreferredContact(value: string | null) {
  if (value === "phone" || value === "whatsapp" || value === "telegram" || value === "email") {
    return value;
  }

  return undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
