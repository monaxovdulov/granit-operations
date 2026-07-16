import type { AiTurnIntent } from "../ai-dialog-contract.js";

export const APPROVED_WIDGET_KNOWLEDGE_VERSION = "granit_public_site_facts.2026-07-16.v1";

export type ApprovedWidgetKnowledgeFact = {
  sourceId: string;
  version: typeof APPROVED_WIDGET_KNOWLEDGE_VERSION;
  fact: string;
  intents: AiTurnIntent[];
  keywords: string[];
  provenancePath: string;
  reviewedAt: string;
  reviewBasis: "published_site_content";
  clientQuotable: true;
};

export const APPROVED_WIDGET_KNOWLEDGE: ApprovedWidgetKnowledgeFact[] = [
  {
    sourceId: "public_site.service_area.moscow_region",
    version: APPROVED_WIDGET_KNOWLEDGE_VERSION,
    fact: "Компания работает по Москве и Московской области.",
    intents: ["general_question", "product_selection", "contact_request"],
    keywords: ["москва", "московск", "область", "город", "выезд", "доставка", "установка"],
    provenancePath: "/blagoustroistvo-mogil/",
    reviewedAt: "2026-07-16",
    reviewBasis: "published_site_content",
    clientQuotable: true
  },
  {
    sourceId: "public_site.catalog.monument_types",
    version: APPROVED_WIDGET_KNOWLEDGE_VERSION,
    fact: "На сайте представлены вертикальные, горизонтальные, двойные и семейные памятники, а также мемориальные комплексы.",
    intents: ["general_question", "product_selection"],
    keywords: ["вариант", "вид", "тип", "вертикаль", "горизонт", "двойн", "семейн", "комплекс"],
    provenancePath: "/gorizontalnye-pamyatniki/",
    reviewedAt: "2026-07-16",
    reviewBasis: "published_site_content",
    clientQuotable: true
  },
  {
    sourceId: "public_site.services.installation_landscaping",
    version: APPROVED_WIDGET_KNOWLEDGE_VERSION,
    fact: "В заявку можно включить памятник, монтаж и благоустройство участка.",
    intents: ["general_question", "product_selection"],
    keywords: ["монтаж", "установ", "благоустрой", "участ", "цокол", "плитк"],
    provenancePath: "/blagoustroistvo-mogil/",
    reviewedAt: "2026-07-16",
    reviewBasis: "published_site_content",
    clientQuotable: true
  }
];

export function lookupApprovedWidgetKnowledge(
  query: string,
  limit = 3
): ApprovedWidgetKnowledgeFact[] {
  const normalized = query.toLocaleLowerCase("ru-RU");

  return APPROVED_WIDGET_KNOWLEDGE.filter((fact) =>
    fact.keywords.some((keyword) => normalized.includes(keyword))
  ).slice(0, limit);
}
