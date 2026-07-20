import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import type { PublicWidgetAiReplyGenerator } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";
import {
  MemoryManagerAuthRepository,
  testManagerAuthConfig
} from "./helpers/memory-manager-auth-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("manager AI quality visibility", () => {
  it("surfaces degraded AI turns as safe manager summaries without raw observability", async () => {
    const repository = new MemoryIntakeRepository();
    const authRepository = new MemoryManagerAuthRepository("manager");
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        return {
          decision: "no_reply",
          reason: "model_error",
          metadata: {
            model_name: "p3-manager-fake",
            prompt_version: "p3_prompt.v1",
            raw_error: "P3_RAW_PROVIDER_ERROR_MUST_NOT_REACH_MANAGER",
            traceId: "trace-must-not-reach-manager",
            spans: [{ name: "provider.call", raw: "provider-secret" }]
          }
        };
      }
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator
        },
        managerAuth: {
          repository: authRepository,
          config: testManagerAuthConfig()
        }
      })
    );
    const managerCookie = authRepository.createSessionCookie();

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("manager-ai-quality-visible-0001")
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: {
        status: "degraded",
        reason: "model_error",
        next_step: "retry_available"
      }
    });

    const leadId = repository.onlyLead().leadId;
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/manager/leads/${leadId}`
    });
    const detail = await app.inject({
      method: "GET",
      url: `/manager/leads/${leadId}`,
      headers: { cookie: managerCookie }
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().lead.conversations[0].latestUnresolvedAiQuality).toMatchObject({
      eventType: "model_failure",
      reasonCode: "model_error",
      severity: "critical",
      runStatus: "degraded"
    });
    expect(
      Date.parse(detail.json().lead.conversations[0].latestUnresolvedAiQuality.createdAt)
    ).not.toBeNaN();

    const managerPayload = JSON.stringify(detail.json());
    expect(managerPayload).not.toContain("P3_RAW_PROVIDER_ERROR_MUST_NOT_REACH_MANAGER");
    expect(managerPayload).not.toContain("raw_error");
    expect(managerPayload).not.toContain("traceId");
    expect(managerPayload).not.toContain("spans");
    expect(managerPayload).not.toContain("provider-secret");
  });
});

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-20T10:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "manager-ai-quality-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}
