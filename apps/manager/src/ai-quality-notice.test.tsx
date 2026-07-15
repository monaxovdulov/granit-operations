import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiQualityNotice } from "./ai-quality-notice";

describe("AiQualityNotice", () => {
  it("renders nothing without an unresolved quality summary", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <AiQualityNotice />
      </MantineProvider>
    );

    expect(html).not.toContain("Состояние AI требует внимания");
    expect(html).not.toContain("mantine-Alert-root");
  });

  it("renders controlled reason, terminal run status and timestamp", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <AiQualityNotice
          quality={{
            eventType: "runtime_failure",
            reasonCode: "ai_persistence_unconfirmed",
            severity: "critical",
            runStatus: "failed",
            createdAt: "2026-07-15T12:34:00.000Z"
          }}
        />
      </MantineProvider>
    );

    expect(html).toContain("Ошибка AI-обработки");
    expect(html).toContain("Сохранение AI-ответа не подтверждено");
    expect(html).toContain("ошибка");
    expect(html).toContain("2026");
    expect(html).not.toContain("ai_persistence_unconfirmed");
    expect(html).not.toContain("runtime_failure");
  });
});
