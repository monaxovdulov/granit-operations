import type {
  AiMessageSentTimelineInput,
  ConversationMessageReceivedTimelineInput,
  DeliveryFailureTimelineInput,
  DeliverySentTimelineInput,
  DeliveryUncertainResolutionTimelineInput,
  DeliveryUncertainTimelineInput,
  InboundLeadCreatedTimelineInput,
  LeadStatusChangedTimelineInput,
  ManagerMessageQueuedTimelineInput,
  ManagerNotificationEnqueuedTimelineInput,
  ManagerNotificationFailureTimelineInput,
  ManagerNotificationSentTimelineInput,
  ManagerTakeoverTimelineInput,
  ManualContactRecordedTimelineInput,
  NextStepUpdatedTimelineInput,
  SiteFormLeadCreatedTimelineInput
} from "./timeline-event-inputs.js";

export type { DeliveryFailureTimelineInput } from "./timeline-event-inputs.js";

type TimelineEvent = {
  leadId: string;
  eventType: TimelineEventType;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
};

export const TIMELINE_EVENT_TYPES = {
  leadCreatedFromSiteForm: "lead.created_from_site_form",
  leadCreatedFromSiteWidget: "lead.created_from_site_widget",
  leadCreatedFromTelegram: "lead.created_from_telegram",
  leadStatusChanged: "lead.status_changed",
  leadNextStepUpdated: "lead.next_step_updated",
  leadManualContactRecorded: "lead.manual_contact_recorded",
  conversationMessageReceived: "conversation.message_received",
  conversationAiMessageSent: "conversation.ai_message_sent",
  conversationManagerTakeover: "conversation.manager_takeover",
  conversationManagerMessageQueued: "conversation.manager_message_queued",
  conversationDeliverySent: "conversation.delivery_sent",
  conversationDeliveryRetrying: "conversation.delivery_retrying",
  conversationDeliveryFailed: "conversation.delivery_failed",
  conversationDeliveryBlocked: "conversation.delivery_blocked",
  conversationDeliveryUncertain: "conversation.delivery_uncertain",
  conversationDeliveryUncertainResolution: "conversation.delivery_uncertain_resolution",
  managerNotificationEnqueued: "manager.notification_enqueued",
  managerNotificationSent: "manager.notification_sent",
  managerNotificationRetrying: "manager.notification_retrying",
  managerNotificationFailed: "manager.notification_failed",
  managerNotificationBlocked: "manager.notification_blocked"
} as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[keyof typeof TIMELINE_EVENT_TYPES];

export function siteFormLeadCreatedTimelineEvent(
  input: SiteFormLeadCreatedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.leadCreatedFromSiteForm,
    summary: "Lead created from public website form",
    metadata: {
      public_submission_id: input.publicSubmissionId,
      source_page_url: input.sourcePageUrl,
      source_form_kind: input.sourceFormKind
    }
  };
}

export function inboundLeadCreatedTimelineEvent(
  input: InboundLeadCreatedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType:
      input.channel === "site_widget"
        ? TIMELINE_EVENT_TYPES.leadCreatedFromSiteWidget
        : TIMELINE_EVENT_TYPES.leadCreatedFromTelegram,
    summary:
      input.channel === "site_widget"
        ? "Lead created from public website widget"
        : "Lead created from Telegram inbound",
    metadata: input.metadata,
    createdAt: input.createdAt
  };
}

export function conversationMessageReceivedTimelineEvent(
  input: ConversationMessageReceivedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationMessageReceived,
    summary:
      input.channel === "site_widget"
        ? "Website widget message received"
        : "Telegram message received",
    metadata: {
      public_message_id: input.publicMessageId,
      public_conversation_id: input.publicConversationId,
      channel: input.channel,
      channel_identity_id: input.channelIdentityId,
      content_type: input.contentType,
      automation_status: input.automationStatus,
      ...(input.publicSessionId ? { public_session_id: input.publicSessionId } : {}),
      ...(input.sourcePageUrl ? { source_page_url: input.sourcePageUrl } : {}),
      ...(input.widgetInstanceId ? { widget_instance_id: input.widgetInstanceId } : {}),
      ...(input.providerMessageId ? { provider_message_id: input.providerMessageId } : {}),
      ...(input.providerUpdateId ? { provider_update_id: input.providerUpdateId } : {})
    },
    createdAt: input.createdAt
  };
}

export function aiMessageSentTimelineEvent(input: AiMessageSentTimelineInput): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationAiMessageSent,
    summary:
      input.channel === "site_widget"
        ? "Website widget AI reply persisted"
        : "AI reply persisted",
    metadata: {
      ...input.metadata,
      public_message_id: input.publicMessageId,
      inbound_public_message_id: input.inboundPublicMessageId,
      public_conversation_id: input.publicConversationId,
      channel: input.channel
    },
    createdAt: input.createdAt
  };
}

export function leadStatusChangedTimelineEvent(
  input: LeadStatusChangedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.leadStatusChanged,
    summary: `Lead status changed from ${input.fromStatus} to ${input.toStatus}`,
    metadata: {
      from_status: input.fromStatus,
      to_status: input.toStatus,
      changed_by_manager_id: input.changedByManagerId,
      changed_by_manager_email: input.changedByManagerEmail,
      changed_by_manager_role: input.changedByManagerRole
    },
    createdAt: input.createdAt
  };
}

export function nextStepUpdatedTimelineEvent(
  input: NextStepUpdatedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.leadNextStepUpdated,
    summary: "Lead next step updated",
    metadata: {
      next_step_at: input.nextStepAt,
      next_step_summary: input.nextStepSummary ?? null,
      next_step_channel: input.nextStepChannel ?? null,
      changed_by_manager_id: input.changedByManagerId,
      changed_by_manager_email: input.changedByManagerEmail,
      changed_by_manager_role: input.changedByManagerRole
    },
    createdAt: input.createdAt
  };
}

export function manualContactRecordedTimelineEvent(
  input: ManualContactRecordedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.leadManualContactRecorded,
    summary: "Manual contact recorded",
    metadata: {
      contact_channel: input.contactChannel,
      contacted_at: input.contactedAt,
      summary: input.summary,
      next_step_at: input.nextStepAt ?? null,
      next_step_summary: input.nextStepSummary ?? null,
      changed_by_manager_id: input.changedByManagerId,
      changed_by_manager_email: input.changedByManagerEmail,
      changed_by_manager_role: input.changedByManagerRole
    },
    createdAt: input.createdAt
  };
}

export function managerTakeoverTimelineEvent(input: ManagerTakeoverTimelineInput): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationManagerTakeover,
    summary: "Manager takeover disabled AI replies",
    metadata: {
      public_conversation_id: input.publicConversationId,
      channel: input.channel,
      previous_agent_allowed_to_reply: input.previousAgentAllowedToReply,
      previous_ai_state: input.previousAiState,
      changed_by_manager_id: input.changedByManagerId,
      changed_by_manager_email: input.changedByManagerEmail,
      changed_by_manager_role: input.changedByManagerRole
    },
    createdAt: input.createdAt
  };
}

export function managerMessageQueuedTimelineEvent(
  input: ManagerMessageQueuedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationManagerMessageQueued,
    summary: "Manager Telegram reply queued for delivery",
    metadata: {
      public_conversation_id: input.publicConversationId,
      public_message_id: input.publicMessageId,
      channel: "telegram",
      delivery_status: "pending",
      changed_by_manager_id: input.changedByManagerId,
      changed_by_manager_email: input.changedByManagerEmail,
      changed_by_manager_role: input.changedByManagerRole
    },
    createdAt: input.createdAt
  };
}

export function managerNotificationEnqueuedTimelineEvent(
  input: ManagerNotificationEnqueuedTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.managerNotificationEnqueued,
    summary:
      input.status === "pending"
        ? "Telegram manager notification queued"
        : "Telegram manager notification blocked because no destination is bound",
    metadata: {
      ...(input.notificationIds ? { notification_ids: input.notificationIds } : {}),
      ...(input.notificationId !== undefined ? { notification_id: input.notificationId } : {}),
      public_conversation_id: input.publicConversationId,
      public_message_id: input.publicMessageId,
      status: input.status,
      channel: "telegram",
      ...(input.destinationCount ? { destination_count: input.destinationCount } : {}),
      needs_manager_reason: input.needsManagerReason
    },
    createdAt: input.createdAt
  };
}

export function managerNotificationSentTimelineEvent(
  input: ManagerNotificationSentTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.managerNotificationSent,
    summary: "Telegram manager notification delivered",
    metadata: managerNotificationMetadata({
      notificationId: input.notificationId,
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      notificationStatus: "sent",
      attemptCount: input.attemptCount,
      providerMessageId: input.providerMessageId
    }),
    createdAt: input.sentAt
  };
}

export function managerNotificationFailureTimelineEvent(
  input: ManagerNotificationFailureTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: managerNotificationFailureEventType(input.status),
    summary: managerNotificationFailureSummary(input.status),
    metadata: managerNotificationMetadata({
      notificationId: input.notificationId,
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      notificationStatus: input.status,
      attemptCount: input.attemptCount,
      lastError: input.lastError
    }),
    createdAt: input.failedAt
  };
}

export function deliverySentTimelineEvent(input: DeliverySentTimelineInput): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationDeliverySent,
    summary: "Telegram message delivered",
    metadata: deliveryMetadata({
      deliveryId: input.deliveryId,
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      deliveryStatus: "sent",
      attemptCount: input.attemptCount,
      providerMessageId: input.providerMessageId
    }),
    createdAt: input.createdAt
  };
}

export function deliveryFailureTimelineEvent(input: DeliveryFailureTimelineInput): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: deliveryFailureEventType(input.status),
    summary: deliveryFailureSummary(input.status),
    metadata: deliveryMetadata({
      deliveryId: input.deliveryId,
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      deliveryStatus: input.status,
      attemptCount: input.attemptCount,
      lastError: input.lastError
    }),
    createdAt: input.failedAt
  };
}

export function deliveryUncertainTimelineEvent(
  input: DeliveryUncertainTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationDeliveryUncertain,
    summary: "Telegram delivery result is unknown",
    metadata: deliveryMetadata({
      deliveryId: input.deliveryId,
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      deliveryStatus: "uncertain",
      attemptCount: input.attemptCount,
      lastError: input.lastError
    }),
    createdAt: input.createdAt
  };
}

export function deliveryUncertainResolutionTimelineEvent(
  input: DeliveryUncertainResolutionTimelineInput
): TimelineEvent {
  return {
    leadId: input.leadId,
    eventType: TIMELINE_EVENT_TYPES.conversationDeliveryUncertainResolution,
    summary: "Telegram delivery uncertainty resolved by operator evidence",
    metadata: deliveryMetadata({
      deliveryId: input.deliveryId,
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      deliveryStatus: input.resolution,
      resolvedByManagerEmail: input.resolvedByManagerEmail ?? null,
      evidenceNote: input.evidenceNote ?? null
    }),
    createdAt: input.createdAt
  };
}

function deliveryFailureEventType(status: DeliveryFailureTimelineInput["status"]) {
  if (status === "retrying") {
    return TIMELINE_EVENT_TYPES.conversationDeliveryRetrying;
  }

  if (status === "blocked_no_destination" || status === "blocked") {
    return TIMELINE_EVENT_TYPES.conversationDeliveryBlocked;
  }

  if (status === "uncertain") {
    return TIMELINE_EVENT_TYPES.conversationDeliveryUncertain;
  }

  return TIMELINE_EVENT_TYPES.conversationDeliveryFailed;
}

function deliveryFailureSummary(status: DeliveryFailureTimelineInput["status"]) {
  if (status === "retrying") {
    return "Telegram delivery failed and will retry";
  }

  if (status === "blocked_no_destination") {
    return "Telegram delivery blocked because no customer destination is stored";
  }

  if (status === "blocked") {
    return "Telegram delivery blocked";
  }

  if (status === "uncertain") {
    return "Telegram delivery result is unknown";
  }

  return "Telegram delivery failed";
}

function managerNotificationFailureEventType(
  status: ManagerNotificationFailureTimelineInput["status"]
) {
  if (status === "retrying") {
    return TIMELINE_EVENT_TYPES.managerNotificationRetrying;
  }

  if (status === "blocked_no_destination") {
    return TIMELINE_EVENT_TYPES.managerNotificationBlocked;
  }

  return TIMELINE_EVENT_TYPES.managerNotificationFailed;
}

function managerNotificationFailureSummary(
  status: ManagerNotificationFailureTimelineInput["status"]
) {
  if (status === "retrying") {
    return "Telegram manager notification failed and will retry";
  }

  if (status === "blocked_no_destination") {
    return "Telegram manager notification blocked because no manager destination is stored";
  }

  return "Telegram manager notification failed";
}

function managerNotificationMetadata(input: Record<string, unknown>) {
  return {
    notification_id: input.notificationId,
    channel: "telegram",
    provider: "telegram_bot",
    notification_status: input.notificationStatus,
    ...(input.publicConversationId
      ? { public_conversation_id: input.publicConversationId }
      : {}),
    ...(input.publicMessageId ? { public_message_id: input.publicMessageId } : {}),
    ...(input.attemptCount !== undefined ? { attempt_count: input.attemptCount } : {}),
    ...(input.providerMessageId ? { provider_message_id: input.providerMessageId } : {}),
    ...(input.lastError ? { last_error: input.lastError } : {})
  };
}

function deliveryMetadata(input: Record<string, unknown>) {
  return {
    delivery_id: input.deliveryId,
    public_conversation_id: input.publicConversationId,
    public_message_id: input.publicMessageId,
    channel: "telegram",
    provider: "telegram_bot",
    delivery_status: input.deliveryStatus,
    ...(input.attemptCount !== undefined ? { attempt_count: input.attemptCount } : {}),
    ...(input.providerMessageId ? { provider_message_id: input.providerMessageId } : {}),
    ...(input.lastError ? { last_error: input.lastError } : {}),
    ...(input.resolvedByManagerEmail !== undefined
      ? { resolved_by_manager_email: input.resolvedByManagerEmail }
      : {}),
    ...(input.evidenceNote !== undefined ? { evidence_note: input.evidenceNote } : {})
  };
}
