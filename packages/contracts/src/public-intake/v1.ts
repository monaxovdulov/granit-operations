import { z } from "zod";

export const PUBLIC_INTAKE_CONTRACT_VERSION = "site_form.v1" as const;
export const PUBLIC_INTAKE_EVENT_TYPE = "site_form.submitted" as const;
export const SUPPORTED_PUBLIC_INTAKE_VERSIONS = [PUBLIC_INTAKE_CONTRACT_VERSION] as const;

const optionalTrimmed = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(maxLength).optional()
  );

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().email().max(254).optional()
);

export const SiteFormUtmSchema = z
  .object({
    source: optionalTrimmed(160),
    medium: optionalTrimmed(160),
    campaign: optionalTrimmed(160),
    term: optionalTrimmed(160),
    content: optionalTrimmed(160)
  })
  .strict();

export const SiteFormSourceSchema = z
  .object({
    channel: z.literal("site_form"),
    page_url: z.string().trim().url().max(2048),
    form_kind: z.string().trim().min(1).max(80),
    referrer_url: z.string().trim().url().max(2048).optional(),
    utm: SiteFormUtmSchema.optional()
  })
  .strict();

export const SiteFormContactSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: optionalTrimmed(64),
    email: optionalEmail,
    preferred_contact: z.enum(["phone", "whatsapp", "telegram", "email"]).optional(),
    city: optionalTrimmed(120)
  })
  .strict()
  .superRefine((contact, ctx) => {
    if (!contact.phone && !contact.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Provide at least phone or email"
      });
    }
  });

export const SiteFormRequestDetailsSchema = z
  .object({
    message: optionalTrimmed(4000),
    product_interest: optionalTrimmed(160)
  })
  .strict()
  .optional();

export const SiteFormConsentSchema = z
  .object({
    privacy_policy: z.boolean(),
    marketing: z.boolean().optional()
  })
  .strict()
  .optional();

export const SiteFormIntakeRequestSchema = z
  .object({
    schema_version: z.literal(PUBLIC_INTAKE_CONTRACT_VERSION),
    event_type: z.literal(PUBLIC_INTAKE_EVENT_TYPE),
    idempotency_key: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    submitted_at: z.string().datetime({ offset: true }),
    source: SiteFormSourceSchema,
    contact: SiteFormContactSchema,
    request: SiteFormRequestDetailsSchema,
    consent: SiteFormConsentSchema
  })
  .strict();

export const PublicIntakeSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    schema_version: z.literal(PUBLIC_INTAKE_CONTRACT_VERSION),
    status: z.enum(["accepted", "replayed"]),
    public_submission_id: z.string().uuid(),
    action: z.enum(["show_thank_you", "show_inline_success"])
  })
  .strict();

export const PublicValidationIssueSchema = z
  .object({
    path: z.string(),
    message: z.string()
  })
  .strict();

export const PublicIntakeValidationErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.literal(PUBLIC_INTAKE_CONTRACT_VERSION),
    error: z
      .object({
        type: z.literal("validation"),
        code: z.enum(["invalid_request", "idempotency_conflict"]),
        action: z.literal("show_validation_errors"),
        fields: z.array(PublicValidationIssueSchema)
      })
      .strict()
  })
  .strict();

export const PublicIntakeUnsupportedVersionResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.string(),
    error: z
      .object({
        type: z.literal("unsupported_version"),
        code: z.literal("unsupported_schema_version"),
        action: z.literal("show_fallback_contact"),
        supported_versions: z.array(z.literal(PUBLIC_INTAKE_CONTRACT_VERSION))
      })
      .strict()
  })
  .strict();

export const PublicIntakeRetryableErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.literal(PUBLIC_INTAKE_CONTRACT_VERSION),
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

export const PublicIntakeFallbackErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.literal(PUBLIC_INTAKE_CONTRACT_VERSION),
    error: z
      .object({
        type: z.literal("fallback_required"),
        code: z.literal("manual_contact_required"),
        action: z.literal("show_fallback_contact")
      })
      .strict()
  })
  .strict();

export const PublicIntakeResponseSchema = z.union([
  PublicIntakeSuccessResponseSchema,
  PublicIntakeValidationErrorResponseSchema,
  PublicIntakeUnsupportedVersionResponseSchema,
  PublicIntakeRetryableErrorResponseSchema,
  PublicIntakeFallbackErrorResponseSchema
]);

export type SiteFormUtm = z.infer<typeof SiteFormUtmSchema>;
export type SiteFormIntakeRequest = z.infer<typeof SiteFormIntakeRequestSchema>;
export type PublicIntakeSuccessResponse = z.infer<typeof PublicIntakeSuccessResponseSchema>;
export type PublicIntakeResponse = z.infer<typeof PublicIntakeResponseSchema>;
export type PublicValidationIssue = z.infer<typeof PublicValidationIssueSchema>;
