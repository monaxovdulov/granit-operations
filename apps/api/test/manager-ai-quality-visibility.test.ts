import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";
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
    const generateDecision = async () => {
      throw new Error(
        "P3_RAW_PROVIDER_ERROR_MUST_NOT_REACH_MANAGER traceId spans provider-secret"
      );
    };
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          directLiveV2: {
            generator: { generateDecision },
            modelName: "gpt-5.6-luna",
            approvedFacts: TEST_LIVE_V2_FACTS
          },
          jobWorker: testJobWorkerOptions()
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
        status: "processing",
        next_step: "poll_history"
      }
    });
    await waitForTerminalHistory(app, response.json().public_session_id);

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
      eventType: "runtime_failure",
      reasonCode: "runtime_failed",
      severity: "critical",
      runStatus: "fallback_unavailable"
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

function testJobWorkerOptions() {
  return {
    enabled: true,
    pollIntervalMs: 10,
    leaseMs: 5_000,
    retryBackoffMs: 10,
    maxAttempts: 1
  };
}

async function waitForTerminalHistory(
  app: ReturnType<typeof buildApi>,
  publicSessionId: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${publicSessionId}/history?schema_version=site_widget.history.v2`
    });
    const status = response.json().messages?.[0]?.automation?.status;
    if (status && !["pending", "processing", "retrying"].includes(status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for degraded AI turn");
}

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
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
