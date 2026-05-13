import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

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

export const widgetSessions = pgTable(
  "widget_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicSessionId: uuid("public_session_id").notNull().defaultRandom(),
    sourcePageUrl: text("source_page_url").notNull(),
    widgetInstanceId: text("widget_instance_id").notNull(),
    referrerUrl: text("referrer_url"),
    pageTitle: text("page_title"),
    utm: jsonb("utm").$type<Record<string, string | undefined> | null>(),
    visitorContext: jsonb("visitor_context").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    publicSessionIdx: uniqueIndex("widget_sessions_public_session_id_idx").on(
      table.publicSessionId
    ),
    lastSeenIdx: index("widget_sessions_last_seen_idx").on(table.lastSeenAt)
  })
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    widgetSessionId: uuid("widget_session_id")
      .notNull()
      .references(() => widgetSessions.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("open"),
    agentAllowedToReply: boolean("agent_allowed_to_reply").notNull().default(false),
    sourcePageUrl: text("source_page_url").notNull(),
    widgetInstanceId: text("widget_instance_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    leadIdx: index("conversations_lead_id_idx").on(table.leadId),
    widgetSessionIdx: index("conversations_widget_session_id_idx").on(table.widgetSessionId),
    channelUpdatedIdx: index("conversations_channel_updated_idx").on(table.channel, table.updatedAt)
  })
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicMessageId: uuid("public_message_id").notNull().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourcePageUrl: text("source_page_url").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    publicMessageIdx: uniqueIndex("conversation_messages_public_message_id_idx").on(
      table.publicMessageId
    ),
    idempotencyIdx: uniqueIndex("conversation_messages_idempotency_key_idx").on(
      table.idempotencyKey
    ),
    conversationCreatedIdx: index("conversation_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    leadCreatedIdx: index("conversation_messages_lead_created_idx").on(table.leadId, table.createdAt)
  })
);

export const managerUsers = pgTable(
  "manager_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    yandexUid: text("yandex_uid"),
    role: text("role").notNull(),
    status: text("status").notNull().default("invited"),
    invitedBy: uuid("invited_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
  },
  (table) => ({
    emailCiIdx: uniqueIndex("manager_users_email_ci_idx").on(sql`lower(${table.email})`),
    yandexUidIdx: uniqueIndex("manager_users_yandex_uid_idx").on(table.yandexUid),
    roleStatusIdx: index("manager_users_role_status_idx").on(table.role, table.status)
  })
);

export const managerSessions = pgTable(
  "manager_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionTokenHash: text("session_token_hash").notNull(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("manager_sessions_token_hash_idx").on(table.sessionTokenHash),
    userIdx: index("manager_sessions_user_idx").on(table.managerUserId),
    expiresAtIdx: index("manager_sessions_expires_at_idx").on(table.expiresAt)
  })
);
