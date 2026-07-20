import { describe, expect, it } from "vitest";

import { sanitizeAiObservabilityMetadata } from "../src/modules/ai/observability/ai-observability-sanitizer.js";

describe("AI observability metadata sanitizer", () => {
  it("keeps approved operational metadata and drops raw sensitive fields", () => {
    const sanitized = sanitizeAiObservabilityMetadata({
      model_name: "p3-manager-fake",
      prompt_version: "p3_prompt.v1",
      policy_version: "p3_policy.v1",
      verifier_usage: { input_tokens: 12, output_tokens: 7 },
      raw_error: "P3_RAW_PROVIDER_ERROR_MUST_NOT_REACH_MANAGER",
      traceId: "trace-secret",
      provider_email: "visitor@example.com",
      openai_response_id: "resp_01SAFE",
      generator_usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        Authorization: "Bearer sk-test-secret"
      },
      verifier_violations: ["unsupported_claim", "visitor@example.com"],
      public_session_id: "550e8400-e29b-41d4-a716-446655440000"
    });

    expect(sanitized).toEqual({
      model_name: "p3-manager-fake",
      prompt_version: "p3_prompt.v1",
      policy_version: "p3_policy.v1",
      verifier_usage: { input_tokens: 12, output_tokens: 7 },
      openai_response_id: "resp_01SAFE",
      generator_usage: {
        prompt_tokens: 12,
        completion_tokens: 6
      },
      verifier_violations: ["unsupported_claim"],
      public_session_id: "550e8400-e29b-41d4-a716-446655440000"
    });
  });
});
