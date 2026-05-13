import { desc, eq } from "drizzle-orm";

import {
  conversationMessages,
  conversations,
  intakeSubmissions,
  leadTimelineEvents,
  leads,
  widgetSessions,
  type OperationsDb
} from "@granit/db";
import type { SiteFormIntakeRequest, SiteWidgetMessageRequest } from "@granit/contracts";

import {
  IdempotencyConflictError,
  isLeadStatus,
  type ChangeManagerLeadStatusInput,
  type IntakeRepository,
  type LeadStatus,
  type ManagerConversation,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult
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

  async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    const existing = await this.findExistingWidgetMessageByIdempotencyKey(
      input.request.idempotency_key
    );

    if (existing) {
      return this.replayExistingWidgetMessage(existing, input.requestFingerprint);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const [session] = await tx
          .insert(widgetSessions)
          .values(toWidgetSessionInsert(input, now))
          .onConflictDoUpdate({
            target: widgetSessions.publicSessionId,
            set: {
              sourcePageUrl: input.request.source.page_url,
              widgetInstanceId: input.request.source.widget_instance_id,
              referrerUrl: input.request.source.referrer_url ?? null,
              pageTitle: input.request.source.page_title ?? null,
              utm: input.request.source.utm ?? null,
              visitorContext: input.request.visitor_context ?? {},
              lastSeenAt: now
            }
          })
          .returning({
            id: widgetSessions.id,
            publicSessionId: widgetSessions.publicSessionId
          });

        if (!session) {
          throw new Error("widget session insert returned no row");
        }

        let [conversation] = await tx
          .select({
            id: conversations.id,
            leadId: conversations.leadId
          })
          .from(conversations)
          .where(eq(conversations.widgetSessionId, session.id))
          .limit(1);

        if (!conversation) {
          const [lead] = await tx
            .insert(leads)
            .values(toWidgetLeadInsert(input.request, input.publicSessionId))
            .returning({ id: leads.id });

          if (!lead) {
            throw new Error("widget lead insert returned no row");
          }

          const [createdConversation] = await tx
            .insert(conversations)
            .values({
              leadId: lead.id,
              widgetSessionId: session.id,
              channel: "site_widget",
              status: "open",
              agentAllowedToReply: false,
              sourcePageUrl: input.request.source.page_url,
              widgetInstanceId: input.request.source.widget_instance_id,
              metadata: {
                contract_version: input.request.schema_version,
                automation_status: "disabled"
              },
              createdAt: now,
              updatedAt: now
            })
            .returning({
              id: conversations.id,
              leadId: conversations.leadId
            });

          if (!createdConversation) {
            throw new Error("widget conversation insert returned no row");
          }

          conversation = createdConversation;

          await tx.insert(leadTimelineEvents).values({
            leadId: lead.id,
            eventType: "lead.created_from_site_widget",
            summary: "Lead created from public website widget",
            metadata: {
              public_session_id: input.publicSessionId,
              source_page_url: input.request.source.page_url,
              widget_instance_id: input.request.source.widget_instance_id,
              automation_status: "disabled"
            },
            createdAt: now
          });
        } else {
          await tx
            .update(leads)
            .set({
              updatedAt: now
            })
            .where(eq(leads.id, conversation.leadId));

          await tx
            .update(conversations)
            .set({
              sourcePageUrl: input.request.source.page_url,
              widgetInstanceId: input.request.source.widget_instance_id,
              updatedAt: now
            })
            .where(eq(conversations.id, conversation.id));
        }

        const [message] = await tx
          .insert(conversationMessages)
          .values({
            publicMessageId: input.publicMessageId,
            conversationId: conversation.id,
            leadId: conversation.leadId,
            direction: "inbound",
            senderRole: "visitor",
            body: input.request.message.text,
            idempotencyKey: input.request.idempotency_key,
            requestFingerprint: input.requestFingerprint,
            sourcePageUrl: input.request.source.page_url,
            metadata: {
              schema_version: input.request.schema_version,
              event_type: input.request.event_type,
              public_session_id: input.publicSessionId,
              widget_instance_id: input.request.source.widget_instance_id,
              automation_status: "disabled"
            },
            submittedAt: new Date(input.request.submitted_at),
            createdAt: now
          })
          .returning({
            publicMessageId: conversationMessages.publicMessageId
          });

        if (!message) {
          throw new Error("widget message insert returned no row");
        }

        await tx.insert(leadTimelineEvents).values({
          leadId: conversation.leadId,
          eventType: "conversation.message_received",
          summary: "Website widget message received",
          metadata: {
            public_message_id: message.publicMessageId,
            public_session_id: input.publicSessionId,
            source_page_url: input.request.source.page_url,
            widget_instance_id: input.request.source.widget_instance_id,
            automation_status: "disabled"
          },
          createdAt: now
        });

        return {
          leadId: conversation.leadId,
          publicSessionId: session.publicSessionId,
          publicMessageId: message.publicMessageId,
          replayed: false
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findExistingWidgetMessageByIdempotencyKey(
          input.request.idempotency_key
        );

        if (replay) {
          return this.replayExistingWidgetMessage(replay, input.requestFingerprint);
        }
      }

      throw error;
    }
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    const rows = await this.db
      .select()
      .from(leads)
      .leftJoin(intakeSubmissions, eq(intakeSubmissions.leadId, leads.id))
      .orderBy(desc(leads.createdAt));

    return Promise.all(
      rows.map(async ({ leads: lead, intake_submissions: submission }) =>
        toManagerLeadListItem(
          lead,
          submission?.publicSubmissionId ?? (await this.findPublicWidgetReferenceForLead(lead.id))
        )
      )
    );
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    const [row] = await this.db
      .select()
      .from(leads)
      .leftJoin(intakeSubmissions, eq(intakeSubmissions.leadId, leads.id))
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
      ...toManagerLeadListItem(
        row.leads,
        row.intake_submissions?.publicSubmissionId ??
          (await this.findPublicWidgetReferenceForLead(row.leads.id))
      ),
      timeline: timelineRows.map((event) => ({
        eventType: event.eventType,
        summary: event.summary,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString()
      })),
      conversations: await this.listManagerConversations(leadId),
      internalNotePlaceholder: ""
    };
  }

  async changeManagerLeadStatus(
    input: ChangeManagerLeadStatusInput
  ): Promise<ManagerLeadDetail | null> {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: leads.id, status: leads.status })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);

      if (!existing) {
        return;
      }

      const previousStatus = toLeadStatus(existing.status);

      if (previousStatus === input.status) {
        return;
      }

      const changedAt = new Date();

      await tx
        .update(leads)
        .set({
          status: input.status,
          updatedAt: changedAt
        })
        .where(eq(leads.id, input.leadId));

      await tx.insert(leadTimelineEvents).values({
        leadId: input.leadId,
        eventType: "lead.status_changed",
        summary: `Lead status changed from ${previousStatus} to ${input.status}`,
        metadata: {
          from_status: previousStatus,
          to_status: input.status,
          changed_by_manager_id: input.changedByManagerId,
          changed_by_manager_email: input.changedByManagerEmail,
          changed_by_manager_role: input.changedByManagerRole
        },
        createdAt: changedAt
      });
    });

    return this.getManagerLead(input.leadId);
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

  private async findExistingWidgetMessageByIdempotencyKey(idempotencyKey: string) {
    const [existing] = await this.db
      .select({
        leadId: conversationMessages.leadId,
        publicSessionId: widgetSessions.publicSessionId,
        publicMessageId: conversationMessages.publicMessageId,
        requestFingerprint: conversationMessages.requestFingerprint
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .innerJoin(widgetSessions, eq(conversations.widgetSessionId, widgetSessions.id))
      .where(eq(conversationMessages.idempotencyKey, idempotencyKey))
      .limit(1);

    return existing ?? null;
  }

  private async findPublicWidgetReferenceForLead(leadId: string): Promise<string> {
    const [message] = await this.db
      .select({
        publicMessageId: conversationMessages.publicMessageId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.leadId, leadId))
      .orderBy(conversationMessages.createdAt)
      .limit(1);

    return message?.publicMessageId ?? leadId;
  }

  private async listManagerConversations(leadId: string): Promise<ManagerConversation[]> {
    const rows = await this.db
      .select({
        conversation: conversations,
        session: widgetSessions,
        message: conversationMessages
      })
      .from(conversations)
      .innerJoin(widgetSessions, eq(conversations.widgetSessionId, widgetSessions.id))
      .leftJoin(conversationMessages, eq(conversationMessages.conversationId, conversations.id))
      .where(eq(conversations.leadId, leadId))
      .orderBy(conversations.createdAt, conversationMessages.createdAt);

    const byConversation = new Map<string, ManagerConversation>();

    for (const row of rows) {
      const existing = byConversation.get(row.conversation.id);
      const conversation =
        existing ??
        ({
          channel: "site_widget",
          publicSessionId: row.session.publicSessionId,
          status: "open",
          agentAllowedToReply: row.conversation.agentAllowedToReply,
          sourcePageUrl: row.conversation.sourcePageUrl,
          widgetInstanceId: row.conversation.widgetInstanceId,
          createdAt: row.conversation.createdAt.toISOString(),
          updatedAt: row.conversation.updatedAt.toISOString(),
          messages: []
        } satisfies ManagerConversation);

      if (!existing) {
        byConversation.set(row.conversation.id, conversation);
      }

      if (row.message) {
        conversation.messages.push({
          publicMessageId: row.message.publicMessageId,
          direction: "inbound",
          senderRole: "visitor",
          body: row.message.body,
          createdAt: row.message.createdAt.toISOString()
        });
      }
    }

    return Array.from(byConversation.values());
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

  private replayExistingWidgetMessage(
    existing: {
      leadId: string;
      publicSessionId: string;
      publicMessageId: string;
      requestFingerprint: string;
    },
    requestFingerprint: string
  ): SaveAcceptedSiteWidgetMessageResult {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new IdempotencyConflictError();
    }

    return {
      leadId: existing.leadId,
      publicSessionId: existing.publicSessionId,
      publicMessageId: existing.publicMessageId,
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

function toWidgetSessionInsert(
  input: SaveAcceptedSiteWidgetMessageInput,
  now: Date
): typeof widgetSessions.$inferInsert {
  return {
    publicSessionId: input.publicSessionId,
    sourcePageUrl: input.request.source.page_url,
    widgetInstanceId: input.request.source.widget_instance_id,
    referrerUrl: input.request.source.referrer_url ?? null,
    pageTitle: input.request.source.page_title ?? null,
    utm: input.request.source.utm ?? null,
    visitorContext: input.request.visitor_context ?? {},
    createdAt: now,
    lastSeenAt: now
  };
}

function toWidgetLeadInsert(
  request: SiteWidgetMessageRequest,
  publicSessionId: string
): typeof leads.$inferInsert {
  return {
    status: "new",
    sourceChannel: request.source.channel,
    sourcePageUrl: request.source.page_url,
    sourceFormKind: "site_widget",
    contactName: request.contact?.name ?? "Site visitor",
    contactPhone: request.contact?.phone ?? null,
    contactEmail: request.contact?.email ?? null,
    contactPreferred: request.contact?.preferred_contact ?? null,
    contactCity: request.contact?.city ?? null,
    requestText: request.message.text,
    requestProductInterest: null,
    submittedAt: new Date(request.submitted_at),
    referrerUrl: request.source.referrer_url ?? null,
    utm: request.source.utm ?? null,
    metadata: {
      contract_version: request.schema_version,
      event_type: request.event_type,
      public_session_id: publicSessionId,
      widget_instance_id: request.source.widget_instance_id,
      automation_status: "disabled"
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
    status: toLeadStatus(lead.status),
    source: {
      channel: toSourceChannel(lead.sourceChannel),
      pageUrl: lead.sourcePageUrl,
      formKind: lead.sourceFormKind,
      referrerUrl: lead.referrerUrl ?? undefined,
      utm: lead.utm ?? undefined,
      widgetInstanceId: readStringMetadata(lead.metadata, "widget_instance_id")
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

function toSourceChannel(value: string): ManagerLeadListItem["source"]["channel"] {
  if (value === "site_form" || value === "site_widget") {
    return value;
  }

  throw new Error(`invalid lead source channel ${value}`);
}

function toLeadStatus(value: string): LeadStatus {
  if (!isLeadStatus(value)) {
    throw new Error(`invalid lead status ${value}`);
  }

  return value;
}

function readStringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
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
