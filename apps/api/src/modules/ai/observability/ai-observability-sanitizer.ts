const ALLOWED_AI_METADATA_KEYS = new Set([
  "ai_decision_version",
  "ai_disclosure_shown",
  "ai_disclosure_version",
  "ai_input_fingerprint",
  "catalog_content_hash",
  "catalog_schema_version",
  "catalog_version",
  "channel",
  "claim_coverage_complete",
  "claim_verdict_count",
  "error_type",
  "fallback_mode",
  "generator_usage",
  "grounding_verified",
  "handoff_reason",
  "deterministic_policy_version",
  "fallback_reason",
  "inbound_public_message_id",
  "knowledge_version",
  "latency_ms",
  "model_name",
  "model_provider",
  "openai_response_id",
  "policy_version",
  "plan_normalization_reason",
  "plan_normalized",
  "plan_original_action",
  "plan_original_intent",
  "plan_original_requested_slots",
  "planner_source",
  "policy_reason",
  "prompt_version",
  "public_session_id",
  "repair_applied",
  "requirement_verdict_count",
  "render_reason",
  "reply_renderer",
  "safe_handoff_reply",
  "slot_verdict_count",
  "verifier_contract_issues",
  "verifier_model_name",
  "verifier_response_id",
  "verifier_usage",
  "verifier_verdict",
  "verifier_version",
  "verifier_violations"
]);

const SENSITIVE_STRING =
  /(?:sk-[a-z0-9_-]{8,}|bearer\s+|postgres(?:ql)?:\/\/|api[_-]?key|authorization)/i;
const UUID_STRING =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeAiObservabilityMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_AI_METADATA_KEYS.has(key)) {
      continue;
    }

    const safeValue = sanitizeValue(value, 0);

    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    return isSafeString(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    if (depth >= 3) {
      return undefined;
    }

    return value
      .slice(0, 50)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object" && value) {
    if (depth >= 3) {
      return undefined;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (!isSafeObjectKey(key)) {
        continue;
      }

      const safeValue = sanitizeValue(nestedValue, depth + 1);

      if (safeValue !== undefined) {
        sanitized[key] = safeValue;
      }
    }

    return sanitized;
  }

  return undefined;
}

function isSafeObjectKey(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) && !SENSITIVE_STRING.test(value);
}

function isSafeString(value: string): boolean {
  if (UUID_STRING.test(value)) {
    return true;
  }

  return (
    value.length <= 500 &&
    !SENSITIVE_STRING.test(value) &&
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) &&
    !/\d{7,}/.test(value) &&
    !/[\r\n\t]/.test(value)
  );
}
