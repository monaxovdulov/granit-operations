import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

export const aiRuntimeControls = pgTable(
  "ai_runtime_controls",
  {
    scope: text("scope").primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    changedByManagerId: uuid("changed_by_manager_id").references(() => managerUsers.id, {
      onDelete: "set null"
    }),
    changedByManagerEmail: text("changed_by_manager_email"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    scopeCheck: check("ai_runtime_controls_scope_check", sql`${table.scope} IN ('site_widget')`),
    versionCheck: check("ai_runtime_controls_version_check", sql`${table.version} > 0`),
    actorCheck: check(
      "ai_runtime_controls_actor_check",
      sql`(${table.changedByManagerId} IS NULL AND ${table.changedByManagerEmail} IS NULL)
        OR (${table.changedByManagerId} IS NOT NULL AND ${table.changedByManagerEmail} IS NOT NULL)`
    )
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

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    traceId: uuid("trace_id").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    inboundMessageId: uuid("inbound_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "no action" }),
    outboundMessageId: uuid("outbound_message_id").references(() => conversationMessages.id, {
      onDelete: "no action"
    }),
    channel: text("channel").notNull(),
    runtimeMode: text("runtime_mode").notNull(),
    runtimeRunId: text("runtime_run_id"),
    decisionProfile: text("decision_profile").notNull(),
    decisionAction: text("decision_action"),
    idempotencyKey: text("idempotency_key").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    status: text("status").notNull().default("running"),
    policyVersion: text("policy_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    toolVersion: text("tool_version").notNull(),
    assetVersion: text("asset_version"),
    toneVersion: text("tone_version"),
    factsVersion: text("facts_version"),
    disclosureVersion: text("disclosure_version").notNull(),
    configuredModelProvider: text("configured_model_provider").notNull(),
    configuredModelName: text("configured_model_name").notNull(),
    observedModelProvider: text("observed_model_provider"),
    observedModelName: text("observed_model_name"),
    reasoningEffort: text("reasoning_effort").notNull().default("none"),
    modelProfileVersion: text("model_profile_version").notNull(),
    runtimeVersion: text("runtime_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costEstimateMicrounits: integer("cost_estimate_microunits"),
    costRateVersion: text("cost_rate_version"),
    sendGateResult: text("send_gate_result").notNull().default("not_checked"),
    sendGateCheckedAt: timestamp("send_gate_checked_at", { withTimezone: true }),
    outcomeReason: text("outcome_reason"),
    failureCode: text("failure_code"),
    profileValidatorResult: text("profile_validator_result").notNull().default("not_run"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    traceIdIdx: uniqueIndex("ai_runs_trace_id_idx").on(table.traceId),
    idempotencyKeyIdx: uniqueIndex("ai_runs_idempotency_key_idx").on(table.idempotencyKey),
    outboundMessageIdIdx: uniqueIndex("ai_runs_outbound_message_id_idx")
      .on(table.outboundMessageId)
      .where(sql`${table.outboundMessageId} IS NOT NULL`),
    conversationStartedIdx: index("ai_runs_conversation_started_idx").on(
      table.conversationId,
      table.startedAt.desc()
    ),
    inboundMessageIdIdx: index("ai_runs_inbound_message_id_idx").on(table.inboundMessageId),
    statusStartedIdx: index("ai_runs_status_started_idx").on(
      table.status,
      table.startedAt.desc()
    ),
    inputFingerprintIdx: index("ai_runs_input_fingerprint_idx").on(table.inputFingerprint),
    channelCheck: check("ai_runs_channel_check", sql`${table.channel} IN ('site_widget')`),
    runtimeModeCheck: check(
      "ai_runs_runtime_mode_check",
      sql`${table.runtimeMode} IN ('direct_openai', 'mastra_openai_api')`
    ),
    runtimeRunIdCheck: check(
      "ai_runs_runtime_run_id_check",
      sql`${table.runtimeRunId} IS NULL OR (char_length(${table.runtimeRunId}) BETWEEN 1 AND 200 AND ${table.runtimeRunId} ~ '^[A-Za-z0-9._:/@+-]+$')`
    ),
    runtimeLinkageCheck: check(
      "ai_runs_runtime_linkage_check",
      sql`${table.runtimeMode} = 'mastra_openai_api' OR ${table.runtimeRunId} IS NULL`
    ),
    decisionProfileCheck: check(
      "ai_runs_decision_profile_check",
      sql`${table.decisionProfile} IN ('legacy_s05', 'live_v2')`
    ),
    runtimeProfileCheck: check(
      "ai_runs_runtime_profile_check",
      sql`(${table.runtimeMode} = 'direct_openai' AND ${table.decisionProfile} = 'legacy_s05')
        OR (${table.runtimeMode} = 'mastra_openai_api' AND ${table.decisionProfile} = 'live_v2')`
    ),
    decisionActionCheck: check(
      "ai_runs_decision_action_check",
      sql`${table.decisionAction} IS NULL OR ${table.decisionAction} IN ('answer', 'ask_clarifying_question', 'handoff_to_manager', 'no_reply')`
    ),
    idempotencyKeyCheck: check(
      "ai_runs_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 1 AND 200 AND ${table.idempotencyKey} ~ '^[A-Za-z0-9._:/@+-]+$'`
    ),
    inputFingerprintCheck: check(
      "ai_runs_input_fingerprint_check",
      sql`char_length(${table.inputFingerprint}) = 64 AND ${table.inputFingerprint} ~ '^[a-f0-9]{64}$'`
    ),
    statusCheck: check(
      "ai_runs_status_check",
      sql`${table.status} IN ('running', 'persisted', 'handed_off', 'blocked', 'fallback_unavailable', 'failed')`
    ),
    versionFieldsCheck: check(
      "ai_runs_version_fields_check",
      sql`char_length(${table.policyVersion}) BETWEEN 1 AND 160
        AND ${table.policyVersion} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND char_length(${table.promptVersion}) BETWEEN 1 AND 160
        AND ${table.promptVersion} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND char_length(${table.toolVersion}) BETWEEN 1 AND 160
        AND ${table.toolVersion} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND (${table.assetVersion} IS NULL OR (char_length(${table.assetVersion}) BETWEEN 1 AND 160 AND ${table.assetVersion} ~ '^[A-Za-z0-9._:/@+-]+$'))
        AND (${table.toneVersion} IS NULL OR (char_length(${table.toneVersion}) BETWEEN 1 AND 160 AND ${table.toneVersion} ~ '^[A-Za-z0-9._:/@+-]+$'))
        AND (${table.factsVersion} IS NULL OR (char_length(${table.factsVersion}) BETWEEN 1 AND 160 AND ${table.factsVersion} ~ '^[A-Za-z0-9._:/@+-]+$'))
        AND char_length(${table.disclosureVersion}) BETWEEN 1 AND 160
        AND ${table.disclosureVersion} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND char_length(${table.modelProfileVersion}) BETWEEN 1 AND 160
        AND ${table.modelProfileVersion} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND (${table.runtimeVersion} IS NULL OR (char_length(${table.runtimeVersion}) BETWEEN 1 AND 160 AND ${table.runtimeVersion} ~ '^[A-Za-z0-9._:/@+-]+$'))`
    ),
    configuredModelProviderCheck: check(
      "ai_runs_configured_model_provider_check",
      sql`${table.configuredModelProvider} IN ('none', 'openai', 'fake')`
    ),
    observedModelProviderCheck: check(
      "ai_runs_observed_model_provider_check",
      sql`${table.observedModelProvider} IS NULL OR ${table.observedModelProvider} IN ('none', 'openai', 'policy', 'fake')`
    ),
    modelNamesCheck: check(
      "ai_runs_model_names_check",
      sql`char_length(${table.configuredModelName}) BETWEEN 1 AND 120
        AND ${table.configuredModelName} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND (${table.observedModelName} IS NULL OR (char_length(${table.observedModelName}) BETWEEN 1 AND 120 AND ${table.observedModelName} ~ '^[A-Za-z0-9._:/@+-]+$'))`
    ),
    modelObservationStateCheck: check(
      "ai_runs_model_observation_state_check",
      sql`(${table.status} = 'running'
          AND ${table.observedModelProvider} IS NULL
          AND ${table.observedModelName} IS NULL)
        OR (${table.status} <> 'running'
          AND ${table.observedModelProvider} IS NOT NULL
          AND ((${table.observedModelProvider} = 'none' AND ${table.observedModelName} IS NULL)
            OR (${table.observedModelProvider} <> 'none' AND ${table.observedModelName} IS NOT NULL)))`
    ),
    reasoningEffortCheck: check(
      "ai_runs_reasoning_effort_check",
      sql`${table.reasoningEffort} IN ('none', 'low', 'medium', 'high')`
    ),
    tokenCountsCheck: check(
      "ai_runs_token_counts_check",
      sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0)
        AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)
        AND (${table.totalTokens} IS NULL OR ${table.totalTokens} >= 0)`
    ),
    costEstimateCheck: check(
      "ai_runs_cost_estimate_check",
      sql`(${table.costEstimateMicrounits} IS NULL AND ${table.costRateVersion} IS NULL)
        OR (${table.costEstimateMicrounits} IS NOT NULL
          AND ${table.costRateVersion} IS NOT NULL
          AND ${table.costEstimateMicrounits} >= 0
          AND char_length(${table.costRateVersion}) BETWEEN 1 AND 160
          AND ${table.costRateVersion} ~ '^[A-Za-z0-9._:/@+-]+$')`
    ),
    sendGateResultCheck: check(
      "ai_runs_send_gate_result_check",
      sql`${table.sendGateResult} IN ('not_checked', 'allowed', 'blocked')`
    ),
    sendGateTimestampCheck: check(
      "ai_runs_send_gate_timestamp_check",
      sql`(${table.sendGateResult} = 'not_checked' AND ${table.sendGateCheckedAt} IS NULL)
        OR (${table.sendGateResult} <> 'not_checked' AND ${table.sendGateCheckedAt} IS NOT NULL)`
    ),
    outcomeReasonCheck: check(
      "ai_runs_outcome_reason_check",
      sql`${table.outcomeReason} IS NULL OR ${table.outcomeReason} IN (
        'reply_persisted',
        'handoff_to_manager',
        'missing_provider_config',
        'model_error',
        'empty_model_response',
        'unsafe_model_response',
        'agent_reply_blocked',
        'ai_persistence_unconfirmed',
        'execution_context_mismatch',
        'generator_failed',
        'candidate_invalid',
        'no_safe_answer',
        'missing_approved_fact',
        'gate_closed',
        'recorder_failure'
      )`
    ),
    failureCodeCheck: check(
      "ai_runs_failure_code_check",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN (
        'provider_unavailable',
        'model_failure',
        'policy_violation',
        'send_gate_blocked',
        'persistence_failure',
        'runtime_failure',
        'recorder_failure',
        'invalid_candidate',
        'execution_context_mismatch'
      )`
    ),
    profileValidatorResultCheck: check(
      "ai_runs_profile_validator_result_check",
      sql`${table.profileValidatorResult} IN ('not_run', 'passed', 'rejected', 'failed')`
    ),
    timingCheck: check(
      "ai_runs_timing_check",
      sql`(${table.status} = 'running' AND ${table.completedAt} IS NULL AND ${table.latencyMs} IS NULL)
        OR (${table.status} <> 'running'
          AND ${table.completedAt} IS NOT NULL
          AND ${table.completedAt} >= ${table.startedAt}
          AND ${table.latencyMs} IS NOT NULL
          AND ${table.latencyMs} >= 0)`
    ),
    outboundLinkageCheck: check(
      "ai_runs_outbound_linkage_check",
      sql`(${table.status} IN ('persisted', 'handed_off')
          AND ${table.outboundMessageId} IS NOT NULL
          AND ${table.sendGateResult} = 'allowed')
        OR (${table.status} NOT IN ('persisted', 'handed_off') AND ${table.outboundMessageId} IS NULL)`
    ),
    terminalEvidenceCheck: check(
      "ai_runs_terminal_evidence_check",
      sql`(${table.status} = 'running'
          AND ${table.decisionAction} IS NULL
          AND ${table.outcomeReason} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.sendGateResult} = 'not_checked')
        OR (${table.status} IN ('persisted', 'handed_off')
          AND ${table.decisionAction} IS NOT NULL
          AND ${table.outcomeReason} IS NOT NULL
          AND ${table.failureCode} IS NULL)
        OR (${table.status} = 'fallback_unavailable'
          AND ${table.decisionAction} = 'no_reply'
          AND ${table.outcomeReason} IN ('no_safe_answer', 'missing_approved_fact')
          AND ${table.failureCode} IS NULL)
        OR (${table.status} IN ('blocked', 'fallback_unavailable', 'failed')
          AND ${table.decisionAction} IS NOT NULL
          AND ${table.outcomeReason} IS NOT NULL
          AND ${table.outcomeReason} NOT IN ('no_safe_answer', 'missing_approved_fact')
          AND ${table.failureCode} IS NOT NULL)`
    ),
    sendGateStateCheck: check(
      "ai_runs_send_gate_state_check",
      sql`(${table.sendGateResult} = 'allowed' AND ${table.status} IN ('persisted', 'handed_off'))
        OR (${table.sendGateResult} = 'blocked' AND ${table.status} = 'blocked')
        OR ${table.sendGateResult} = 'not_checked'`
    ),
    terminalActionCheck: check(
      "ai_runs_terminal_action_check",
      sql`${table.status} = 'running'
        OR (${table.status} = 'persisted'
          AND ${table.decisionAction} IS NOT NULL
          AND ${table.decisionAction} IN ('answer', 'ask_clarifying_question'))
        OR (${table.status} = 'handed_off'
          AND ${table.decisionAction} IS NOT NULL
          AND ${table.decisionAction} = 'handoff_to_manager')
        OR (${table.status} = 'fallback_unavailable'
          AND ${table.decisionAction} IS NOT NULL
          AND ${table.decisionAction} = 'no_reply')
        OR ${table.status} IN ('blocked', 'failed')`
    )
  })
);

export const aiRunSpans = pgTable(
  "ai_run_spans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    spanId: text("span_id").notNull(),
    parentSpanId: text("parent_span_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    toolVersion: text("tool_version"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    usedInFinalAnswer: boolean("used_in_final_answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`)
  },
  (table) => ({
    runSpanIdIdx: uniqueIndex("ai_run_spans_run_span_id_idx").on(table.aiRunId, table.spanId),
    runCreatedIdx: index("ai_run_spans_run_created_idx").on(table.aiRunId, table.createdAt),
    expiresAtIdx: index("ai_run_spans_expires_at_idx").on(table.expiresAt),
    spanIdCheck: check(
      "ai_run_spans_span_id_check",
      sql`char_length(${table.spanId}) BETWEEN 1 AND 160
        AND ${table.spanId} ~ '^[A-Za-z0-9._:/@+-]+$'
        AND (${table.parentSpanId} IS NULL
          OR (char_length(${table.parentSpanId}) BETWEEN 1 AND 160
            AND ${table.parentSpanId} ~ '^[A-Za-z0-9._:/@+-]+$'))`
    ),
    kindCheck: check(
      "ai_run_spans_kind_check",
      sql`${table.kind} IN ('runtime', 'model', 'tool', 'validation', 'send_gate')`
    ),
    nameCheck: check(
      "ai_run_spans_name_check",
      sql`${table.name} IN (
        'turn_execution',
        'decision_generation',
        'candidate_validation',
        'reply_persistence',
        'send_gate_check',
        'runtime_execution',
        'model_generation',
        'tool_execution'
      )`
    ),
    toolVersionCheck: check(
      "ai_run_spans_tool_version_check",
      sql`${table.toolVersion} IS NULL OR char_length(${table.toolVersion}) BETWEEN 1 AND 160`
    ),
    statusCheck: check(
      "ai_run_spans_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed', 'blocked', 'skipped')`
    ),
    latencyCheck: check(
      "ai_run_spans_latency_check",
      sql`(${table.status} = 'running' AND ${table.latencyMs} IS NULL)
        OR (${table.status} <> 'running' AND ${table.latencyMs} IS NOT NULL AND ${table.latencyMs} >= 0)`
    ),
    errorCodeCheck: check(
      "ai_run_spans_error_code_check",
      sql`${table.errorCode} IS NULL OR ${table.errorCode} IN (
        'provider_unavailable',
        'model_error',
        'empty_model_response',
        'unsafe_model_response',
        'validation_failed',
        'send_gate_blocked',
        'persistence_failed',
        'tool_failed',
        'runtime_failed',
        'recorder_failed'
      )`
    ),
    expiryCheck: check(
      "ai_run_spans_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`
    )
  })
);

export const aiQualityEvents = pgTable(
  "ai_quality_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => conversationMessages.id, {
      onDelete: "set null"
    }),
    eventType: text("event_type").notNull(),
    reasonCode: text("reason_code").notNull(),
    severity: text("severity").notNull(),
    managerVisible: boolean("manager_visible").notNull().default(true),
    resolutionStatus: text("resolution_status").notNull().default("open"),
    resolutionCode: text("resolution_code"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runCreatedIdx: index("ai_quality_events_run_created_idx").on(table.aiRunId, table.createdAt),
    conversationCreatedIdx: index("ai_quality_events_conversation_created_idx").on(
      table.conversationId,
      table.createdAt.desc()
    ),
    managerOpenIdx: index("ai_quality_events_manager_open_idx")
      .on(table.managerVisible, table.resolutionStatus, table.createdAt.desc())
      .where(sql`${table.managerVisible} = true AND ${table.resolutionStatus} = 'open'`),
    leadCreatedIdx: index("ai_quality_events_lead_created_idx").on(
      table.leadId,
      table.createdAt.desc()
    ),
    eventTypeCheck: check(
      "ai_quality_events_event_type_check",
      sql`${table.eventType} IN ('handoff', 'degradation', 'blocked', 'policy_violation', 'model_failure', 'tool_failure', 'runtime_failure')`
    ),
    reasonCodeCheck: check(
      "ai_quality_events_reason_code_check",
      sql`${table.reasonCode} IN (
        'handoff_to_manager',
        'missing_openai_config',
        'model_error',
        'empty_model_response',
        'unsafe_model_response',
        'agent_reply_blocked',
        'ai_persistence_unconfirmed',
        'execution_context_mismatch',
        'candidate_invalid',
        'no_safe_answer',
        'missing_approved_fact',
        'gate_closed',
        'send_gate_blocked',
        'tool_failed',
        'runtime_failed',
        'recorder_failed'
      )`
    ),
    severityCheck: check(
      "ai_quality_events_severity_check",
      sql`${table.severity} IN ('info', 'warning', 'error', 'critical')`
    ),
    resolutionStatusCheck: check(
      "ai_quality_events_resolution_status_check",
      sql`${table.resolutionStatus} IN ('open', 'resolved')`
    ),
    resolutionCodeCheck: check(
      "ai_quality_events_resolution_code_check",
      sql`${table.resolutionCode} IS NULL OR ${table.resolutionCode} IN ('manager_acknowledged', 'recovered', 'superseded', 'false_positive')`
    ),
    resolutionCheck: check(
      "ai_quality_events_resolution_check",
      sql`(${table.resolutionStatus} = 'open' AND ${table.resolutionCode} IS NULL AND ${table.resolvedAt} IS NULL)
        OR (${table.resolutionStatus} = 'resolved' AND ${table.resolutionCode} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`
    )
  })
);
