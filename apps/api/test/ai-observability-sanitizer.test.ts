import { describe, expect, it } from "vitest";

import {
  sanitizeAiObservabilityMetadata,
  sanitizeAiRunStart
} from "../src/modules/ai/observability/ai-observability-sanitizer.js";

describe("AI observability metadata sanitizer", () => {
  it("keeps approved operational metadata and drops raw sensitive fields", () => {
    const sanitized = sanitizeAiObservabilityMetadata({
      model_name: "p3-manager-fake",
      prompt_version: "p3_prompt.v1",
      policy_version: "p3_policy.v1",
      reply_renderer: "app_owned",
      render_reason: "app_render_price_intake_clarify",
      plan_normalized: true,
      plan_normalization_reason: "commercial_intent_price_intake",
      plan_original_intent: "product_selection",
      plan_original_requested_slots: ["material"],
      planner_source: "deterministic_fallback",
      fallback_reason: "model_error",
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
      public_session_id: "550e8400-e29b-41d4-a716-446655440000",
      queue_wait_ms: 27,
      response_window_epoch: 0,
      responds_through_sequence: 3
    });

    expect(sanitized).toEqual({
      model_name: "p3-manager-fake",
      prompt_version: "p3_prompt.v1",
      policy_version: "p3_policy.v1",
      reply_renderer: "app_owned",
      render_reason: "app_render_price_intake_clarify",
      plan_normalized: true,
      plan_normalization_reason: "commercial_intent_price_intake",
      plan_original_intent: "product_selection",
      plan_original_requested_slots: ["material"],
      planner_source: "deterministic_fallback",
      fallback_reason: "model_error",
      verifier_usage: { input_tokens: 12, output_tokens: 7 },
      openai_response_id: "resp_01SAFE",
      generator_usage: {
        prompt_tokens: 12,
        completion_tokens: 6
      },
      verifier_violations: ["unsupported_claim"],
      public_session_id: "550e8400-e29b-41d4-a716-446655440000",
      queue_wait_ms: 27,
      response_window_epoch: 0,
      responds_through_sequence: 3
    });
  });

  it("drops malformed or out-of-range queue observability counters", () => {
    expect(
      sanitizeAiObservabilityMetadata({
        queue_wait_ms: -1,
        response_window_epoch: 1.5,
        responds_through_sequence: 0
      })
    ).toEqual({});
  });

  it("accepts the bounded durable-worker attempt identity and rejects attempt zero", () => {
    const input = {
      traceId: "550e8400-e29b-41d4-a716-446655440001",
      leadId: "550e8400-e29b-41d4-a716-446655440002",
      conversationId: "550e8400-e29b-41d4-a716-446655440003",
      inboundMessageId: "550e8400-e29b-41d4-a716-446655440004",
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: "ai-turn:550e8400-e29b-41d4-a716-446655440005:attempt:1",
      inputFingerprint: "a".repeat(64),
      versions: {
        policyVersion: "policy.v1",
        promptVersion: "prompt.v1",
        toolVersion: "tools.v1",
        disclosureVersion: "disclosure.v1",
        modelProfileVersion: "model.v1"
      },
      model: {
        modelProvider: "openai",
        requestedModelName: "gpt-5.6-luna",
        reasoningEffort: "medium"
      },
      startedAt: new Date("2026-08-05T00:00:00.000Z")
    };

    expect(sanitizeAiRunStart(input)).toMatchObject({
      idempotencyKey: input.idempotencyKey,
      decisionProfile: "live_v2"
    });
    expect(() =>
      sanitizeAiRunStart({
        ...input,
        idempotencyKey: "ai-turn:550e8400-e29b-41d4-a716-446655440005:attempt:0"
      })
    ).toThrow();
  });
});
