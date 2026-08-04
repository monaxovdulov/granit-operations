import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { SiteWidgetMessageRequest } from "@granit/contracts";

import {
  AI_TURN_CONTEXT_MAX_CHARACTERS,
  AI_TURN_CONTEXT_CURSOR_VERSION,
  AI_TURN_CONTEXT_MAX_MESSAGES,
  buildBoundedAiTurnContext,
  type AiTurnContextMessage
} from "../src/modules/ai/ai-turn.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

describe("bounded AI turn context", () => {
  it("keeps the Postgres replay cursor causal instead of ordering equal timestamps by random UUID", () => {
    const source = readFileSync(
      new URL(
        "../src/modules/conversations/repositories/postgres-intake-repository.ts",
        import.meta.url
      ),
      "utf8"
    );

    expect(AI_TURN_CONTEXT_CURSOR_VERSION).toBe("conversation_updated_at.v1");
    expect(source).toContain("updatedAt: nextConversationMessageTimestamp()");
    expect(source).toContain("MAX(${conversationMessages.createdAt})");
    expect(source).toContain("lt(conversationMessages.createdAt, anchor.createdAt)");
    expect(source).not.toContain("lt(conversationMessages.id, anchor.id)");
  });

  it("keeps the current inbound exactly once and returns the newest bounded window oldest-first", () => {
    const current = inboundMessage("current", "current text", "2026-07-14T10:04:00.000Z");
    const messages = buildBoundedAiTurnContext({
      currentInboundMessage: current,
      previousMessagesNewestFirst: [
        outboundMessage("reply-2", "second reply", "2026-07-14T10:03:00.000Z"),
        current,
        inboundMessage("inbound-2", "second question", "2026-07-14T10:02:00.000Z"),
        outboundMessage("reply-1", "first reply", "2026-07-14T10:01:00.000Z")
      ],
      maxMessages: 3,
      maxCharacters: 1_000
    });

    expect(messages.map((message) => message.publicMessageId)).toEqual([
      "inbound-2",
      "reply-2",
      "current"
    ]);
    expect(messages).toHaveLength(3);
    expect(messages.filter((message) => message.publicMessageId === "current")).toHaveLength(1);
  });

  it("stops at the character boundary without dropping the accepted inbound", () => {
    const current = inboundMessage("current", "1234", "2026-07-14T10:04:00.000Z");

    expect(
      buildBoundedAiTurnContext({
        currentInboundMessage: current,
        previousMessagesNewestFirst: [
          outboundMessage("too-large", "12", "2026-07-14T10:03:00.000Z"),
          inboundMessage("older-small", "1", "2026-07-14T10:02:00.000Z")
        ],
        maxMessages: AI_TURN_CONTEXT_MAX_MESSAGES,
        maxCharacters: 5
      })
    ).toEqual([current]);

    expect(() =>
      buildBoundedAiTurnContext({
        currentInboundMessage: current,
        previousMessagesNewestFirst: [],
        maxCharacters: 3
      })
    ).toThrow("accepted inbound message exceeds the AI turn context character limit");
    expect(AI_TURN_CONTEXT_MAX_CHARACTERS).toBeGreaterThanOrEqual(4_000);
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
    expect(JSON.stringify(first.aiTurnInput)).not.toContain(first.inboundMessageId);
    expect(JSON.stringify(first.aiTurnInput)).not.toContain("+79990000000");
    expect(JSON.stringify(first.aiTurnInput)).not.toContain("visitor@example.com");

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

    expect(outbound.internalMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

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

    expect(second.aiTurnInput?.compactContext.messages).toEqual([
      inboundMessage(
        first.publicMessageId,
        "Нужен памятник из гранита",
        "2026-07-14T10:00:00.000Z"
      ),
      outboundMessage(
        outbound.publicMessageId,
        "Какой формат памятника вы рассматриваете?",
        outbound.createdAt
      ),
      inboundMessage(
        second.publicMessageId,
        "Вертикальный, строгой формы",
        "2026-07-14T10:01:00.000Z"
      )
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
    expect(firstReplay.aiTurnInput?.compactContext.messages).toEqual([
      inboundMessage(
        first.publicMessageId,
        "Нужен памятник из гранита",
        "2026-07-14T10:00:00.000Z"
      )
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

function inboundMessage(
  publicMessageId: string,
  text: string,
  submittedAt: string
): AiTurnContextMessage & { direction: "inbound"; senderRole: "visitor" } {
  return {
    publicMessageId,
    direction: "inbound",
    senderRole: "visitor",
    contentType: "text",
    submittedAt,
    text
  };
}

function outboundMessage(
  publicMessageId: string,
  text: string,
  submittedAt: string
): AiTurnContextMessage {
  return {
    publicMessageId,
    direction: "outbound",
    senderRole: "ai_assistant",
    contentType: "text",
    submittedAt,
    text
  };
}
