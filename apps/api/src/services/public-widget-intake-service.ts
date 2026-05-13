import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SUPPORTED_SITE_WIDGET_VERSIONS,
  SiteWidgetMessageRequestSchema,
  type SiteWidgetResponse,
  type SiteWidgetValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";

import {
  IdempotencyConflictError,
  type IntakeRepository
} from "../repositories/intake-repository.js";

export type PublicWidgetIntakeServiceResult = {
  statusCode: number;
  body: SiteWidgetResponse;
};

export class PublicWidgetIntakeService {
  constructor(private readonly repository: IntakeRepository) {}

  async acceptSiteWidgetMessage(rawBody: unknown): Promise<PublicWidgetIntakeServiceResult> {
    const schemaVersion = readSchemaVersion(rawBody);

    if (!schemaVersion) {
      return validationError([{ path: "schema_version", message: "schema_version is required" }]);
    }

    if (schemaVersion !== SITE_WIDGET_CONTRACT_VERSION) {
      return {
        statusCode: 422,
        body: {
          ok: false,
          schema_version: schemaVersion,
          error: {
            type: "unsupported_version",
            code: "unsupported_schema_version",
            action: "show_fallback_contact",
            supported_versions: [...SUPPORTED_SITE_WIDGET_VERSIONS]
          }
        }
      };
    }

    const parsed = SiteWidgetMessageRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      );
    }

    const requestFingerprint = sha256Hex(stableStringify(parsed.data));
    const publicSessionId = parsed.data.public_session_id ?? randomUUID();

    try {
      const saved = await this.repository.saveAcceptedSiteWidgetMessage({
        publicMessageId: randomUUID(),
        publicSessionId,
        request: parsed.data,
        requestFingerprint
      });

      return {
        statusCode: 202,
        body: {
          ok: true,
          schema_version: SITE_WIDGET_CONTRACT_VERSION,
          status: saved.replayed ? "replayed" : "accepted",
          public_session_id: saved.publicSessionId,
          public_message_id: saved.publicMessageId,
          action: "show_widget_saved",
          automation: {
            status: "disabled",
            next_step: "manager_review"
          },
          message_to_user: "Сообщение принято. Менеджер увидит его в панели."
        }
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return validationError(
          [
            {
              path: "idempotency_key",
              message: "idempotency_key was already used for a different widget message"
            }
          ],
          "idempotency_conflict",
          409
        );
      }

      return {
        statusCode: 503,
        body: {
          ok: false,
          schema_version: SITE_WIDGET_CONTRACT_VERSION,
          error: {
            type: "retryable_backend_failure",
            code: "persistence_unconfirmed",
            action: "retry_or_show_fallback",
            retry_after_seconds: 30
          }
        }
      };
    }
  }
}

function validationError(
  fields: SiteWidgetValidationIssue[],
  code: "invalid_request" | "idempotency_conflict" = "invalid_request",
  statusCode = 400
): PublicWidgetIntakeServiceResult {
  return {
    statusCode,
    body: {
      ok: false,
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
      error: {
        type: "validation",
        code,
        action: "show_validation_errors",
        fields
      }
    }
  };
}

function readSchemaVersion(rawBody: unknown): string | null {
  if (!rawBody || typeof rawBody !== "object" || !("schema_version" in rawBody)) {
    return null;
  }

  const value = (rawBody as { schema_version?: unknown }).schema_version;
  return typeof value === "string" ? value : null;
}
