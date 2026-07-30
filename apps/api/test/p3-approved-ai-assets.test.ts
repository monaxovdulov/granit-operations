import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import {
  APPROVED_AI_ASSET_MANIFEST_VERSION,
  LEGACY_S05_ASSET_VERSION,
  loadApprovedAiAssetManifest,
  parseApprovedAiAssetManifest,
  selectLiveV2ApprovedAssets
} from "../src/modules/ai/assets/approved-ai-assets.js";
import { WIDGET_AI_POLICY_VERSION } from "../src/modules/ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../src/modules/ai/prompts/widget-ai-prompt.js";
import { WIDGET_AI_DISCLOSURE_VERSION } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("P3 approved AI assets", () => {
  it("validates the static manifest from actual versioned repo constants", () => {
    const manifest = loadApprovedAiAssetManifest();

    expect(manifest).toMatchObject({
      version: APPROVED_AI_ASSET_MANIFEST_VERSION,
      legacyS05: {
        policyVersion: WIDGET_AI_POLICY_VERSION,
        promptVersion: WIDGET_AI_PROMPT_VERSION,
        disclosureVersion: WIDGET_AI_DISCLOSURE_VERSION,
        assetVersion: LEGACY_S05_ASSET_VERSION
      },
      liveV2: {
        promptVersion: manifest.liveV2Prompt.version,
        toneVersion: manifest.liveV2Tone.version
      }
    });
    expect(manifest.liveV2Prompt.instructions.length).toBeGreaterThan(0);
    expect(manifest.liveV2Tone.desired.length).toBeGreaterThan(0);
  });

  it("rejects unknown, unversioned and cross-profile asset values", () => {
    const manifest = loadApprovedAiAssetManifest();

    expect(() =>
      parseApprovedAiAssetManifest({ ...manifest, unexpected: "raw" })
    ).toThrow();
    expect(() =>
      parseApprovedAiAssetManifest({
        ...manifest,
        legacyS05: { ...manifest.legacyS05, toolVersion: "unversioned" }
      })
    ).toThrow();
    expect(() =>
      parseApprovedAiAssetManifest({
        ...manifest,
        liveV2: { ...manifest.liveV2, assetVersion: LEGACY_S05_ASSET_VERSION }
      })
    ).toThrow();
    expect(() =>
      parseApprovedAiAssetManifest({
        ...manifest,
        legacyS05: {
          ...manifest.legacyS05,
          policyVersion: manifest.liveV2.policyVersion,
          toneVersion: manifest.liveV2.toneVersion
        }
      })
    ).toThrow();
  });

  it("keeps direct startup static while live_v2 selection enforces the facts review window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    expect(() => loadApprovedAiAssetManifest()).not.toThrow();
    await expect(selectLiveV2ApprovedAssets()).rejects.toThrow("outside its approval window");
  });

  it("records the exact approved direct asset version on a run", async () => {
    const repository = new MemoryIntakeRepository();
    const app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        modelName: "p3-fake-model",
        replyGenerator: {
          async generateReply() {
            return {
              decision: "reply_candidate",
              text: "Подберу варианты. Какой стиль вам ближе?",
              metadata: {}
            };
          }
        }
      }
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p3-assets-run-version-0001")
    });

    expect(response.statusCode).toBe(202);
    expect(repository.listAiRuns()).toMatchObject([
      {
        versions: {
          policyVersion: WIDGET_AI_POLICY_VERSION,
          promptVersion: WIDGET_AI_PROMPT_VERSION,
          disclosureVersion: WIDGET_AI_DISCLOSURE_VERSION,
          assetVersion: LEGACY_S05_ASSET_VERSION
        }
      }
    ]);
  });
});

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-15T00:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "p3-assets-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}
