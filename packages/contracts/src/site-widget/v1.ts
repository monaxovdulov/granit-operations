import { z } from "zod";

export const SITE_WIDGET_V2_CONTRACT_VERSION = "site_widget.v2" as const;
export const SITE_WIDGET_MESSAGE_EVENT_TYPE = "site_widget.message_submitted" as const;
export const SUPPORTED_SITE_WIDGET_VERSIONS = [
  SITE_WIDGET_V2_CONTRACT_VERSION
] as const;

const optionalTrimmed = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(maxLength).optional()
  );

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().email().max(254).optional()
);

export const SiteWidgetUtmSchema = z
  .object({
    source: optionalTrimmed(160),
    medium: optionalTrimmed(160),
    campaign: optionalTrimmed(160),
    term: optionalTrimmed(160),
    content: optionalTrimmed(160)
  })
  .strict();

export const SiteWidgetSourceSchema = z
  .object({
    channel: z.literal("site_widget"),
    page_url: z.string().trim().url().max(2048),
    widget_instance_id: z.string().trim().min(1).max(120),
    page_title: optionalTrimmed(240),
    referrer_url: z.string().trim().url().max(2048).optional(),
    utm: SiteWidgetUtmSchema.optional()
  })
  .strict();

export const SiteWidgetContactSchema = z
  .object({
    name: optionalTrimmed(120),
    phone: optionalTrimmed(64),
    email: optionalEmail,
    preferred_contact: z.enum(["phone", "whatsapp", "telegram", "email"]).optional(),
    city: optionalTrimmed(120)
  })
  .strict()
  .optional();

export const SiteWidgetMessageSchema = z
  .object({
    role: z.literal("visitor"),
    text: z.string().trim().min(1).max(4000)
  })
  .strict();

export const SiteWidgetVisitorContextSchema = z
  .object({
    locale: optionalTrimmed(32),
    timezone: optionalTrimmed(80)
  })
  .strict()
  .optional();

export const SiteWidgetConsentSchema = z
  .object({
    privacy_policy: z.boolean().optional()
  })
  .strict()
  .optional();

export const SiteWidgetV2MessageRequestSchema = z
  .object({
    schema_version: z.literal(SITE_WIDGET_V2_CONTRACT_VERSION),
    event_type: z.literal(SITE_WIDGET_MESSAGE_EVENT_TYPE),
    idempotency_key: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    submitted_at: z.string().datetime({ offset: true }),
    public_session_id: z.string().uuid().optional(),
    source: SiteWidgetSourceSchema,
    contact: SiteWidgetContactSchema,
    message: SiteWidgetMessageSchema,
    visitor_context: SiteWidgetVisitorContextSchema,
    consent: SiteWidgetConsentSchema
  })
  .strict();

export const AnySiteWidgetMessageRequestSchema = SiteWidgetV2MessageRequestSchema;

export const SiteWidgetCatalogReferenceSchema = z
  .object({
    kind: z.literal("catalog_item"),
    label: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(160),
    href: z
      .string()
      .max(2048)
      .regex(
        /^\/catalog\.html\?section=[a-z0-9-]+&entity=ent_[a-f0-9]+#block-[a-z0-9-]+$/
      ),
    entity_id: z.string().regex(/^ent_[a-f0-9]+$/)
  })
  .strict();

export const SiteWidgetV2AutomationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("processing"),
      next_step: z.literal("poll_history"),
      conversation_state: z.literal("ai_active"),
      poll_after_ms: z.number().int().min(250).max(5000)
    })
    .strict(),
  z
    .object({
      status: z.literal("disabled"),
      next_step: z.literal("manager_review"),
      conversation_state: z.literal("manager_pending")
    })
    .strict(),
  z
    .object({
      status: z.literal("replied"),
      next_step: z.literal("history_available"),
      conversation_state: z.enum(["ai_active", "manager_pending"])
    })
    .strict(),
  z
    .object({
      status: z.literal("degraded"),
      next_step: z.literal("retry_or_manager"),
      conversation_state: z.literal("ai_active"),
      reason: z.enum([
        "missing_openai_config",
        "model_error",
        "empty_model_response",
        "unsafe_model_response",
        "semantic_verifier_error",
        "grounding_validation_failed",
        "turn_timeout",
        "ai_persistence_unconfirmed",
        "worker_failed"
      ])
    })
    .strict(),
  z
    .object({
      status: z.literal("manager_pending"),
      next_step: z.literal("manager_review"),
      conversation_state: z.enum(["manager_pending", "manager_active"]),
      reason: z.enum(["agent_reply_blocked", "handoff"])
    })
    .strict()
]);

export const SiteWidgetV2SuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    schema_version: z.literal(SITE_WIDGET_V2_CONTRACT_VERSION),
    status: z.enum(["accepted", "replayed"]),
    public_session_id: z.string().uuid(),
    public_conversation_id: z.string().uuid(),
    public_message_id: z.string().uuid(),
    submitted_at: z.string().datetime({ offset: true }),
    action: z.literal("show_widget_saved"),
    automation: SiteWidgetV2AutomationSchema,
    message_to_user: z.string().min(1).max(500)
  })
  .strict();

export const SiteWidgetValidationIssueSchema = z
  .object({
    path: z.string(),
    message: z.string()
  })
  .strict();

export const SiteWidgetValidationErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.enum(SUPPORTED_SITE_WIDGET_VERSIONS),
    error: z
      .object({
        type: z.literal("validation"),
        code: z.enum(["invalid_request", "idempotency_conflict"]),
        action: z.literal("show_validation_errors"),
        fields: z.array(SiteWidgetValidationIssueSchema)
      })
      .strict()
  })
  .strict();

export const SiteWidgetUnsupportedVersionResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.string(),
    error: z
      .object({
        type: z.literal("unsupported_version"),
        code: z.literal("unsupported_schema_version"),
        action: z.literal("show_fallback_contact"),
        supported_versions: z.array(z.enum(SUPPORTED_SITE_WIDGET_VERSIONS))
      })
      .strict()
  })
  .strict();

export const SiteWidgetRetryableErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.enum(SUPPORTED_SITE_WIDGET_VERSIONS),
    error: z
      .object({
        type: z.literal("retryable_backend_failure"),
        code: z.literal("persistence_unconfirmed"),
        action: z.literal("retry_or_show_fallback"),
        retry_after_seconds: z.number().int().positive()
      })
      .strict()
  })
  .strict();

export const SiteWidgetFallbackErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.enum(SUPPORTED_SITE_WIDGET_VERSIONS),
    error: z
      .object({
        type: z.literal("fallback_required"),
        code: z.literal("manual_contact_required"),
        action: z.literal("show_fallback_contact")
      })
      .strict()
  })
  .strict();

export const SiteWidgetResponseSchema = z.union([
  SiteWidgetV2SuccessResponseSchema,
  SiteWidgetValidationErrorResponseSchema,
  SiteWidgetUnsupportedVersionResponseSchema,
  SiteWidgetRetryableErrorResponseSchema,
  SiteWidgetFallbackErrorResponseSchema
]);

export type SiteWidgetUtm = z.infer<typeof SiteWidgetUtmSchema>;
export type SiteWidgetV2MessageRequest = z.infer<typeof SiteWidgetV2MessageRequestSchema>;
export type SiteWidgetMessageRequest = z.infer<typeof AnySiteWidgetMessageRequestSchema>;
export type SiteWidgetV2SuccessResponse = z.infer<typeof SiteWidgetV2SuccessResponseSchema>;
export type SiteWidgetCatalogReference = z.infer<typeof SiteWidgetCatalogReferenceSchema>;
export type SiteWidgetResponse = z.infer<typeof SiteWidgetResponseSchema>;
export type SiteWidgetValidationIssue = z.infer<typeof SiteWidgetValidationIssueSchema>;
