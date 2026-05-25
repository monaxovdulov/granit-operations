export const LEAD_STATUSES = [
  "new",
  "in_progress",
  "waiting_response",
  "closed",
  "duplicate",
  "spam"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const AI_STATES = [
  "ai_collecting_info",
  "needs_manager",
  "manager_active",
  "watching",
  "closed"
] as const;

export type AiState = (typeof AI_STATES)[number];

export type CustomerChannel = "site_widget" | "telegram";

export type ChannelProvider = "site_widget" | "telegram_bot";

export type MessageDeliveryStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "retrying"
  | "blocked_no_destination"
  | "blocked"
  | "uncertain";

export type ConversationContentType =
  | "text"
  | "voice"
  | "sticker"
  | "video_note"
  | "photo"
  | "document";

export type NeedsManagerReason =
  | "telegram_new_inbound"
  | "telegram_media"
  | "telegram_urgent"
  | "telegram_human_requested"
  | "ai_tool_failure";

export type NextStepChannel =
  | "manager_call"
  | "phone"
  | "whatsapp"
  | "telegram"
  | "site_widget"
  | "email";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was already used for a different submission");
    this.name = "IdempotencyConflictError";
  }
}

export class AgentReplyBlockedError extends Error {
  constructor() {
    super("agent is not allowed to reply to this conversation");
    this.name = "AgentReplyBlockedError";
  }
}

export class TelegramIdentityRequiredError extends Error {
  constructor() {
    super("telegram inbound requires provider account id and external chat id");
    this.name = "TelegramIdentityRequiredError";
  }
}

export class TelegramOutboundBlockedError extends Error {
  constructor() {
    super("AI-authored Telegram outbound is blocked until explicit approval");
    this.name = "TelegramOutboundBlockedError";
  }
}

export class ManagerTelegramReplyContextMissingError extends Error {
  constructor() {
    super("manager Telegram reply context is missing or expired");
    this.name = "ManagerTelegramReplyContextMissingError";
  }
}

export class ManagerTelegramReplyRequiresTakeoverError extends Error {
  constructor() {
    super("manager Telegram reply requires takeover before customer reply");
    this.name = "ManagerTelegramReplyRequiresTakeoverError";
  }
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUSES.includes(value as LeadStatus);
}

export function isAiState(value: unknown): value is AiState {
  return typeof value === "string" && AI_STATES.includes(value as AiState);
}
