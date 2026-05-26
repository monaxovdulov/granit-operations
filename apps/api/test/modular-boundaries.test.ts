import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

import { describe, expect, it } from "vitest";

const apiSrc = path.join(process.cwd(), "apps/api/src");
const compatibilityExportDirs = new Set(["auth", "repositories", "routes", "services"]);

describe("ops-api modular monolith boundaries", () => {
  it("keeps runtime assembly in one app context and out of legacy route/service folders", () => {
    const appSource = readSource("app.ts");
    const appContextSource = readSource("app-context.ts");

    expect(appSource).toContain("./app-context.js");
    expect(appSource).toContain("./modules/intake/routes/public-intake-routes.js");
    expect(appSource).toContain("./modules/telegram/inbound/routes/telegram-routes.js");
    expect(appSource).not.toMatch(/\.\/routes\//);
    expect(appSource).not.toMatch(/\.\/services\//);
    expect(appSource).not.toMatch(/\.\/repositories\//);
    expect(appContextSource).toContain("new PublicIntakeService");
    expect(appContextSource).toContain("new PublicWidgetIntakeService");
    expect(appContextSource).toContain("new ManagerLeadUseCases");
    expect(appContextSource).toContain("new ManagerTelegramBindingUseCases");
    expect(appContextSource).toContain("new RepositoryTelegramInboundUseCases");
    expect(appContextSource).toContain("new TelegramBotService");
  });

  it("keeps raw Fastify request/reply and manager request mutation out of non-route code", () => {
    for (const filePath of listFiles(apiSrc)) {
      if (!filePath.endsWith(".ts")) {
        continue;
      }

      const relativePath = path.relative(apiSrc, filePath);
      const source = readFileSync(filePath, "utf8");

      if (!isRouteFile(filePath)) {
        expect(source, relativePath).not.toMatch(/\bFastify(?:Request|Reply)\b/);
      }

      expect(source, relativePath).not.toContain("RequestWithManager");
      expect(source, relativePath).not.toMatch(/(?:\brequest|\))\s*\.\s*managerUser\b/);
    }
  });

  it("keeps routes as protocol adapters without constructing business services", () => {
    const routeSource = [
      readTree("modules/auth/routes"),
      readTree("modules/intake/routes"),
      readTree("modules/manager/routes"),
      readTree("modules/telegram/inbound/routes")
    ].join("\n");

    expect(routeSource).not.toMatch(
      /new\s+(PublicIntakeService|PublicWidgetIntakeService|TelegramBotService|ManagerLeadUseCases|ManagerTelegramBindingUseCases|RepositoryTelegramInboundUseCases)/
    );
    expect(readSource("modules/intake/routes/public-intake-routes.ts")).not.toContain(
      "IntakeRepository"
    );
    expect(readSource("modules/telegram/inbound/routes/telegram-routes.ts")).not.toContain(
      "TelegramInboundUseCases"
    );
  });

  it("keeps conversation repository contracts split by responsibility", () => {
    const aggregateRepositorySource = readSource(
      "modules/conversations/repositories/intake-repository.ts"
    );
    const publicIntakeServiceSource = readSource(
      "modules/intake/use-cases/public-intake-service.ts"
    );
    const publicWidgetIntakeServiceSource = readSource(
      "modules/intake/use-cases/public-widget-intake-service.ts"
    );
    const managerLeadUseCasesSource = readSource(
      "modules/manager/use-cases/manager-lead-use-cases.ts"
    );
    const managerTelegramUseCasesSource = readSource(
      "modules/manager/use-cases/manager-telegram-use-cases.ts"
    );
    const telegramInboundUseCasesSource = readSource(
      "modules/telegram/inbound/use-cases/telegram-inbound-use-cases.ts"
    );
    const legacyRepositoryExportSource = readSource("repositories/intake-repository.ts");

    expect(aggregateRepositorySource).toContain("./public-intake-repository.js");
    expect(aggregateRepositorySource).toContain("./conversation-message-repository.js");
    expect(aggregateRepositorySource).toContain("./manager-lead-repository.js");
    expect(aggregateRepositorySource).toContain("./manager-telegram-repository.js");
    expect(aggregateRepositorySource).toContain("./lead-conversation-types.js");
    expect(aggregateRepositorySource).toContain("interface IntakeRepository");
    expect(legacyRepositoryExportSource).toContain(
      "../modules/conversations/repositories/intake-repository.js"
    );

    expect(publicIntakeServiceSource).toContain("public-intake-repository.js");
    expect(publicIntakeServiceSource).not.toContain("repositories/intake-repository.js");
    expect(publicWidgetIntakeServiceSource).toContain("public-intake-repository.js");
    expect(publicWidgetIntakeServiceSource).not.toContain("repositories/intake-repository.js");
    expect(managerLeadUseCasesSource).toContain("manager-lead-repository.js");
    expect(managerLeadUseCasesSource).not.toContain("repositories/intake-repository.js");
    expect(managerTelegramUseCasesSource).toContain("manager-telegram-repository.js");
    expect(managerTelegramUseCasesSource).not.toContain("repositories/intake-repository.js");
    expect(telegramInboundUseCasesSource).toContain("conversation-message-repository.js");
    expect(telegramInboundUseCasesSource).toContain("manager-lead-repository.js");
    expect(telegramInboundUseCasesSource).toContain("manager-telegram-repository.js");
    expect(telegramInboundUseCasesSource).not.toContain("repositories/intake-repository.js");
  });

  it("keeps timeline event inputs neutral and event builders centralized", () => {
    const timelineSource = readSource("modules/timeline/timeline-events.ts");
    const timelineInputSource = readSource("modules/timeline/timeline-event-inputs.ts");
    const timelineTree = readTree("modules/timeline");

    expect(timelineSource).toContain("TIMELINE_EVENT_TYPES");
    expect(timelineSource).toContain("managerMessageQueuedTimelineEvent");
    expect(timelineSource).toContain("managerNotificationEnqueuedTimelineEvent");
    expect(timelineSource).toContain("deliveryUncertainTimelineEvent");
    expect(timelineSource).toContain("./timeline-event-inputs.js");
    expect(timelineInputSource).toContain("TimelineCustomerChannel");
    expect(timelineInputSource).toContain("DeliveryFailureTimelineInput");
    expect(timelineTree).not.toContain("conversations/repositories");
    expect(timelineTree).not.toContain("repositories/intake-repository.js");
    expect(timelineTree).not.toContain("lead-conversation-types.js");
    expect(timelineTree).not.toMatch(/from\s+["'].*\/services\//);
    expect(timelineTree).not.toContain("telegram-delivery-service.js");
  });

  it("keeps public widget intake behind a narrow AI reply generator boundary", () => {
    const appContextSource = readSource("app-context.ts");
    const publicWidgetIntakeServiceSource = readSource(
      "modules/intake/use-cases/public-widget-intake-service.ts"
    );
    const widgetAiReplyGeneratorSource = readSource(
      "modules/intake/ports/public-widget-ai-reply-generator.ts"
    );
    const widgetAiServiceSource = readSource("modules/ai/services/widget-ai-service.ts");

    expect(widgetAiReplyGeneratorSource).toContain("interface PublicWidgetAiReplyGenerator");
    expect(publicWidgetIntakeServiceSource).toContain(
      "../ports/public-widget-ai-reply-generator.js"
    );
    expect(publicWidgetIntakeServiceSource).not.toMatch(
      /\b(WidgetAiService|WidgetAiProvider|OpenAiWidgetAssistantProvider|provider|modelName)\b/
    );
    expect(appContextSource).toContain("new WidgetAiService");
    expect(appContextSource).toContain("replyGenerator");
    expect(widgetAiServiceSource).toContain("implements PublicWidgetAiReplyGenerator");
  });

  it("keeps Telegram inbound free of delivery provider sends", () => {
    const inboundSource = readTree("modules/telegram/inbound");

    expect(inboundSource).not.toMatch(/\bsendMessage\b/);
    expect(inboundSource).not.toContain("TelegramBotApiDeliveryProvider");
    expect(inboundSource).not.toContain("modules/delivery");
    expect(inboundSource).not.toContain("../../delivery");
  });

  it("keeps manager Telegram persistence in an explicit repository module", () => {
    const intakeRepositorySource = readSource(
      "modules/conversations/repositories/postgres-intake-repository.ts"
    );
    const managerTelegramRepositorySource = readSource(
      "modules/conversations/repositories/postgres-manager-telegram-repository.ts"
    );

    expect(intakeRepositorySource).toContain("PostgresManagerTelegramRepository");
    expect(intakeRepositorySource).not.toContain("managerTelegramBindTokens");
    expect(intakeRepositorySource).not.toContain("managerTelegramReplyContexts");
    expect(managerTelegramRepositorySource).toContain("implements ManagerTelegramRepository");
    expect(managerTelegramRepositorySource).toContain("managerTelegramBindTokens");
    expect(managerTelegramRepositorySource).toContain("managerTelegramReplyContexts");
    expect(managerTelegramRepositorySource).toContain("messageDeliveries");
    expect(managerTelegramRepositorySource).toContain("managerMessageQueuedTimelineEvent");
  });

  it("keeps Telegram delivery independent from webhook handling", () => {
    const deliverySource = readTree("modules/delivery");

    expect(deliverySource).not.toContain("telegram/inbound");
    expect(deliverySource).not.toMatch(/webhook/i);
  });

  it("centralizes timeline event names for delivery uncertainty evidence", () => {
    const timelineSource = readSource("modules/timeline/timeline-events.ts");
    const deliveryRepositorySource = readSource(
      "modules/delivery/repositories/telegram-delivery-repository.ts"
    );

    expect(timelineSource).toContain("conversation.delivery_uncertain");
    expect(timelineSource).toContain("conversation.delivery_uncertain_resolution");
    expect(timelineSource).toContain("DeliveryFailureTimelineInput");
    expect(timelineSource).not.toContain("../delivery/services");
    expect(deliveryRepositorySource).toContain("deliveryUncertainTimelineEvent");
    expect(deliveryRepositorySource).not.toContain('"conversation.delivery_uncertain"');
  });

  it("keeps provider HTTP fetch implementations in adapter modules", () => {
    const widgetServiceSource = readSource("modules/ai/services/widget-ai-service.ts");
    const openAiAdapterSource = readSource(
      "modules/ai/adapters/openai-widget-assistant-provider.ts"
    );
    const deliveryServiceSource = readSource("modules/delivery/services/telegram-delivery-service.ts");
    const telegramAdapterSource = readSource(
      "modules/delivery/adapters/telegram-bot-api-delivery-provider.ts"
    );

    expect(widgetServiceSource).not.toMatch(/\bfetch\(/);
    expect(widgetServiceSource).not.toContain("OpenAiWidgetAssistantProvider");
    expect(openAiAdapterSource).toMatch(/\bfetch\(/);
    expect(openAiAdapterSource).toContain("OpenAiWidgetAssistantProvider");
    expect(deliveryServiceSource).not.toMatch(/\bfetch\(/);
    expect(deliveryServiceSource).not.toContain("TelegramBotApiDeliveryProvider");
    expect(telegramAdapterSource).toMatch(/\bfetch\(/);
    expect(telegramAdapterSource).toContain("TelegramBotApiDeliveryProvider");
  });

  it("keeps compatibility exports available but out of production imports", () => {
    const compatibilityFiles = Array.from(compatibilityExportDirs).flatMap((dir) =>
      listFiles(path.join(apiSrc, dir)).filter((filePath) => filePath.endsWith(".ts"))
    );
    const productionImportsFromCompatibilityPaths: string[] = [];

    for (const filePath of compatibilityFiles) {
      const relativePath = path.relative(apiSrc, filePath);
      const source = readFileSync(filePath, "utf8");

      expect(source, relativePath).toContain('export * from "../modules/');
    }

    for (const filePath of listFiles(apiSrc)) {
      if (!filePath.endsWith(".ts") || isCompatibilityExportFile(filePath)) {
        continue;
      }

      const relativePath = path.relative(apiSrc, filePath);
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

      for (const specifier of collectModuleSpecifiers(sourceFile)) {
        if (resolvesToCompatibilityExport(filePath, specifier)) {
          productionImportsFromCompatibilityPaths.push(`${relativePath} -> ${specifier}`);
        }
      }
    }

    expect(productionImportsFromCompatibilityPaths).toEqual([]);
  });
});

function readSource(relativePath: string) {
  return readFileSync(path.join(apiSrc, relativePath), "utf8");
}

function readTree(relativeDir: string) {
  const root = path.join(apiSrc, relativeDir);
  const chunks: string[] = [];

  for (const filePath of listFiles(root)) {
    if (filePath.endsWith(".ts")) {
      chunks.push(readFileSync(filePath, "utf8"));
    }
  }

  return chunks.join("\n");
}

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const entryPath = path.join(root, entry);
    const stat = statSync(entryPath);

    return stat.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function isRouteFile(filePath: string): boolean {
  return path.relative(apiSrc, filePath).split(path.sep).includes("routes");
}

function isCompatibilityExportFile(filePath: string): boolean {
  return compatibilityExportDirs.has(path.relative(apiSrc, filePath).split(path.sep)[0] ?? "");
}

function resolvesToCompatibilityExport(fromFilePath: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolvedPath = path.normalize(path.join(path.dirname(fromFilePath), specifier));
  const relativePath = path.relative(apiSrc, resolvedPath);

  if (relativePath.startsWith("..")) {
    return false;
  }

  return compatibilityExportDirs.has(relativePath.split(path.sep)[0] ?? "");
}

function collectModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  sourceFile.forEachChild(function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;

      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        specifiers.push(moduleSpecifier.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const [specifier] = node.arguments;

      if (specifier && ts.isStringLiteral(specifier)) {
        specifiers.push(specifier.text);
      }
    }

    ts.forEachChild(node, visit);
  });

  return specifiers;
}
