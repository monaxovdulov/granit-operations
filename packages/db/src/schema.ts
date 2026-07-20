import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
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
    sourcePageUrl: text("source_page_url"),
    sourceFormKind: text("source_form_kind"),
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
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    nextStepSummary: text("next_step_summary"),
    nextStepChannel: text("next_step_channel"),
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

export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id"),
    externalChatId: text("external_chat_id"),
    externalUserId: text("external_user_id"),
    widgetSessionId: uuid("widget_session_id").references(() => widgetSessions.id, {
      onDelete: "set null"
    }),
    displayName: text("display_name"),
    username: text("username"),
    normalizedPhone: text("normalized_phone"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    leadIdx: index("channel_identities_lead_id_idx").on(table.leadId, table.updatedAt),
    channelLastSeenIdx: index("channel_identities_channel_last_seen_idx").on(
      table.channel,
      table.lastSeenAt
    ),
    widgetSessionIdx: uniqueIndex("channel_identities_widget_session_id_idx").on(
      table.widgetSessionId
    ).where(sql`${table.widgetSessionId} IS NOT NULL`),
    telegramChatIdx: uniqueIndex("channel_identities_telegram_chat_idx").on(
      table.provider,
      table.providerAccountId,
      table.externalChatId
    ).where(
      sql`${table.channel} = 'telegram' AND ${table.providerAccountId} IS NOT NULL AND ${table.externalChatId} IS NOT NULL`
    )
  })
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicConversationId: uuid("public_conversation_id").notNull().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    widgetSessionId: uuid("widget_session_id").references(() => widgetSessions.id, {
      onDelete: "set null"
    }),
    channelIdentityId: uuid("channel_identity_id").references(() => channelIdentities.id, {
      onDelete: "set null"
    }),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("open"),
    aiState: text("ai_state").notNull().default("ai_collecting_info"),
    agentAllowedToReply: boolean("agent_allowed_to_reply").notNull().default(false),
    sourcePageUrl: text("source_page_url"),
    widgetInstanceId: text("widget_instance_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    publicConversationIdx: uniqueIndex("conversations_public_conversation_id_idx").on(
      table.publicConversationId
    ),
    leadIdx: index("conversations_lead_id_idx").on(table.leadId),
    widgetSessionIdx: index("conversations_widget_session_id_idx").on(table.widgetSessionId),
    channelIdentityIdx: index("conversations_channel_identity_id_idx").on(
      table.channelIdentityId
    ),
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
    channelIdentityId: uuid("channel_identity_id").references(() => channelIdentities.id, {
      onDelete: "set null"
    }),
    providerMessageId: text("provider_message_id"),
    providerUpdateId: text("provider_update_id"),
    providerSentAt: timestamp("provider_sent_at", { withTimezone: true }),
    sourcePageUrl: text("source_page_url"),
    contentType: text("content_type").notNull().default("text"),
    providerFileId: text("provider_file_id"),
    providerFileUniqueId: text("provider_file_unique_id"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    durationSeconds: integer("duration_seconds"),
    caption: text("caption"),
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
    providerMessageIdx: uniqueIndex("conversation_messages_provider_message_idx").on(
      table.channelIdentityId,
      table.providerMessageId
    ).where(sql`${table.providerMessageId} IS NOT NULL`),
    providerUpdateIdx: uniqueIndex("conversation_messages_provider_update_idx").on(
      table.channelIdentityId,
      table.providerUpdateId
    ).where(sql`${table.providerUpdateId} IS NOT NULL`),
    conversationCreatedIdx: index("conversation_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    leadCreatedIdx: index("conversation_messages_lead_created_idx").on(table.leadId, table.createdAt)
  })
);

export const conversationSlots = pgTable(
  "conversation_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
    sourcePublicMessageId: uuid("source_public_message_id"),
    evidenceQuote: text("evidence_quote"),
    evidenceStart: integer("evidence_start"),
    evidenceEnd: integer("evidence_end"),
    confidencePermille: integer("confidence_permille").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    conversationNameIdx: uniqueIndex("conversation_slots_conversation_name_idx").on(
      table.conversationId,
      table.name
    ),
    leadUpdatedIdx: index("conversation_slots_lead_updated_idx").on(
      table.leadId,
      table.updatedAt
    )
  })
);

export const conversationSlotEvents = pgTable(
  "conversation_slot_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
    sourcePublicMessageId: uuid("source_public_message_id"),
    evidenceQuote: text("evidence_quote"),
    evidenceStart: integer("evidence_start"),
    evidenceEnd: integer("evidence_end"),
    confidencePermille: integer("confidence_permille").notNull(),
    previousValue: text("previous_value"),
    applied: boolean("applied").notNull(),
    conflict: boolean("conflict").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    conversationCreatedIdx: index("conversation_slot_events_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    leadCreatedIdx: index("conversation_slot_events_lead_created_idx").on(
      table.leadId,
      table.createdAt
    )
  })
);

export const conversationRequirements = pgTable(
  "conversation_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    mode: text("mode").notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
    sourcePublicMessageId: uuid("source_public_message_id").notNull(),
    evidenceQuote: text("evidence_quote").notNull(),
    evidenceStart: integer("evidence_start").notNull(),
    evidenceEnd: integer("evidence_end").notNull(),
    confidencePermille: integer("confidence_permille").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    identityIdx: uniqueIndex("conversation_requirements_identity_idx").on(
      table.conversationId,
      table.category,
      table.mode,
      table.value
    ),
    leadUpdatedIdx: index("conversation_requirements_lead_updated_idx").on(
      table.leadId,
      table.updatedAt
    )
  })
);

export const conversationAiMemory = pgTable("conversation_ai_memory", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  coveredThroughPublicMessageId: uuid("covered_through_public_message_id").notNull(),
  coveredThroughCreatedAt: timestamp("covered_through_created_at", {
    withTimezone: true
  }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const aiShadowComparisons = pgTable(
  "ai_shadow_comparisons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicConversationId: uuid("public_conversation_id")
      .notNull()
      .references(() => conversations.publicConversationId, { onDelete: "cascade" }),
    inboundPublicMessageId: uuid("inbound_public_message_id").notNull(),
    version: text("version").notNull(),
    inputFingerprint: text("input_fingerprint"),
    legacyResult: jsonb("legacy_result").$type<Record<string, unknown>>().notNull(),
    groundedResult: jsonb("grounded_result").$type<Record<string, unknown> | null>(),
    groundedErrorCode: text("grounded_error_code"),
    legacyLatencyMs: integer("legacy_latency_ms").notNull(),
    groundedLatencyMs: integer("grounded_latency_ms").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    inboundIdx: uniqueIndex("ai_shadow_comparisons_inbound_idx").on(
      table.inboundPublicMessageId
    ),
    conversationCreatedIdx: index("ai_shadow_comparisons_conversation_created_idx").on(
      table.publicConversationId,
      table.createdAt
    )
  })
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    inboundPublicMessageId: uuid("inbound_public_message_id").notNull(),
    outboundPublicMessageId: uuid("outbound_public_message_id"),
    status: text("status").notNull(),
    action: text("action"),
    intent: text("intent"),
    inputFingerprint: text("input_fingerprint").notNull(),
    promptVersion: text("prompt_version"),
    policyVersion: text("policy_version"),
    knowledgeVersion: text("knowledge_version"),
    modelName: text("model_name"),
    generatorModelName: text("generator_model_name"),
    verifierModelName: text("verifier_model_name"),
    verifierVersion: text("verifier_version"),
    verifierVerdict: text("verifier_verdict"),
    catalogVersion: text("catalog_version"),
    catalogContentHash: text("catalog_content_hash"),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    inboundIdx: uniqueIndex("ai_runs_inbound_public_message_id_idx").on(
      table.inboundPublicMessageId
    ),
    conversationCreatedIdx: index("ai_runs_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    )
  })
);

export const aiEvalCases = pgTable(
  "ai_eval_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseKey: text("case_key").notNull(),
    version: text("version").notNull(),
    category: text("category").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    expectations: jsonb("expectations").$type<Record<string, unknown>>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    keyVersionIdx: uniqueIndex("ai_eval_cases_key_version_idx").on(table.caseKey, table.version)
  })
);

export const aiEvalRuns = pgTable(
  "ai_eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corpusVersion: text("corpus_version").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    generatorModelName: text("generator_model_name"),
    verifierModelName: text("verifier_model_name"),
    catalogVersion: text("catalog_version"),
    totalCases: integer("total_cases").notNull().default(0),
    passedCases: integer("passed_cases").notNull().default(0),
    failedCases: integer("failed_cases").notNull().default(0),
    report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    startedIdx: index("ai_eval_runs_started_idx").on(table.startedAt)
  })
);

export const conversationHandoffs = pgTable(
  "conversation_handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    inboundPublicMessageId: uuid("inbound_public_message_id").notNull(),
    outboundPublicMessageId: uuid("outbound_public_message_id").notNull(),
    reason: text("reason").notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull().default("active"),
    slotsSnapshot: jsonb("slots_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (table) => ({
    inboundIdx: uniqueIndex("conversation_handoffs_inbound_public_message_id_idx").on(
      table.inboundPublicMessageId
    ),
    conversationStatusIdx: index("conversation_handoffs_conversation_status_idx").on(
      table.conversationId,
      table.status
    )
  })
);

export const messageDeliveries = pgTable(
  "message_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationMessageId: uuid("conversation_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    messageIdx: index("message_deliveries_message_id_idx").on(table.conversationMessageId),
    statusIdx: index("message_deliveries_status_idx").on(table.status, table.updatedAt)
  })
);

export const managerNotificationOutbox = pgTable(
  "manager_notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    conversationMessageId: uuid("conversation_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    destinationKind: text("destination_kind").notNull(),
    destinationIdentityId: uuid("destination_identity_id").references(() => channelIdentities.id, {
      onDelete: "set null"
    }),
    managerTelegramBindingId: uuid("manager_telegram_binding_id").references(
      () => managerTelegramBindings.id,
      { onDelete: "set null" }
    ),
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    leadIdx: index("manager_notification_outbox_lead_id_idx").on(table.leadId, table.createdAt),
    statusIdx: index("manager_notification_outbox_status_idx").on(table.status, table.updatedAt),
    messageIdx: index("manager_notification_outbox_message_id_idx").on(
      table.conversationMessageId
    ),
    managerTelegramBindingIdx: index("manager_notification_outbox_manager_tg_binding_idx").on(
      table.managerTelegramBindingId,
      table.createdAt
    )
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

export const aiRuntimeControls = pgTable("ai_runtime_controls", {
  scope: text("scope").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(1),
  changedByManagerId: uuid("changed_by_manager_id").references(() => managerUsers.id, {
    onDelete: "set null"
  }),
  changedByManagerEmail: text("changed_by_manager_email"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
});

export const aiReviewLabels = pgTable(
  "ai_review_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => managerUsers.id, {
      onDelete: "set null"
    }),
    label: text("label").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runCreatedIdx: index("ai_review_labels_run_created_idx").on(table.aiRunId, table.createdAt),
    leadCreatedIdx: index("ai_review_labels_lead_created_idx").on(table.leadId, table.createdAt)
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

export const managerTelegramBindings = pgTable(
  "manager_telegram_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("telegram_bot"),
    providerAccountId: text("provider_account_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    externalUserId: text("external_user_id"),
    username: text("username"),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => ({
    managerIdx: index("manager_telegram_bindings_manager_idx").on(
      table.managerUserId,
      table.status
    ),
    chatIdx: index("manager_telegram_bindings_chat_idx").on(
      table.provider,
      table.providerAccountId,
      table.externalChatId,
      table.status
    ),
    managerProviderIdx: uniqueIndex("manager_telegram_bindings_manager_provider_idx").on(
      table.managerUserId,
      table.provider,
      table.providerAccountId
    ).where(sql`${table.status} = 'active'`),
    chatUniqueIdx: uniqueIndex("manager_telegram_bindings_chat_unique_idx").on(
      table.provider,
      table.providerAccountId,
      table.externalChatId
    ).where(sql`${table.status} = 'active'`)
  })
);

export const managerTelegramBindTokens = pgTable(
  "manager_telegram_bind_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("manager_telegram_bind_tokens_hash_idx").on(table.tokenHash),
    managerIdx: index("manager_telegram_bind_tokens_manager_idx").on(
      table.managerUserId,
      table.createdAt
    ),
    expiresAtIdx: index("manager_telegram_bind_tokens_expires_idx").on(table.expiresAt)
  })
);

export const managerTelegramReplyContexts = pgTable(
  "manager_telegram_reply_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "cascade" }),
    managerTelegramBindingId: uuid("manager_telegram_binding_id")
      .notNull()
      .references(() => managerTelegramBindings.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    publicConversationId: uuid("public_conversation_id").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    managerStatusIdx: index("manager_telegram_reply_contexts_manager_status_idx").on(
      table.managerUserId,
      table.status,
      table.expiresAt
    ),
    conversationIdx: index("manager_telegram_reply_contexts_conversation_idx").on(
      table.conversationId,
      table.status
    ),
    onePendingIdx: uniqueIndex("manager_telegram_reply_contexts_one_pending_idx").on(
      table.managerUserId
    ).where(sql`${table.status} = 'pending'`)
  })
);
