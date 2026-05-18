import { z } from "zod";

export const SITE_WIDGET_CONTRACT_VERSION = "site_widget.v1" as const;
export const SITE_WIDGET_MESSAGE_EVENT_TYPE = "site_widget.message_submitted" as const;
export const SUPPORTED_SITE_WIDGET_VERSIONS = [SITE_WIDGET_CONTRACT_VERSION] as const;

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

export const SiteWidgetMessageRequestSchema = z
  .object({
    schema_version: z.literal(SITE_WIDGET_CONTRACT_VERSION),
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

export const SiteWidgetAutomationSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("disabled"),
        next_step: z.literal("manager_review")
      })
      .strict(),
    z
      .object({
        status: z.literal("fallback"),
        next_step: z.literal("manager_review"),
        reason: z.enum([
          "missing_openai_config",
          "model_error",
          "empty_model_response",
          "unsafe_model_response",
          "agent_reply_blocked",
          "ai_persistence_unconfirmed"
        ])
      })
      .strict(),
    z
      .object({
        status: z.literal("replied"),
        next_step: z.literal("ai_reply_shown"),
        disclosure: z
          .object({
            shown: z.literal(true),
            version: z.string().min(1).max(120),
            text: z.string().min(1).max(1000)
          })
          .strict(),
        reply: z
          .object({
            public_message_id: z.string().uuid(),
            sender_role: z.literal("ai_assistant"),
            text: z.string().min(1).max(1000)
          })
          .strict()
      })
      .strict()
  ]);

export const SiteWidgetSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    schema_version: z.literal(SITE_WIDGET_CONTRACT_VERSION),
    status: z.enum(["accepted", "replayed"]),
    public_session_id: z.string().uuid(),
    public_message_id: z.string().uuid(),
    action: z.literal("show_widget_saved"),
    automation: SiteWidgetAutomationSchema,
    message_to_user: z.string()
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
    schema_version: z.literal(SITE_WIDGET_CONTRACT_VERSION),
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
        supported_versions: z.array(z.literal(SITE_WIDGET_CONTRACT_VERSION))
      })
      .strict()
  })
  .strict();

export const SiteWidgetRetryableErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.literal(SITE_WIDGET_CONTRACT_VERSION),
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
    schema_version: z.literal(SITE_WIDGET_CONTRACT_VERSION),
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
  SiteWidgetSuccessResponseSchema,
  SiteWidgetValidationErrorResponseSchema,
  SiteWidgetUnsupportedVersionResponseSchema,
  SiteWidgetRetryableErrorResponseSchema,
  SiteWidgetFallbackErrorResponseSchema
]);

export type SiteWidgetUtm = z.infer<typeof SiteWidgetUtmSchema>;
export type SiteWidgetMessageRequest = z.infer<typeof SiteWidgetMessageRequestSchema>;
export type SiteWidgetSuccessResponse = z.infer<typeof SiteWidgetSuccessResponseSchema>;
export type SiteWidgetResponse = z.infer<typeof SiteWidgetResponseSchema>;
export type SiteWidgetValidationIssue = z.infer<typeof SiteWidgetValidationIssueSchema>;
