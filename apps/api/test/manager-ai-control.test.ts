import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";
import {
  MemoryManagerAuthRepository,
  testManagerAuthConfig
} from "./helpers/memory-manager-auth-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("manager AI controls", () => {
  it("reads and changes the global control with optimistic concurrency", async () => {
    const repository = new MemoryIntakeRepository();
    const authRepository = new MemoryManagerAuthRepository("manager");
    const app = track(
      buildApi({
        repository,
        managerAuth: { repository: authRepository, config: testManagerAuthConfig() }
      })
    );
    const cookie = authRepository.createSessionCookie();

    const initial = await app.inject({
      method: "GET",
      url: "/manager/ai-control",
      headers: { cookie }
    });
    const disabled = await app.inject({
      method: "PATCH",
      url: "/manager/ai-control",
      headers: { cookie },
      payload: { enabled: false, version: 1 }
    });
    const stale = await app.inject({
      method: "PATCH",
      url: "/manager/ai-control",
      headers: { cookie },
      payload: { enabled: true, version: 1 }
    });

    expect(initial.statusCode).toBe(200);
    expect(initial.json().control).toMatchObject({ enabled: true, version: 1 });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().control).toMatchObject({
      enabled: false,
      version: 2,
      changedByManagerEmail: "owner@yandex.ru"
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "ai_control_version_conflict" });
  });

  it("does not call the generator while the global control is stopped", async () => {
    const repository = new MemoryIntakeRepository();
    const authRepository = new MemoryManagerAuthRepository("manager");
    const generateReply = vi.fn(async () => replyCandidate());
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator: { generateReply }
        },
        managerAuth: { repository: authRepository, config: testManagerAuthConfig() }
      })
    );
    const cookie = authRepository.createSessionCookie();

    const disabled = await app.inject({
      method: "PATCH",
      url: "/manager/ai-control",
      headers: { cookie },
      payload: { enabled: false, version: 1 }
    });
    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("manager-ai-global-stop-0001")
    });

    expect(disabled.statusCode).toBe(200);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: {
        status: "fallback",
        next_step: "manager_review",
        reason: "agent_reply_blocked"
      }
    });
    expect(generateReply).not.toHaveBeenCalled();
    expect(repository.onlyLead().conversations[0]?.agentAllowedToReply).toBe(true);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("stops and resumes AI for one conversation without replaying old inbound", async () => {
    const repository = new MemoryIntakeRepository();
    const authRepository = new MemoryManagerAuthRepository("manager");
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator: { async generateReply() { return replyCandidate(); } }
        },
        managerAuth: { repository: authRepository, config: testManagerAuthConfig() }
      })
    );
    const cookie = authRepository.createSessionCookie();

    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("manager-ai-control-dialog-0001")
    });
    const lead = repository.onlyLead();
    const conversation = lead.conversations[0];

    if (!conversation) {
      throw new Error("expected widget conversation");
    }

    const stopped = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${lead.leadId}/conversations/${conversation.publicConversationId}/ai-control`,
      headers: { cookie },
      payload: { enabled: false }
    });
    const resumed = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${lead.leadId}/conversations/${conversation.publicConversationId}/ai-control`,
      headers: { cookie },
      payload: { enabled: true }
    });

    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().lead.conversations[0]).toMatchObject({
      agentAllowedToReply: false,
      aiState: "manager_active"
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().lead.conversations[0]).toMatchObject({
      agentAllowedToReply: true,
      aiState: "ai_collecting_info"
    });
    expect(resumed.json().lead.conversations[0].messages).toHaveLength(2);
    expect(resumed.json().lead.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "conversation.ai_control_changed",
          metadata: expect.objectContaining({ enabled: true })
        })
      ])
    );
  });

  it("denies mutations to viewers and rejects malformed payloads", async () => {
    const repository = new MemoryIntakeRepository();
    const viewerAuthRepository = new MemoryManagerAuthRepository("viewer");
    const ownerAuthRepository = new MemoryManagerAuthRepository("owner");
    const app = track(
      buildApi({
        repository,
        managerAuth: { repository: viewerAuthRepository, config: testManagerAuthConfig() }
      })
    );
    const viewerCookie = viewerAuthRepository.createSessionCookie();

    const forbidden = await app.inject({
      method: "PATCH",
      url: "/manager/ai-control",
      headers: { cookie: viewerCookie },
      payload: { enabled: false, version: 1 }
    });

    await app.close();
    openApps.pop();
    const ownerApp = track(
      buildApi({
        repository: new MemoryIntakeRepository(),
        managerAuth: { repository: ownerAuthRepository, config: testManagerAuthConfig() }
      })
    );
    const ownerCookie = ownerAuthRepository.createSessionCookie();
    const invalid = await ownerApp.inject({
      method: "PATCH",
      url: "/manager/ai-control",
      headers: { cookie: ownerCookie },
      payload: { enabled: "no", version: 0 }
    });

    expect(forbidden.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(400);
  });
});

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function replyCandidate() {
  return {
    decision: "reply_candidate" as const,
    text: "Могу помочь собрать детали заявки.",
    action: "answer" as const,
    intent: "general_question" as const,
    metadata: {
      grounding_verified: true
    }
  };
}

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-16T10:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "manager-ai-control-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}
