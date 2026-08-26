import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { SiteWidgetMessageRequest } from "@granit/contracts";

import {
  AI_TURN_CONTEXT_CURSOR_VERSION
} from "../src/modules/ai/ai-turn.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

describe("AI turn conversation context", () => {
  it("keeps the Postgres model transcript causal by message sequence", () => {
    const source = readFileSync(
      new URL(
        "../src/modules/conversations/repositories/postgres-intake-repository.ts",
        import.meta.url
      ),
      "utf8"
    );

    expect(AI_TURN_CONTEXT_CURSOR_VERSION).toBe("message_sequence.v1");
    expect(source).toContain("lte(conversationMessages.messageSequence, respondsThroughSequence)");
    expect(source).toContain("orderBy(desc(conversationMessages.messageSequence))");
  });

  it("keeps persistence IDs app-only and builds replay-stable persisted dialog history", async () => {
    const repository = new MemoryIntakeRepository();
    const publicSessionId = "00000000-0000-4000-8000-000000000101";
    const first = await repository.saveAcceptedSiteWidgetMessage({
      publicMessageId: "00000000-0000-4000-8000-000000000201",
      publicSessionId,
      agentAllowedToReply: true,
      request: widgetRequest({
        publicSessionId,
        idempotencyKey: "context-first-message-0001",
        submittedAt: "2026-07-14T10:00:00.000Z",
        text: "Нужен памятник из гранита"
      }),
      requestFingerprint: "first-request-fingerprint"
    });

    expect(first.aiTurnExecutionContext).toMatchObject({
      internal: {
        leadId: first.leadId,
        conversationId: first.conversationId,
        inboundMessageId: first.inboundMessageId
      },
      public: {
        conversationId: first.publicConversationId,
        inboundMessageId: first.publicMessageId
      },
      turn: {
        idempotencyKey: `ai-turn:${first.publicMessageId}`,
        acceptedRequestFingerprint: "first-request-fingerprint"
      }
    });
    const firstModelView = JSON.stringify(buildLiveV2TurnView(first.aiTurnInput!));
    expect(firstModelView).not.toContain(first.inboundMessageId);
    expect(firstModelView).not.toContain("+79990000000");
    expect(firstModelView).not.toContain("visitor@example.com");
    expect(firstModelView).not.toContain("Контекстный посетитель");

    const outbound = await repository.saveSiteWidgetAiMessage({
      leadId: first.leadId,
      conversationId: first.conversationId,
      publicMessageId: "00000000-0000-4000-8000-000000000301",
      inboundPublicMessageId: first.publicMessageId,
      idempotencyKey: `ai:${first.publicMessageId}`,
      requestFingerprint: "first-outbound-fingerprint",
      expectedGenerationEpoch: first.turnIdentity!.expectedGenerationEpoch,
      respondsThroughSequence: first.turnIdentity!.respondsThroughSequence,
      body: "Какой формат памятника вы рассматриваете?",
      sourcePageUrl: "https://granit.example/catalog",
      metadata: {}
    });

    const secondInput = {
      publicMessageId: "00000000-0000-4000-8000-000000000202",
      publicSessionId,
      agentAllowedToReply: true,
      request: widgetRequest({
        publicSessionId,
        idempotencyKey: "context-second-message-0002",
        submittedAt: "2026-07-14T10:01:00.000Z",
        text: "Вертикальный, строгой формы"
      }),
      requestFingerprint: "second-request-fingerprint"
    };
    const second = await repository.saveAcceptedSiteWidgetMessage(secondInput);

    expect(second.aiTurnInput?.compactContext.messages.map((message) => message.text)).toEqual([
      "Нужен памятник из гранита",
      "Какой формат памятника вы рассматриваете?"
    ]);
    expect(
      buildLiveV2TurnView(second.aiTurnInput!).messages.map((message) => message.text)
    ).toEqual([
      "Нужен памятник из гранита",
      "Какой формат памятника вы рассматриваете?",
      "Вертикальный, строгой формы"
    ]);

    await repository.saveAcceptedSiteWidgetMessage({
      publicMessageId: "00000000-0000-4000-8000-000000000203",
      publicSessionId,
      agentAllowedToReply: true,
      request: widgetRequest({
        publicSessionId,
        idempotencyKey: "context-third-message-0003",
        submittedAt: "2026-07-14T10:02:00.000Z",
        text: "Добавьте полированную поверхность"
      }),
      requestFingerprint: "third-request-fingerprint"
    });

    const replay = await repository.saveAcceptedSiteWidgetMessage(secondInput);
    expect(replay.replayed).toBe(true);
    expect(replay.inboundMessageId).toBe(second.inboundMessageId);
    expect(replay.aiTurnExecutionContext).toEqual(second.aiTurnExecutionContext);
    expect(replay.aiTurnInput?.compactContext).toEqual(second.aiTurnInput?.compactContext);
    expect(JSON.stringify(replay.aiTurnInput?.compactContext)).not.toContain(
      "Добавьте полированную поверхность"
    );

    const firstReplay = await repository.saveAcceptedSiteWidgetMessage({
      publicMessageId: first.publicMessageId,
      publicSessionId,
      agentAllowedToReply: true,
      request: widgetRequest({
        publicSessionId,
        idempotencyKey: "context-first-message-0001",
        submittedAt: "2026-07-14T10:00:00.000Z",
        text: "Нужен памятник из гранита"
      }),
      requestFingerprint: "first-request-fingerprint"
    });
    expect(firstReplay.aiTurnInput?.compactContext.messages).toEqual([]);
    expect(buildLiveV2TurnView(firstReplay.aiTurnInput!).messages).toEqual([
      { role: "visitor", text: "Нужен памятник из гранита" }
    ]);
  });
});

function widgetRequest(input: {
  publicSessionId: string;
  idempotencyKey: string;
  submittedAt: string;
  text: string;
}): SiteWidgetMessageRequest {
  return {
    schema_version: "site_widget.v2",
    event_type: "site_widget.message_submitted",
    idempotency_key: input.idempotencyKey,
    submitted_at: input.submittedAt,
    public_session_id: input.publicSessionId,
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog",
      widget_instance_id: "context-test-widget"
    },
    contact: {
      name: "Контекстный посетитель",
      phone: "+79990000000",
      email: "visitor@example.com",
      preferred_contact: "phone"
    },
    message: {
      role: "visitor",
      text: input.text
    },
    consent: {
      privacy_policy: true
    }
  };
}
