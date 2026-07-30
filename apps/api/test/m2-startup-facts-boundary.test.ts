import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const DATED_FACTS_MODULE = "../src/modules/ai/profiles/live-v2/facts.v1.js";

afterEach(() => {
  vi.doUnmock(DATED_FACTS_MODULE);
  vi.resetModules();
});

describe("M2 startup facts boundary", () => {
  it("does not load the dated live_v2 facts asset for disabled or direct startup", async () => {
    let datedFactsModuleEvaluations = 0;
    vi.doMock(DATED_FACTS_MODULE, () => {
      datedFactsModuleEvaluations += 1;
      throw new Error("dated live_v2 facts must not load on this startup path");
    });
    const { buildAppContext } = await import("../src/app-context.js");

    expect(() =>
      buildAppContext({
        repository: new MemoryIntakeRepository(),
        widgetAi: { enabled: false }
      })
    ).not.toThrow();
    expect(() =>
      buildAppContext({
        repository: new MemoryIntakeRepository(),
        widgetAi: {
          enabled: true,
          runtimeMode: "direct_openai",
          modelName: "direct-local-fixture-v1",
          replyGenerator: {
            generateReply: vi.fn(async () => ({ decision: "no_reply" }))
          }
        }
      })
    ).not.toThrow();

    expect(datedFactsModuleEvaluations).toBe(0);
  });

  it("fails closed when explicit M2 local/fake assembly omits approved facts", async () => {
    const { buildAppContext } = await import("../src/app-context.js");

    expect(() =>
      buildAppContext({
        repository: new MemoryIntakeRepository(),
        widgetAi: {
          enabled: true,
          runtimeMode: "mastra_openai_api",
          localFake: {
            agent: {
              generate: vi.fn(async () => {
                throw new Error("must not generate during startup");
              })
            },
            modelName: "mastra-local-fixture-v1"
          }
        } as never
      })
    ).toThrow(/"expected": "object"/);
  });
});
