import { ApiRequestError, AuthRequiredError } from "./api";
import {
  LEAD_STATUS_VALUES,
  isLeadStatus,
  type LeadStatus,
  type AiReviewLabel,
  type ManagerAiQualitySummary,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type ManagerStructuredIntakeSlot,
  type ManagerUser,
  type MessageDeliveryStatus
} from "./types";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short"
});

export const LEAD_STATUS_OPTIONS = LEAD_STATUS_VALUES.map((status) => ({
  value: status,
  label: statusLabel(status)
}));

export function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}

export function errorMessage(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return "Нужно войти снова";
  }

  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return "Заявка не найдена";
    }

    if (error.status === 401 || error.status === 403) {
      return "Нужно войти снова";
    }

    if (error.status >= 500) {
      return "Сервис временно недоступен";
    }

    return "Не удалось загрузить данные";
  }

  return "Не удалось выполнить запрос";
}

export function roleLabel(role: ManagerUser["role"]) {
  const labels: Record<ManagerUser["role"], string> = {
    owner: "Владелец",
    manager: "Менеджер",
    viewer: "Просмотр"
  };

  return labels[role];
}

export function statusLabel(status: ManagerLeadListItem["status"]) {
  const labels: Record<ManagerLeadListItem["status"], string> = {
    new: "Новая",
    in_progress: "В работе",
    waiting_response: "Ждет ответа",
    closed: "Закрыта",
    duplicate: "Дубль",
    spam: "Спам"
  };

  return labels[status];
}

export function statusBadgeColor(status: ManagerLeadListItem["status"]) {
  const colors: Record<ManagerLeadListItem["status"], string> = {
    new: "green",
    in_progress: "blue",
    waiting_response: "yellow",
    closed: "gray",
    duplicate: "orange",
    spam: "red"
  };

  return colors[status];
}

export function sourceChannelLabel(channel: ManagerLeadListItem["source"]["channel"]) {
  const labels: Record<ManagerLeadListItem["source"]["channel"], string> = {
    site_form: "Форма сайта",
    site_widget: "Виджет сайта",
    telegram: "Telegram"
  };

  return labels[channel];
}

export function conversationChannelLabel(channel: ManagerLeadDetail["conversations"][number]["channel"]) {
  const labels: Record<ManagerLeadDetail["conversations"][number]["channel"], string> = {
    site_widget: "Виджет сайта",
    telegram: "Telegram"
  };

  return labels[channel];
}

export function formKindLabel(value?: string) {
  const labels: Record<string, string> = {
    catalog_request: "Запрос из каталога",
    contact: "Контактная форма",
    site_widget: "Виджет сайта"
  };

  return value ? (labels[value] ?? "Форма сайта") : "Не указана";
}

export function structuredIntakeSlotLabel(name: ManagerStructuredIntakeSlot["name"]) {
  const labels: Record<ManagerStructuredIntakeSlot["name"], string> = {
    monumentType: "Тип памятника",
    material: "Материал",
    size: "Размер",
    city: "Город",
    cemetery: "Кладбище",
    engraving: "Оформление",
    installation: "Установка",
    budgetContext: "Бюджет",
    desiredTiming: "Желаемый срок",
    customerName: "Имя",
    phone: "Телефон",
    preferredContact: "Способ связи",
    questionSummary: "Суть вопроса"
  };

  return labels[name];
}

export function structuredIntakeSourceLabel(source: ManagerStructuredIntakeSlot["source"]) {
  const labels: Record<ManagerStructuredIntakeSlot["source"], string> = {
    contact: "контакт",
    visitor_message: "сообщение клиента",
    ai_extraction: "извлечено AI",
    manager: "указано менеджером"
  };

  return labels[source];
}

export function aiReviewLabel(value: AiReviewLabel) {
  const labels: Record<AiReviewLabel, string> = {
    correct: "Ответ корректен",
    unsupported_fact: "Неподтвержденный факт",
    wrong_slot: "Ошибка в параметре",
    missed_handoff: "Пропущена передача",
    unnecessary_handoff: "Лишняя передача",
    poor_tone: "Неудачный тон",
    other: "Другая проблема"
  };

  return labels[value];
}

export function aiQualityEventLabel(event: ManagerAiQualitySummary) {
  const labels: Record<ManagerAiQualitySummary["eventType"], string> = {
    handoff: "AI передал диалог",
    degradation: "AI не ответил",
    blocked: "AI-ответ заблокирован",
    policy_violation: "Ответ отклонен policy gate",
    model_failure: "Ошибка AI runtime",
    runtime_failure: "Ошибка сохранения AI"
  };

  return labels[event.eventType];
}

export function aiQualityReasonLabel(reasonCode: string) {
  const labels: Record<string, string> = {
    missing_openai_config: "AI-провайдер не настроен",
    model_error: "Ошибка модели",
    semantic_verifier_error: "Ошибка verifier",
    turn_timeout: "Превышено время ответа",
    empty_model_response: "Пустой ответ модели",
    unsafe_model_response: "Ответ не прошел safety/grounding gate",
    grounding_validation_failed: "Ответ не прошел grounding validation",
    agent_reply_blocked: "Send gate заблокировал ответ",
    ai_persistence_unconfirmed: "Сохранение AI-ответа не подтверждено"
  };

  return labels[reasonCode] ?? reasonCode;
}

export function aiQualitySeverityColor(severity: ManagerAiQualitySummary["severity"]) {
  const colors: Record<ManagerAiQualitySummary["severity"], string> = {
    info: "gray",
    warning: "yellow",
    error: "orange",
    critical: "red"
  };

  return colors[severity];
}

export function timelineEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    "lead.created_from_site_form": "Заявка создана",
    "lead.created_from_site_widget": "Заявка из виджета",
    "lead.created_from_telegram": "Заявка из Telegram",
    "conversation.message_received": "Сообщение получено",
    "conversation.ai_message_sent": "AI-ответ сохранен",
    "conversation.ai_handoff_created": "Передача менеджеру",
    "conversation.ai_degraded": "AI не ответил",
    "conversation.ai_review_labeled": "Оценка AI-ответа",
    "conversation.ai_control_changed": "Управление AI",
    "conversation.manager_takeover": "AI отключен менеджером",
    "conversation.manager_message_queued": "Ответ ожидает отправки",
    "conversation.delivery_sent": "Сообщение доставлено",
    "conversation.delivery_retrying": "Повтор доставки",
    "conversation.delivery_failed": "Ошибка доставки",
    "conversation.delivery_blocked": "Доставка заблокирована",
    "conversation.delivery_uncertain": "Статус доставки неясен",
    "manager.notification_enqueued": "Уведомление менеджеру",
    "manager.notification_sent": "Уведомление доставлено",
    "manager.notification_retrying": "Повтор уведомления",
    "manager.notification_failed": "Ошибка уведомления",
    "manager.notification_blocked": "Уведомление заблокировано",
    "lead.status_changed": "Статус изменен"
  };

  return labels[eventType] ?? "Событие заявки";
}

export function timelineSummaryLabel(event: ManagerLeadDetail["timeline"][number]) {
  if (event.eventType === "lead.status_changed") {
    const fromStatus = metadataLeadStatus(event.metadata.from_status);
    const toStatus = metadataLeadStatus(event.metadata.to_status);

    if (fromStatus && toStatus) {
      return `Статус изменен: ${statusLabel(fromStatus)} -> ${statusLabel(toStatus)}`;
    }

    if (toStatus) {
      return `Статус изменен на ${statusLabel(toStatus)}`;
    }
  }

  const labels: Record<string, string> = {
    "lead.created_from_site_form": "Заявка создана из формы на сайте",
    "lead.created_from_site_widget": "Заявка создана из виджета сайта",
    "lead.created_from_telegram": "Заявка создана из Telegram",
    "conversation.message_received": "Получено сообщение клиента",
    "conversation.ai_message_sent": "AI-ответ сохранен в диалоге",
    "conversation.ai_handoff_created": "AI передал диалог менеджеру",
    "conversation.ai_degraded": "AI не смог безопасно ответить на этот ход",
    "conversation.ai_review_labeled": "Менеджер оценил AI-ответ",
    "conversation.ai_control_changed": "Менеджер изменил режим AI в диалоге",
    "conversation.manager_takeover": "Менеджер взял диалог, AI отключен",
    "conversation.manager_message_queued": "Ответ менеджера ждет отправки",
    "conversation.delivery_sent": "Сообщение доставлено в Telegram",
    "conversation.delivery_retrying": "Доставка не прошла, будет повтор",
    "conversation.delivery_failed": "Доставка в Telegram завершилась ошибкой",
    "conversation.delivery_blocked": "Доставка в Telegram заблокирована",
    "conversation.delivery_uncertain": "Результат доставки в Telegram неизвестен",
    "manager.notification_enqueued": "Уведомление менеджеру поставлено в очередь",
    "manager.notification_sent": "Уведомление менеджеру доставлено в Telegram",
    "manager.notification_retrying": "Уведомление менеджеру будет повторено",
    "manager.notification_failed": "Уведомление менеджеру завершилось ошибкой",
    "manager.notification_blocked": "Уведомление менеджеру заблокировано"
  };

  return labels[event.eventType] ?? "Событие заявки";
}

export function timelineIconColor(event: ManagerLeadDetail["timeline"][number]) {
  if (event.eventType === "lead.status_changed") {
    return "blue";
  }

  if (event.eventType === "conversation.message_received") {
    return "green";
  }

  if (event.eventType === "conversation.ai_message_sent") {
    return "blue";
  }

  if (event.eventType === "conversation.ai_degraded") {
    return "orange";
  }

  if (event.eventType === "conversation.ai_handoff_created") {
    return "blue";
  }

  if (event.eventType === "conversation.manager_takeover") {
    return "red";
  }

  if (event.eventType.startsWith("conversation.delivery_")) {
    if (event.eventType === "conversation.delivery_uncertain") {
      return "yellow";
    }

    return event.eventType === "conversation.delivery_sent" ? "green" : "red";
  }

  return "green";
}

export function conversationMessageSenderLabel(
  senderRole: ManagerLeadDetail["conversations"][number]["messages"][number]["senderRole"]
) {
  if (senderRole === "ai_assistant") {
    return "AI-помощник";
  }

  return senderRole === "manager" ? "Менеджер" : "Посетитель";
}

export function conversationMessageBody(
  message: ManagerLeadDetail["conversations"][number]["messages"][number]
) {
  if (message.contentType === "text") {
    return message.body;
  }

  const labels: Record<typeof message.contentType, string> = {
    voice: "Голосовое сообщение",
    sticker: "Стикер",
    video_note: "Видеосообщение",
    photo: "Фото",
    document: "Документ"
  };

  return message.caption
    ? `${labels[message.contentType]}: ${message.caption}`
    : labels[message.contentType];
}

export function deliveryStatusLabel(status: MessageDeliveryStatus) {
  const labels: Record<MessageDeliveryStatus, string> = {
    pending: "Ждет отправки",
    processing: "Отправляется",
    retrying: "Повтор",
    sent: "Доставлено",
    failed: "Ошибка",
    blocked_no_destination: "Нет получателя",
    blocked: "Заблокировано",
    uncertain: "Неясно"
  };

  return labels[status];
}

export function deliveryStatusColor(status: MessageDeliveryStatus) {
  const colors: Record<MessageDeliveryStatus, string> = {
    pending: "gray",
    processing: "blue",
    retrying: "yellow",
    sent: "green",
    failed: "red",
    blocked_no_destination: "orange",
    blocked: "orange",
    uncertain: "grape"
  };

  return colors[status];
}

export function deliveryTooltip(
  delivery: NonNullable<
    ManagerLeadDetail["conversations"][number]["messages"][number]["delivery"]
  >
) {
  const parts = [
    `Статус: ${deliveryStatusLabel(delivery.status)}`,
    `Попыток: ${delivery.attemptCount}`,
    `Обновлено: ${formatDate(delivery.updatedAt)}`
  ];

  if (delivery.lastError) {
    parts.push(`Ошибка: ${delivery.lastError}`);
  }

  if (delivery.providerMessageId) {
    parts.push(`ID сообщения Telegram: ${delivery.providerMessageId}`);
  }

  return parts.join("\n");
}

export function formatLeadCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "заявка"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "заявки"
        : "заявок";

  return `${count} ${word}`;
}

export function formatMessageCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "сообщение"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "сообщения"
        : "сообщений";

  return `${count} ${word}`;
}

export function contactLabel(value: ManagerLeadListItem["contact"]["preferredContact"]) {
  const labels: Record<NonNullable<ManagerLeadListItem["contact"]["preferredContact"]>, string> = {
    phone: "телефон",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    email: "эл. почта"
  };

  return value ? labels[value] : undefined;
}

export function displayContactName(lead: ManagerLeadListItem) {
  if (lead.source.channel === "site_widget" && lead.contact.name === "Site visitor") {
    return "Посетитель сайта";
  }

  if (lead.source.channel === "telegram" && lead.contact.name === "Telegram") {
    return "Клиент Telegram";
  }

  return lead.contact.name;
}

function metadataLeadStatus(value: unknown): LeadStatus | null {
  return isLeadStatus(value) ? value : null;
}
