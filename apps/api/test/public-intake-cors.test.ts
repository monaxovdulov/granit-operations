import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const allowedOrigin = "https://preview.granitkr.ru";
const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function createApp(allowedOrigins: string[] = []) {
  const app = buildApi({
    repository: new MemoryIntakeRepository(),
    publicIntakeCors: { allowedOrigins }
  });
  openApps.push(app);
  return app;
}

describe("public intake CORS", () => {
  it("answers an exact-origin preflight with the narrow public policy", async () => {
    const response = await createApp([allowedOrigin]).inject({
      method: "OPTIONS",
      url: "/public/intake/site-widget/messages",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,accept"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(response.headers.vary).toBe("Origin");
    expect(response.headers["access-control-allow-methods"]?.split(/,\s*/)).toEqual([
      "GET",
      "POST",
      "OPTIONS"
    ]);
    expect(response.headers["access-control-allow-headers"]?.toLowerCase().split(/,\s*/)).toEqual([
      "content-type",
      "accept"
    ]);
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("adds exact-origin headers to an accepted POST", async () => {
    const response = await createApp([allowedOrigin]).inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      headers: {
        origin: allowedOrigin,
        accept: "application/json"
      },
      payload: validWidgetRequest()
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(response.headers.vary).toBe("Origin");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("does not grant CORS to a disallowed origin", async () => {
    const response = await createApp([allowedOrigin]).inject({
      method: "OPTIONS",
      url: "/public/intake/site-widget/messages",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("keeps no-Origin intake requests working when the allowlist is empty", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: validWidgetRequest()
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not expose manager routes through public intake CORS", async () => {
    const app = createApp([allowedOrigin]);
    const managerGet = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { origin: allowedOrigin }
    });
    const managerPreflight = await app.inject({
      method: "OPTIONS",
      url: "/manager/leads",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "GET"
      }
    });

    expect(managerGet.statusCode).toBe(401);
    expect(managerGet.headers["access-control-allow-origin"]).toBeUndefined();
    expect(managerPreflight.statusCode).toBe(404);
    expect(managerPreflight.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

function validWidgetRequest(): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: "widget-cors-test-0001",
    submitted_at: "2026-07-13T10:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://preview.granitkr.ru/?site-widget-rc=test",
      widget_instance_id: "landing-main",
      page_title: "Widget CORS test"
    },
    message: {
      role: "visitor",
      text: "Staging CORS test"
    },
    visitor_context: {
      locale: "ru-RU",
      timezone: "Europe/Moscow"
    },
    consent: {
      privacy_policy: true
    }
  };
}
