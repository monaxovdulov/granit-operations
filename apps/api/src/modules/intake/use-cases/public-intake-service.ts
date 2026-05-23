import { randomUUID } from "node:crypto";

import {
  PUBLIC_INTAKE_CONTRACT_VERSION,
  SUPPORTED_PUBLIC_INTAKE_VERSIONS,
  SiteFormIntakeRequestSchema,
  type PublicIntakeResponse,
  type PublicValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";

import {
  IdempotencyConflictError,
  type IntakeRepository
} from "../../conversations/repositories/intake-repository.js";

export type PublicIntakeServiceResult = {
  statusCode: number;
  body: PublicIntakeResponse;
};

export class PublicIntakeService {
  constructor(private readonly repository: IntakeRepository) {}

  async acceptSiteFormSubmission(rawBody: unknown): Promise<PublicIntakeServiceResult> {
    const schemaVersion = readSchemaVersion(rawBody);

    if (!schemaVersion) {
      return validationError([{ path: "schema_version", message: "schema_version is required" }]);
    }

    if (schemaVersion !== PUBLIC_INTAKE_CONTRACT_VERSION) {
      return {
        statusCode: 422,
        body: {
          ok: false,
          schema_version: schemaVersion,
          error: {
            type: "unsupported_version",
            code: "unsupported_schema_version",
            action: "show_fallback_contact",
            supported_versions: [...SUPPORTED_PUBLIC_INTAKE_VERSIONS]
          }
        }
      };
    }

    const parsed = SiteFormIntakeRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      );
    }

    const requestFingerprint = sha256Hex(stableStringify(parsed.data));

    try {
      const saved = await this.repository.saveAcceptedSiteFormSubmission({
        publicSubmissionId: randomUUID(),
        request: parsed.data,
        requestFingerprint
      });

      return {
        statusCode: 202,
        body: {
          ok: true,
          schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
          status: saved.replayed ? "replayed" : "accepted",
          public_submission_id: saved.publicSubmissionId,
          action: "show_thank_you"
        }
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return validationError(
          [
            {
              path: "idempotency_key",
              message: "idempotency_key was already used for a different submission"
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
          schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
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
  fields: PublicValidationIssue[],
  code: "invalid_request" | "idempotency_conflict" = "invalid_request",
  statusCode = 400
): PublicIntakeServiceResult {
  return {
    statusCode,
    body: {
      ok: false,
      schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
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
