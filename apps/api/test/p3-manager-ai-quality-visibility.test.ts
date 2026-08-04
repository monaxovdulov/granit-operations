import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { aiQualityEvents, createOperationsDb } from "@granit/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import { PostgresAiRunRepository } from "../src/modules/ai/repositories/postgres-ai-run-repository.js";
import { PostgresIntakeRepository } from "../src/modules/conversations/repositories/postgres-intake-repository.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";
import {
  MemoryManagerAuthRepository,
  testManagerAuthConfig
} from "./helpers/memory-manager-auth-repository.js";

const RAW_PROVIDER_CANARY = "P3_RAW_PROVIDER_ERROR_MUST_NOT_REACH_MANAGER";
const openApps: Array<ReturnType<typeof buildApi>> = [];
const postgresConnectionString = process.env.P2_TEST_DATABASE_URL;
const postgresDescribe = postgresConnectionString ? describe.sequential : describe.skip;

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("P3 protected manager AI quality visibility", () => {
  it("shows only the latest controlled unresolved quality summary to an authenticated manager", async () => {
    const repository = new MemoryIntakeRepository();
    const managerAuthRepository = new MemoryManagerAuthRepository();
    const app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        modelName: "p3-manager-fake",
        provider: {
          providerKind: "fake",
          async generateReply() {
            throw new Error(RAW_PROVIDER_CANARY);
          }
        }
      },
      managerAuth: {
        repository: managerAuthRepository,
        config: testManagerAuthConfig()
      }
    });
    openApps.push(app);

    const intakeResponse = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest()
    });
    expect(intakeResponse.statusCode).toBe(202);
    expect(intakeResponse.json()).toMatchObject({
      automation: {
        status: "fallback",
        reason: "model_error",
        next_step: "manager_review"
      }
    });

    const leadId = repository.onlyLead().leadId;
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/manager/leads/${leadId}`
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toEqual({ error: "manager_auth_required" });

    const managerCookie = managerAuthRepository.createSessionCookie();
    const authenticated = await app.inject({
      method: "GET",
      url: `/manager/leads/${leadId}`,
      headers: { cookie: managerCookie }
    });
    expect(authenticated.statusCode).toBe(200);

    const quality = authenticated.json().lead.conversations[0]?.latestUnresolvedAiQuality;
    expect(quality).toEqual({
      eventType: "model_failure",
      reasonCode: "model_error",
      severity: "critical",
      runStatus: "fallback_unavailable",
      createdAt: expect.any(String)
    });
    expect(Object.keys(quality).sort()).toEqual([
      "createdAt",
      "eventType",
      "reasonCode",
      "runStatus",
      "severity"
    ]);

    const managerPayload = JSON.stringify(authenticated.json());
    expect(managerPayload).not.toContain(RAW_PROVIDER_CANARY);
    expect(managerPayload).not.toContain("traceId");
    expect(managerPayload).not.toContain("spans");
    expect(managerPayload).not.toContain("observedModelProvider");
    expect(JSON.stringify(quality)).not.toContain("metadata");

    const statusChanged = await app.inject({
      method: "PATCH",
      url: `/manager/leads/${leadId}/status`,
      headers: { cookie: managerCookie },
      payload: { status: "in_progress" }
    });
    expect(statusChanged.statusCode).toBe(200);
    expect(statusChanged.json().lead.conversations[0]?.latestUnresolvedAiQuality).toEqual(
      quality
    );
  });
});

postgresDescribe("P3 PostgreSQL latest unresolved AI quality selection", () => {
  const database = postgresConnectionString
    ? createOperationsDb(postgresConnectionString)
    : undefined;

  beforeEach(async () => {
    await database?.client.unsafe("TRUNCATE TABLE leads RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await database?.client.end();
  });

  it("ignores newer resolved and manager-hidden events without joining raw run evidence", async () => {
    if (!database) {
      throw new Error("P2_TEST_DATABASE_URL is required");
    }

    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    const app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        modelName: "p3-postgres-fake",
        provider: {
          providerKind: "fake",
          async generateReply() {
            throw new Error(RAW_PROVIDER_CANARY);
          }
        },
        runRepository
      }
    });
    openApps.push(app);

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest({ idempotencyKey: "p3-quality-postgres-0001" })
    });
    expect(first.json()).toMatchObject({
      automation: { status: "fallback", reason: "model_error" }
    });

    const eventRows = await database.db.select().from(aiQualityEvents);
    expect(eventRows).toHaveLength(1);
    const [openEvent] = eventRows;
    if (!openEvent) {
      throw new Error("expected one app-recorded quality event");
    }

    const openCreatedAt = new Date("2026-07-15T12:01:00.000Z");
    await database.db
      .update(aiQualityEvents)
      .set({ createdAt: openCreatedAt })
      .where(eq(aiQualityEvents.id, openEvent.id));
    await database.db.insert(aiQualityEvents).values([
      {
        aiRunId: openEvent.aiRunId,
        leadId: openEvent.leadId,
        conversationId: openEvent.conversationId,
        messageId: openEvent.messageId,
        eventType: "model_failure",
        reasonCode: "model_error",
        severity: "critical",
        createdAt: new Date("2026-07-15T12:02:00.000Z"),
        resolutionStatus: "resolved",
        resolutionCode: "recovered",
        resolvedAt: new Date("2026-07-15T12:03:00.000Z")
      },
      {
        aiRunId: openEvent.aiRunId,
        leadId: openEvent.leadId,
        conversationId: openEvent.conversationId,
        messageId: openEvent.messageId,
        eventType: "model_failure",
        reasonCode: "model_error",
        severity: "critical",
        createdAt: new Date("2026-07-15T12:04:00.000Z"),
        managerVisible: false
      }
    ]);

    const leadId = openEvent.leadId;
    if (!leadId) {
      throw new Error("expected quality lead id");
    }

    const detail = await repository.getManagerLead(leadId);
    expect(detail?.conversations[0]?.latestUnresolvedAiQuality).toEqual({
      eventType: "model_failure",
      reasonCode: "model_error",
      severity: "critical",
      runStatus: "fallback_unavailable",
      createdAt: openCreatedAt.toISOString()
    });
  });
});

function validWidgetRequest(
  overrides: { idempotencyKey?: string; publicSessionId?: string } = {}
): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: overrides.idempotencyKey ?? "p3-manager-quality-visibility-0001",
    submitted_at: "2026-07-15T12:00:00.000Z",
    public_session_id: overrides.publicSessionId,
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "floating-widget-v1"
    },
    message: {
      role: "visitor",
      text: "Покажите варианты памятника"
    },
    visitor_context: {
      locale: "ru-RU",
      timezone: "UTC"
    },
    consent: {
      privacy_policy: true
    }
  };
}
