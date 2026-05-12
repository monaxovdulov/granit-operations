import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("new"),
    sourceChannel: text("source_channel").notNull().default("site_form"),
    sourcePageUrl: text("source_page_url").notNull(),
    sourceFormKind: text("source_form_kind").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    contactPreferred: text("contact_preferred"),
    contactCity: text("contact_city"),
    requestText: text("request_text"),
    requestProductInterest: text("request_product_interest"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    referrerUrl: text("referrer_url"),
    utm: jsonb("utm").$type<Record<string, string | undefined> | null>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    statusIdx: index("leads_status_idx").on(table.status),
    createdAtIdx: index("leads_created_at_idx").on(table.createdAt)
  })
);

export const intakeSubmissions = pgTable(
  "intake_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicSubmissionId: uuid("public_submission_id").notNull().defaultRandom(),
    schemaVersion: text("schema_version").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    sourceChannel: text("source_channel").notNull(),
    sourcePageUrl: text("source_page_url").notNull(),
    sourceFormKind: text("source_form_kind").notNull(),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    publicSubmissionIdx: uniqueIndex("intake_submissions_public_submission_id_idx").on(
      table.publicSubmissionId
    ),
    idempotencyIdx: uniqueIndex("intake_submissions_idempotency_key_idx").on(table.idempotencyKey),
    leadIdx: index("intake_submissions_lead_id_idx").on(table.leadId)
  })
);

export const leadTimelineEvents = pgTable(
  "lead_timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    leadCreatedIdx: index("lead_timeline_events_lead_created_idx").on(table.leadId, table.createdAt)
  })
);
