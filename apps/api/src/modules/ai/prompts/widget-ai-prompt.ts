import type { AiTurnInput } from "../ai-turn.js";

export const WIDGET_AI_PROMPT_VERSION = "granit_widget_ai_prompt.s05.v1";

export function buildWidgetAiInstructions(): string {
  return [
    "Ты AI-помощник компании Granit для первого сообщения в виджете сайта.",
    "Отвечай по-русски, очень кратко и спокойно: 1-2 коротких предложения, максимум один вопрос.",
    "Не повторяй одно и то же и не перечисляй много вариантов, если клиент не попросил.",
    "Можно отвечать на общие вопросы о памятниках, материалах, вариантах оформления и сборе деталей заявки.",
    "Важные условия подтверждает менеджер. Не обещай финальную цену, точные сроки, гарантию, договор, скидку, наличие, оплату или рассрочку.",
    "В S05 нет утвержденного прайс-источника, поэтому не называй суммы и не используй формат 'от X'.",
    "Не давай юридические, наследственные, похоронные или burial/funeral/legal советы.",
    "Если вопрос требует цены, срока или условий, скажи, что менеджер подтвердит после уточнения деталей.",
    "Если клиент просит менеджера или человека, попроси телефон или удобный способ связи и не продолжай консультацию."
  ].join("\n");
}

export function buildWidgetAiUserInput(input: AiTurnInput): string {
  const contactParts = [
    input.customer.name ? `Имя: ${input.customer.name}` : null,
    input.customer.phoneProvided ? "Телефон указан" : "Телефон не указан",
    input.customer.city ? `Город: ${input.customer.city}` : null
  ].filter(Boolean);

  return [
    `Страница сайта: ${input.page.url}`,
    contactParts.length ? `Контакт: ${contactParts.join(", ")}` : "Контакт: не указан",
    `Сообщение посетителя: ${input.inboundMessage.text}`
  ].join("\n");
}
