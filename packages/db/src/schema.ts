import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
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
    leadId: uuid("lead_id").references(() => leads.id, {
      onDelete: "set null"
    }),
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
    widgetSessionIdx: uniqueIndex("channel_identities_widget_session_id_idx")
      .on(table.widgetSessionId)
      .where(sql`${table.widgetSessionId} IS NOT NULL`),
    telegramChatIdx: uniqueIndex("channel_identities_telegram_chat_idx")
      .on(table.provider, table.providerAccountId, table.externalChatId)
      .where(
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
    lastMessageSequence: bigint("last_message_sequence", { mode: "number" }).notNull().default(0),
    generationEpoch: bigint("generation_epoch", { mode: "number" }).notNull().default(0),
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
    channelIdentityIdx: index("conversations_channel_identity_id_idx").on(table.channelIdentityId),
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
    messageSequence: bigint("message_sequence", { mode: "number" }).notNull(),
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
    providerMessageIdx: uniqueIndex("conversation_messages_provider_message_idx")
      .on(table.channelIdentityId, table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    providerUpdateIdx: uniqueIndex("conversation_messages_provider_update_idx")
      .on(table.channelIdentityId, table.providerUpdateId)
      .where(sql`${table.providerUpdateId} IS NOT NULL`),
    conversationCreatedIdx: index("conversation_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    conversationSequenceIdx: uniqueIndex("conversation_messages_conversation_sequence_idx").on(
      table.conversationId,
      table.messageSequence
    ),
    leadCreatedIdx: index("conversation_messages_lead_created_idx").on(
      table.leadId,
      table.createdAt
    )
  })
);

export const widgetAiJobs = pgTable(
  "widget_ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inboundMessageId: uuid("inbound_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    inboundPublicMessageId: uuid("inbound_public_message_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    expectedGenerationEpoch: bigint("expected_generation_epoch", {
      mode: "number"
    }).notNull(),
    respondsThroughSequence: bigint("responds_through_sequence", {
      mode: "number"
    }).notNull(),
    runtimeMode: text("runtime_mode").notNull().default("direct_openai"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    outputPublicMessageId: uuid("output_public_message_id"),
    terminalReason: text("terminal_reason"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    inboundMessageIdx: uniqueIndex("widget_ai_jobs_inbound_message_idx").on(table.inboundMessageId),
    inboundPublicMessageIdx: uniqueIndex("widget_ai_jobs_inbound_public_message_idx").on(
      table.inboundPublicMessageId
    ),
    claimIdx: index("widget_ai_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt
    ),
    conversationCreatedIdx: index("widget_ai_jobs_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    responseWindowIdx: uniqueIndex("widget_ai_jobs_response_window_idx").on(
      table.conversationId,
      table.expectedGenerationEpoch,
      table.respondsThroughSequence,
      table.runtimeMode
    ),
    statusCheck: check(
      "widget_ai_jobs_status_check",
      sql`${table.status} IN ('pending', 'processing', 'retrying', 'replied', 'degraded', 'blocked', 'failed', 'superseded')`
    ),
    runtimeModeCheck: check(
      "widget_ai_jobs_runtime_mode_check",
      sql`${table.runtimeMode} IN ('direct_openai', 'mastra_openai_api')`
    )
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
    leadUpdatedIdx: index("conversation_slots_lead_updated_idx").on(table.leadId, table.updatedAt)
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
      .references(() => conversations.publicConversationId, {
        onDelete: "cascade"
      }),
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
    inboundIdx: uniqueIndex("ai_shadow_comparisons_inbound_idx").on(table.inboundPublicMessageId),
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
    recordingContract: text("recording_contract").notNull().default("native_recorded"),
    winningAttemptId: uuid("winning_attempt_id").references((): AnyPgColumn => aiRunAttempts.id),
    traceId: uuid("trace_id"),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    inboundMessageId: uuid("inbound_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "no action" }),
    inboundPublicMessageId: uuid("inbound_public_message_id")
      .notNull()
      .$defaultFn(() => {
        throw new Error("ai_runs.inbound_public_message_id requires explicit canonical linkage");
      }),
    outboundMessageId: uuid("outbound_message_id").references(() => conversationMessages.id, {
      onDelete: "no action"
    }),
    outboundPublicMessageId: uuid("outbound_public_message_id"),
    channel: text("channel").notNull().default("site_widget"),
    runtimeMode: text("runtime_mode").notNull().default("direct_openai"),
    runtimeRunId: text("runtime_run_id"),
    decisionProfile: text("decision_profile").notNull().default("legacy_s05"),
    decisionAction: text("decision_action"),
    action: text("action"),
    intent: text("intent"),
    idempotencyKey: text("idempotency_key"),
    inputFingerprint: text("input_fingerprint").notNull(),
    status: text("status").notNull().default("running"),
    reason: text("reason"),
    policyVersion: text("policy_version"),
    promptVersion: text("prompt_version"),
    toolVersion: text("tool_version"),
    knowledgeVersion: text("knowledge_version"),
    assetVersion: text("asset_version"),
    toneVersion: text("tone_version"),
    factsVersion: text("facts_version"),
    disclosureVersion: text("disclosure_version"),
    configuredModelProvider: text("configured_model_provider"),
    configuredModelName: text("configured_model_name"),
    modelName: text("model_name"),
    generatorModelName: text("generator_model_name"),
    verifierModelName: text("verifier_model_name"),
    verifierVersion: text("verifier_version"),
    verifierVerdict: text("verifier_verdict"),
    catalogVersion: text("catalog_version"),
    catalogContentHash: text("catalog_content_hash"),
    observedModelProvider: text("observed_model_provider"),
    observedModelName: text("observed_model_name"),
    reasoningEffort: text("reasoning_effort"),
    modelProfileVersion: text("model_profile_version"),
    runtimeVersion: text("runtime_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costEstimateMicrounits: integer("cost_estimate_microunits"),
    costRateVersion: text("cost_rate_version"),
    sendGateResult: text("send_gate_result").notNull().default("not_checked"),
    sendGateCheckedAt: timestamp("send_gate_checked_at", {
      withTimezone: true
    }),
    outcomeReason: text("outcome_reason"),
    failureCode: text("failure_code"),
    profileValidatorResult: text("profile_validator_result").notNull().default("not_run"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    traceIdIdx: uniqueIndex("ai_runs_trace_id_idx").on(table.traceId),
    idempotencyKeyIdx: uniqueIndex("ai_runs_idempotency_key_idx").on(table.idempotencyKey),
    inboundPublicMessageIdIdx: index("ai_runs_inbound_public_message_id_idx").on(
      table.inboundPublicMessageId
    ),
    outboundMessageIdIdx: uniqueIndex("ai_runs_outbound_message_id_idx")
      .on(table.outboundMessageId)
      .where(sql`${table.outboundMessageId} IS NOT NULL`),
    conversationStartedIdx: index("ai_runs_conversation_started_idx").on(
      table.conversationId,
      table.startedAt.desc()
    ),
    inboundMessageIdIdx: index("ai_runs_inbound_message_id_idx").on(table.inboundMessageId),
    statusStartedIdx: index("ai_runs_status_started_idx").on(table.status, table.startedAt.desc()),
    inputFingerprintIdx: index("ai_runs_input_fingerprint_idx").on(table.inputFingerprint),
    recordingContractCheck: check(
      "ai_runs_recording_contract_check",
      sql`${table.recordingContract} IN ('native_grounded', 'native_recorded', 'logical_recorded_v2', 'legacy_narrow')`
    ),
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
      sql`${table.decisionProfile} = 'live_v2' OR ${table.runtimeRunId} IS NULL`
    ),
    decisionProfileCheck: check(
      "ai_runs_decision_profile_check",
      sql`${table.decisionProfile} IN ('legacy_s05', 'live_v2', 'grounded_v1')`
    ),
    runtimeProfileCheck: check(
      "ai_runs_runtime_profile_check",
      sql`(${table.recordingContract} = 'native_recorded'
          AND ((${table.runtimeMode} = 'direct_openai' AND ${table.decisionProfile} IN ('legacy_s05', 'live_v2'))
            OR (${table.runtimeMode} = 'mastra_openai_api' AND ${table.decisionProfile} = 'live_v2')))
        OR (${table.recordingContract} = 'logical_recorded_v2'
          AND ((${table.runtimeMode} = 'direct_openai' AND ${table.decisionProfile} IN ('legacy_s05', 'live_v2'))
            OR (${table.runtimeMode} = 'mastra_openai_api' AND ${table.decisionProfile} = 'live_v2')))
        OR (${table.recordingContract} IN ('native_grounded', 'legacy_narrow')
          AND ${table.runtimeMode} = 'direct_openai'
          AND ${table.decisionProfile} = 'grounded_v1')`
    ),
    decisionActionCheck: check(
      "ai_runs_decision_action_check",
      sql`${table.decisionAction} IS NULL OR ${table.decisionAction} IN ('answer', 'ask_clarifying_question', 'handoff_to_manager', 'no_reply')`
    ),
    idempotencyKeyCheck: check(
      "ai_runs_idempotency_key_check",
      sql`${table.idempotencyKey} IS NULL OR (char_length(${table.idempotencyKey}) BETWEEN 1 AND 200 AND ${table.idempotencyKey} ~ '^[A-Za-z0-9._:/@+-]+$')`
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
      sql`${table.configuredModelProvider} IS NULL OR ${table.configuredModelProvider} IN ('none', 'openai', 'fake')`
    ),
    observedModelProviderCheck: check(
      "ai_runs_observed_model_provider_check",
      sql`${table.observedModelProvider} IS NULL OR ${table.observedModelProvider} IN ('none', 'openai', 'policy', 'fake')`
    ),
    modelNamesCheck: check(
      "ai_runs_model_names_check",
      sql`(${table.configuredModelName} IS NULL OR (char_length(${table.configuredModelName}) BETWEEN 1 AND 120
        AND ${table.configuredModelName} ~ '^[A-Za-z0-9._:/@+-]+$'))
        AND (${table.observedModelName} IS NULL OR (char_length(${table.observedModelName}) BETWEEN 1 AND 120 AND ${table.observedModelName} ~ '^[A-Za-z0-9._:/@+-]+$'))`
    ),
    modelObservationStateCheck: check(
      "ai_runs_model_observation_state_check",
      sql`${table.recordingContract} NOT IN ('native_recorded', 'logical_recorded_v2')
        OR (${table.status} = 'running'
          AND ${table.observedModelProvider} IS NULL
          AND ${table.observedModelName} IS NULL)
        OR (${table.status} <> 'running'
          AND ${table.observedModelProvider} IS NOT NULL
          AND ((${table.observedModelProvider} = 'none' AND ${table.observedModelName} IS NULL)
            OR (${table.observedModelProvider} <> 'none' AND ${table.observedModelName} IS NOT NULL)))`
    ),
    reasoningEffortCheck: check(
      "ai_runs_reasoning_effort_check",
      sql`${table.reasoningEffort} IS NULL OR ${table.reasoningEffort} IN ('none', 'low', 'medium', 'high')`
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
        'semantic_verifier_error',
        'turn_timeout',
        'empty_model_response',
        'unsafe_model_response',
        'grounding_validation_failed',
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
    verifierVerdictCheck: check(
      "ai_runs_verifier_verdict_check",
      sql`${table.verifierVerdict} IS NULL OR ${table.verifierVerdict} IN ('pass', 'repair', 'handoff', 'block')`
    ),
    catalogContentHashCheck: check(
      "ai_runs_catalog_content_hash_check",
      sql`${table.catalogContentHash} IS NULL OR char_length(${table.catalogContentHash}) = 64`
    ),
    timingCheck: check(
      "ai_runs_timing_check",
      sql`(${table.recordingContract} IN ('native_recorded', 'logical_recorded_v2')
        AND ((${table.status} = 'running' AND ${table.completedAt} IS NULL AND ${table.latencyMs} IS NULL)
        OR (${table.status} <> 'running'
          AND ${table.completedAt} IS NOT NULL
          AND ${table.completedAt} >= ${table.startedAt}
          AND ${table.latencyMs} IS NOT NULL
          AND ${table.latencyMs} >= 0)))
        OR (${table.recordingContract} IN ('native_grounded', 'legacy_narrow')
          AND ${table.status} <> 'running'
          AND ${table.completedAt} IS NOT NULL
          AND ${table.latencyMs} IS NULL)`
    ),
    outboundLinkageCheck: check(
      "ai_runs_outbound_linkage_check",
      sql`(${table.status} IN ('persisted', 'handed_off')
          AND ${table.outboundMessageId} IS NOT NULL
          AND ${table.outboundPublicMessageId} IS NOT NULL
          AND ${table.sendGateResult} = 'allowed')
        OR (${table.status} NOT IN ('persisted', 'handed_off')
          AND ${table.outboundMessageId} IS NULL
          AND ${table.outboundPublicMessageId} IS NULL)`
    ),
    publicInternalLinkageCheck: check(
      "ai_runs_public_internal_linkage_check",
      sql`${table.inboundMessageId} IS NOT NULL
        AND ${table.inboundPublicMessageId} IS NOT NULL
        AND ((${table.outboundMessageId} IS NULL) = (${table.outboundPublicMessageId} IS NULL))`
    ),
    contractEvidenceCheck: check(
      "ai_runs_contract_evidence_check",
      sql`(${table.recordingContract} IN ('native_recorded', 'logical_recorded_v2')
          AND ${table.traceId} IS NOT NULL
          AND ${table.idempotencyKey} IS NOT NULL
          AND ${table.policyVersion} IS NOT NULL
          AND ${table.promptVersion} IS NOT NULL
          AND ${table.toolVersion} IS NOT NULL
          AND ${table.disclosureVersion} IS NOT NULL
          AND ${table.configuredModelProvider} IS NOT NULL
          AND ${table.configuredModelName} IS NOT NULL
          AND ${table.reasoningEffort} IS NOT NULL
          AND ${table.modelProfileVersion} IS NOT NULL
          AND ${table.startedAt} IS NOT NULL)
        OR (${table.recordingContract} = 'native_grounded'
          AND ${table.idempotencyKey} IS NOT NULL
          AND ${table.status} <> 'running'
          AND ${table.decisionAction} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL)
        OR (${table.recordingContract} = 'legacy_narrow'
          AND ${table.status} <> 'running'
          AND ${table.completedAt} IS NOT NULL)`
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
          AND (${table.outcomeReason} IS NOT NULL
            OR (${table.recordingContract} IN ('native_grounded', 'legacy_narrow') AND ${table.reason} IS NOT NULL))
          AND (${table.outcomeReason} IS NULL OR ${table.outcomeReason} NOT IN ('no_safe_answer', 'missing_approved_fact'))
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
    ),
    winningAttemptStateCheck: check(
      "ai_runs_winning_attempt_state_check",
      sql`(${table.recordingContract} <> 'logical_recorded_v2' AND ${table.winningAttemptId} IS NULL)
        OR (${table.recordingContract} = 'logical_recorded_v2' AND ${table.status} = 'running' AND ${table.winningAttemptId} IS NULL)
        OR (${table.recordingContract} = 'logical_recorded_v2' AND ${table.status} = 'failed' AND ${table.winningAttemptId} IS NULL)
        OR (${table.recordingContract} = 'logical_recorded_v2' AND ${table.status} NOT IN ('running', 'failed') AND ${table.winningAttemptId} IS NOT NULL)`
    )
  })
);

export const aiRunAttempts = pgTable(
  "ai_run_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    jobId: uuid("job_id").references(() => widgetAiJobs.id, {
      onDelete: "set null"
    }),
    jobAttemptCount: integer("job_attempt_count").notNull(),
    maxAttempts: integer("max_attempts"),
    idempotencyKey: text("idempotency_key").notNull(),
    traceId: uuid("trace_id").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    runtimeRunId: text("runtime_run_id"),
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
    reasoningEffort: text("reasoning_effort").notNull(),
    modelProfileVersion: text("model_profile_version").notNull(),
    runtimeVersion: text("runtime_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costEstimateMicrounits: integer("cost_estimate_microunits"),
    costRateVersion: text("cost_rate_version"),
    sendGateResult: text("send_gate_result").notNull().default("not_checked"),
    sendGateCheckedAt: timestamp("send_gate_checked_at", {
      withTimezone: true
    }),
    outcomeReason: text("outcome_reason"),
    failureCode: text("failure_code"),
    profileValidatorResult: text("profile_validator_result").notNull().default("not_run"),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runNumberIdx: uniqueIndex("ai_run_attempts_run_number_idx").on(
      table.aiRunId,
      table.attemptNumber
    ),
    idRunIdx: uniqueIndex("ai_run_attempts_id_run_idx").on(table.id, table.aiRunId),
    idempotencyKeyIdx: uniqueIndex("ai_run_attempts_idempotency_key_idx").on(table.idempotencyKey),
    traceIdIdx: uniqueIndex("ai_run_attempts_trace_id_idx").on(table.traceId),
    singleSuccessIdx: uniqueIndex("ai_run_attempts_single_success_idx")
      .on(table.aiRunId)
      .where(sql`${table.status} = 'succeeded'`),
    runStartedIdx: index("ai_run_attempts_run_started_idx").on(
      table.aiRunId,
      table.startedAt.desc()
    ),
    jobAttemptIdx: index("ai_run_attempts_job_attempt_idx").on(table.jobId, table.jobAttemptCount),
    attemptNumberCheck: check(
      "ai_run_attempts_attempt_number_check",
      sql`${table.attemptNumber} > 0 AND ${table.jobAttemptCount} > 0
        AND (${table.maxAttempts} IS NULL OR ${table.maxAttempts} >= ${table.jobAttemptCount})`
    ),
    idempotencyKeyCheck: check(
      "ai_run_attempts_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 1 AND 240
        AND ${table.idempotencyKey} ~ '^[A-Za-z0-9._:/@+-]+$'`
    ),
    inputFingerprintCheck: check(
      "ai_run_attempts_input_fingerprint_check",
      sql`char_length(${table.inputFingerprint}) = 64
        AND ${table.inputFingerprint} ~ '^[a-f0-9]{64}$'`
    ),
    runtimeRunIdCheck: check(
      "ai_run_attempts_runtime_run_id_check",
      sql`${table.runtimeRunId} IS NULL OR (char_length(${table.runtimeRunId}) BETWEEN 1 AND 200
        AND ${table.runtimeRunId} ~ '^[A-Za-z0-9._:/@+-]+$')`
    ),
    configuredModelProviderCheck: check(
      "ai_run_attempts_configured_model_provider_check",
      sql`${table.configuredModelProvider} IN ('none', 'openai', 'fake')`
    ),
    observedModelProviderCheck: check(
      "ai_run_attempts_observed_model_provider_check",
      sql`${table.observedModelProvider} IS NULL OR ${table.observedModelProvider} IN ('none', 'openai', 'policy', 'fake')`
    ),
    reasoningEffortCheck: check(
      "ai_run_attempts_reasoning_effort_check",
      sql`${table.reasoningEffort} IN ('none', 'low', 'medium', 'high')`
    ),
    tokenCountsCheck: check(
      "ai_run_attempts_token_counts_check",
      sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0)
        AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)
        AND (${table.totalTokens} IS NULL OR ${table.totalTokens} >= 0)`
    ),
    costCheck: check(
      "ai_run_attempts_cost_check",
      sql`(${table.costEstimateMicrounits} IS NULL AND ${table.costRateVersion} IS NULL)
        OR (${table.costEstimateMicrounits} IS NOT NULL
          AND ${table.costRateVersion} IS NOT NULL
          AND ${table.costEstimateMicrounits} >= 0
          AND char_length(${table.costRateVersion}) BETWEEN 1 AND 160
          AND ${table.costRateVersion} ~ '^[A-Za-z0-9._:/@+-]+$')`
    ),
    sendGateResultCheck: check(
      "ai_run_attempts_send_gate_result_check",
      sql`${table.sendGateResult} IN ('not_checked', 'allowed', 'blocked')`
    ),
    validatorResultCheck: check(
      "ai_run_attempts_profile_validator_result_check",
      sql`${table.profileValidatorResult} IN ('not_run', 'passed', 'rejected', 'failed')`
    ),
    statusCheck: check(
      "ai_run_attempts_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed', 'fenced')`
    ),
    modelObservationCheck: check(
      "ai_run_attempts_model_observation_check",
      sql`(${table.status} = 'running' AND ${table.observedModelProvider} IS NULL AND ${table.observedModelName} IS NULL)
        OR (${table.status} <> 'running'
          AND ${table.observedModelProvider} IS NOT NULL
          AND ((${table.observedModelProvider} = 'none' AND ${table.observedModelName} IS NULL)
            OR (${table.observedModelProvider} <> 'none' AND ${table.observedModelName} IS NOT NULL)))`
    ),
    timingCheck: check(
      "ai_run_attempts_timing_check",
      sql`(${table.status} = 'running' AND ${table.completedAt} IS NULL AND ${table.latencyMs} IS NULL)
        OR (${table.status} <> 'running' AND ${table.completedAt} IS NOT NULL
          AND ${table.completedAt} >= ${table.startedAt} AND ${table.latencyMs} IS NOT NULL
          AND ${table.latencyMs} >= 0)`
    ),
    sendGateTimestampCheck: check(
      "ai_run_attempts_send_gate_timestamp_check",
      sql`(${table.sendGateResult} = 'not_checked' AND ${table.sendGateCheckedAt} IS NULL)
        OR (${table.sendGateResult} <> 'not_checked' AND ${table.sendGateCheckedAt} IS NOT NULL)`
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
    aiRunAttemptId: uuid("ai_run_attempt_id"),
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
    attemptCreatedIdx: index("ai_run_spans_attempt_created_idx")
      .on(table.aiRunAttemptId, table.createdAt)
      .where(sql`${table.aiRunAttemptId} IS NOT NULL`),
    attemptRunFk: foreignKey({
      name: "ai_run_spans_attempt_run_fkey",
      columns: [table.aiRunAttemptId, table.aiRunId],
      foreignColumns: [aiRunAttempts.id, aiRunAttempts.aiRunId]
    }).onDelete("restrict"),
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
    expiryCheck: check("ai_run_spans_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`)
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
    messageIdx: index("manager_notification_outbox_message_id_idx").on(table.conversationMessageId),
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

export const aiQualityEvents = pgTable(
  "ai_quality_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    aiRunAttemptId: uuid("ai_run_attempt_id"),
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
    attemptCreatedIdx: index("ai_quality_events_attempt_created_idx")
      .on(table.aiRunAttemptId, table.createdAt)
      .where(sql`${table.aiRunAttemptId} IS NOT NULL`),
    attemptRunFk: foreignKey({
      name: "ai_quality_events_attempt_run_fkey",
      columns: [table.aiRunAttemptId, table.aiRunId],
      foreignColumns: [aiRunAttempts.id, aiRunAttempts.aiRunId]
    }).onDelete("restrict"),
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
        'semantic_verifier_error',
        'turn_timeout',
        'empty_model_response',
        'unsafe_model_response',
        'grounding_validation_failed',
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
    managerProviderIdx: uniqueIndex("manager_telegram_bindings_manager_provider_idx")
      .on(table.managerUserId, table.provider, table.providerAccountId)
      .where(sql`${table.status} = 'active'`),
    chatUniqueIdx: uniqueIndex("manager_telegram_bindings_chat_unique_idx")
      .on(table.provider, table.providerAccountId, table.externalChatId)
      .where(sql`${table.status} = 'active'`)
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
    onePendingIdx: uniqueIndex("manager_telegram_reply_contexts_one_pending_idx")
      .on(table.managerUserId)
      .where(sql`${table.status} = 'pending'`)
  })
);
