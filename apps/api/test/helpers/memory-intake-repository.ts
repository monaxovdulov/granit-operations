import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE
} from "@granit/contracts";

import {
  buildStageASiteWidgetAiTurnInput,
  type AiTurnInput
} from "../../src/modules/ai/ai-turn.js";
import type {
  AiKnownSlots,
  AiSlotName
} from "../../src/modules/ai/ai-dialog-contract.js";
import {
  AiControlVersionConflictError,
  AgentReplyBlockedError,
  IdempotencyConflictError,
  ManagerTelegramReplyContextMissingError,
  ManagerTelegramReplyRequiresTakeoverError,
  TelegramIdentityRequiredError,
  TelegramOutboundBlockedError,
  type AcceptInboundMessageInput,
  type AcceptInboundMessageResult,
  type BindManagerTelegramChatInput,
  type BindManagerTelegramChatResult,
  type ChangeManagerLeadStatusInput,
  type ClearManagerTelegramReplyContextInput,
  type ConversationContentType,
  type CreateManagerTelegramBindTokenInput,
  type CreateManagerTelegramBindTokenResult,
  type CreateManagerTelegramReplyContextInput,
  type CreateManagerTelegramReplyContextResult,
  type FindManagerTelegramActorInput,
  type IntakeRepository,
  type ManagerAiControl,
  type ManagerAiQualitySummary,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type ManagerTelegramActor,
  type ManagerTelegramBindingStatus,
  type PersistManagerTelegramReplyInput,
  type PersistManagerTelegramReplyResult,
  type PersistAiReplyWithSendGateInput,
  type RecordManualContactInput,
  type RecordAiReviewLabelInput,
  type RecordSiteWidgetAiDegradationInput,
  type RecordSiteWidgetAiShadowComparisonInput,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult,
  type SaveSiteWidgetAiMessageInput,
  type SaveSiteWidgetAiMessageResult,
  type SiteWidgetHistoryResult,
  type SetConversationAiControlInput,
  type SetManagerAiControlInput,
  type SetNextStepInput,
  type TakeoverConversationByPublicIdInput,
  type TakeoverConversationInput,
  type TakeoverSiteWidgetConversationInput
} from "../../src/repositories/intake-repository.js";
import { sanitizeAiObservabilityMetadata } from "../../src/modules/ai/observability/ai-observability-sanitizer.js";

export class MemoryIntakeRepository implements IntakeRepository {
  saveCalls = 0;
  aiSaveCalls = 0;
  lastAiSaveInput?: SaveSiteWidgetAiMessageInput;
  readonly shadowComparisons: RecordSiteWidgetAiShadowComparisonInput[] = [];
  private managerAiControl: ManagerAiControl = {
    enabled: true,
    version: 1,
    changedAt: "2026-07-16T00:00:00.000Z"
  };
  private readonly leads = new Map<string, ManagerLeadDetail>();
  private readonly idempotency = new Map<
    string,
    {
      leadId: string;
      publicSubmissionId: string;
      requestFingerprint: string;
    }
  >();
  private readonly widgetIdempotency = new Map<
    string,
    {
      leadId: string;
      publicSessionId: string;
      publicMessageId: string;
      requestFingerprint: string;
    }
  >();
  private readonly widgetAiIdempotency = new Map<
    string,
    {
      publicMessageId: string;
      body: string;
      createdAt: string;
      requestFingerprint: string;
    }
  >();
  private readonly telegramIdempotency = new Map<
    string,
    {
      leadId: string;
      conversationId: string;
      publicConversationId: string;
      channelIdentityId: string;
      publicMessageId: string;
      requestFingerprint: string;
    }
  >();
  private readonly sessionLeads = new Map<string, string>();
  private readonly sessionConversations = new Map<string, string>();
  private readonly conversationLeads = new Map<string, string>();
  private readonly conversationSessions = new Map<string, string>();
  private readonly conversationPublicIds = new Map<string, string>();
  private readonly publicConversationIds = new Map<string, string>();
  private readonly conversationIdentityIds = new Map<string, string>();
  private readonly aiSlotsByConversation = new Map<string, AiKnownSlots>();
  private readonly aiRequirementsByConversation = new Map<
    string,
    AiTurnInput["knownRequirements"]
  >();
  private readonly telegramIdentityLeads = new Map<string, string>();
  private readonly telegramIdentityConversations = new Map<string, string>();
  private readonly telegramProviderMessages = new Map<string, string>();
  private readonly managerTelegramTokens = new Map<
    string,
    {
      managerUserId: string;
      managerEmail: string;
      managerRole: string;
      expiresAt: string;
      usedAt?: string;
    }
  >();
  private readonly managerTelegramBindings = new Map<
    string,
    {
      id: string;
      managerUserId: string;
      managerEmail: string;
      managerRole: string;
      providerAccountId: string;
      externalChatId: string;
      externalUserId?: string;
      username?: string;
      displayName?: string;
      boundAt: string;
    }
  >();
  private readonly managerTelegramReplyContexts = new Map<
    string,
    {
      managerUserId: string;
      managerTelegramBindingId: string;
      leadId: string;
      conversationId: string;
      publicConversationId: string;
      expiresAt: string;
      status: "pending" | "used" | "cancelled" | "expired";
    }
  >();
  private readonly managerReplyIdempotency = new Map<
    string,
    {
      leadId: string;
      publicConversationId: string;
      publicMessageId: string;
      requestFingerprint: string;
    }
  >();

  constructor(
    private readonly options: { failPersistence?: boolean; failAiPersistence?: boolean } = {}
  ) {}

  get leadCount() {
    return this.leads.size;
  }

  onlyLead() {
    const [lead] = Array.from(this.leads.values());

    if (!lead) {
      throw new Error("expected one memory lead");
    }

    return lead;
  }

  async saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult> {
    this.saveCalls += 1;

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.idempotency.get(input.request.idempotency_key);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        leadId: existing.leadId,
        publicSubmissionId: existing.publicSubmissionId,
        replayed: true
      };
    }

    const leadId = randomUUID();
    const now = new Date().toISOString();
    const lead = toManagerLead(input, leadId, now);
    this.leads.set(leadId, lead);
    this.idempotency.set(input.request.idempotency_key, {
      leadId,
      publicSubmissionId: input.publicSubmissionId,
      requestFingerprint: input.requestFingerprint
    });

    return {
      leadId,
      publicSubmissionId: input.publicSubmissionId,
      replayed: false
    };
  }

  async acceptInboundMessage(input: AcceptInboundMessageInput): Promise<AcceptInboundMessageResult> {
    if (input.channel === "site_widget") {
      const saved = await this.saveAcceptedSiteWidgetMessage({
        publicMessageId: input.publicMessageId,
        publicSessionId: input.widgetPublicSessionId ?? randomUUID(),
        agentAllowedToReply: input.automationRequested,
        request: {
          schema_version: SITE_WIDGET_CONTRACT_VERSION,
          event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
          idempotency_key: input.idempotencyKey,
          submitted_at: input.message.submittedAt,
          public_session_id: input.widgetPublicSessionId,
          source: {
            channel: "site_widget",
            page_url: input.sourcePageUrl ?? "https://granit.example/widget",
            widget_instance_id: input.widgetInstanceId ?? "widget",
            referrer_url: input.referrerUrl,
            page_title: input.pageTitle,
            utm: input.utm ?? undefined
          },
          contact: {
            name: input.contact?.name,
            phone: input.contact?.phone,
            email: input.contact?.email,
            preferred_contact: input.contact?.preferredContact,
            city: input.contact?.city
          },
          message: {
            role: "visitor",
            text: input.message.text
          },
          visitor_context: input.visitorContext,
          consent: {
            privacy_policy: true
          }
        },
        requestFingerprint: input.requestFingerprint
      });

      return {
        leadId: saved.leadId,
        conversationId: saved.conversationId,
        publicConversationId: saved.publicConversationId,
        channelIdentityId: saved.channelIdentityId,
        publicMessageId: saved.publicMessageId,
        widgetPublicSessionId: saved.publicSessionId,
        agentAllowedToReply: saved.agentAllowedToReply,
        aiState: saved.aiState,
        replayed: saved.replayed,
        existingAiReply: saved.aiReply,
        aiTurnInput: saved.aiTurnInput
      };
    }

    if (!input.providerAccountId || !input.externalChatId) {
      throw new TelegramIdentityRequiredError();
    }

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.telegramIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      const lead = this.leads.get(existing.leadId);
      const conversation = lead?.conversations.find(
        (candidate) => candidate.publicConversationId === existing.publicConversationId
      );

      return {
        leadId: existing.leadId,
        conversationId: existing.conversationId,
        publicConversationId: existing.publicConversationId,
        channelIdentityId: existing.channelIdentityId,
        publicMessageId: existing.publicMessageId,
        agentAllowedToReply: conversation?.agentAllowedToReply ?? false,
        aiState: conversation?.aiState ?? "needs_manager",
        replayed: true
      };
    }

    const providerReplayKey = telegramProviderReplayKey(input);
    const providerReplayIdempotency = providerReplayKey
      ? this.telegramProviderMessages.get(providerReplayKey)
      : undefined;

    if (providerReplayIdempotency) {
      const replay = this.telegramIdempotency.get(providerReplayIdempotency);

      if (replay) {
        return this.acceptInboundMessage({
          ...input,
          idempotencyKey: providerReplayIdempotency,
          requestFingerprint: replay.requestFingerprint
        });
      }
    }

    const identityKey = telegramIdentityKey(input);
    let leadId = this.telegramIdentityLeads.get(identityKey);
    let conversationId = this.telegramIdentityConversations.get(identityKey);
    let lead = leadId ? this.leads.get(leadId) : undefined;
    const now = new Date().toISOString();
    const channelIdentityId =
      this.conversationIdentityIds.get(conversationId ?? "") ?? randomUUID();
    const contentType = input.message.contentType ?? "text";
    const needsManager = Boolean(input.needsManagerReason) || contentType !== "text";
    const publicConversationId =
      (conversationId ? this.conversationPublicIds.get(conversationId) : undefined) ??
      randomUUID();

    if (!leadId || !conversationId || !lead) {
      leadId = randomUUID();
      conversationId = randomUUID();
      lead = toManagerTelegramLead(input, leadId, conversationId, publicConversationId, channelIdentityId, now);
      if (needsManager && this.hasActiveManagerTelegramDestination(input.providerAccountId)) {
        lead = markTelegramNotificationPending(lead);
      }
      this.leads.set(leadId, lead);
      this.telegramIdentityLeads.set(identityKey, leadId);
      this.telegramIdentityConversations.set(identityKey, conversationId);
      this.conversationLeads.set(conversationId, leadId);
      this.conversationPublicIds.set(conversationId, publicConversationId);
      this.publicConversationIds.set(publicConversationId, conversationId);
      this.conversationIdentityIds.set(conversationId, channelIdentityId);
    } else {
      const nextAiState = needsManager ? "needs_manager" : "ai_collecting_info";
      const nextAgentAllowed = input.automationRequested && !needsManager;
      lead = {
        ...lead,
        updatedAt: now,
        request: {
          ...lead.request,
          text: input.message.text || input.message.caption || lead.request.text
        },
        timeline: [
          ...lead.timeline,
          {
            eventType: "conversation.message_received",
            summary: "Telegram message received",
            metadata: {
              public_message_id: input.publicMessageId,
              public_conversation_id: publicConversationId,
              channel: "telegram",
              content_type: contentType,
              provider_message_id: input.providerMessageId,
              provider_update_id: input.providerUpdateId
            },
            createdAt: now
          },
          ...(needsManager
            ? [
                {
                  eventType: "manager.notification_enqueued",
                  summary: this.hasActiveManagerTelegramDestination(input.providerAccountId)
                    ? "Telegram manager notification queued"
                    : "Telegram manager notification blocked because no destination is bound",
                  metadata: {
                    public_conversation_id: publicConversationId,
                    public_message_id: input.publicMessageId,
                    status: this.hasActiveManagerTelegramDestination(input.providerAccountId)
                      ? "pending"
                      : "blocked_no_destination",
                    needs_manager_reason: input.needsManagerReason ?? "telegram_media"
                  },
                  createdAt: now
                }
              ]
            : [])
        ],
        conversations: lead.conversations.map((conversation) =>
          conversation.publicConversationId === publicConversationId
            ? {
                ...conversation,
                aiState: nextAiState,
                agentAllowedToReply: nextAgentAllowed && conversation.agentAllowedToReply,
                updatedAt: now,
                messages: [
                  ...conversation.messages,
                  toManagerConversationMessage(input, contentType, now)
                ]
              }
            : conversation
        )
      };
      this.leads.set(leadId, lead);
    }

    this.telegramIdempotency.set(input.idempotencyKey, {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      publicMessageId: input.publicMessageId,
      requestFingerprint: input.requestFingerprint
    });

    if (providerReplayKey) {
      this.telegramProviderMessages.set(providerReplayKey, input.idempotencyKey);
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicConversationId === publicConversationId
    );

    return {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      publicMessageId: input.publicMessageId,
      agentAllowedToReply: conversation?.agentAllowedToReply ?? false,
      aiState: conversation?.aiState ?? (needsManager ? "needs_manager" : "ai_collecting_info"),
      replayed: false
    };
  }

  async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    this.saveCalls += 1;

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.widgetIdempotency.get(input.request.idempotency_key);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      const aiReply = this.widgetAiIdempotency.get(`ai:${existing.publicMessageId}`);
      const conversationId = this.sessionConversations.get(existing.publicSessionId) ?? randomUUID();
      const publicConversationId =
        this.conversationPublicIds.get(conversationId) ?? randomUUID();
      const channelIdentityId =
        this.conversationIdentityIds.get(conversationId) ?? randomUUID();
      const conversation = this.leads
        .get(existing.leadId)
        ?.conversations.find(
          (candidate) =>
            candidate.channelIdentity.widgetPublicSessionId === existing.publicSessionId
        );
      const agentAllowedToReply = conversation?.agentAllowedToReply ?? false;
      const aiState = conversation?.aiState ?? "ai_collecting_info";

      return {
        leadId: existing.leadId,
        conversationId,
        publicConversationId,
        channelIdentityId,
        publicSessionId: existing.publicSessionId,
        publicMessageId: existing.publicMessageId,
        agentAllowedToReply,
        aiState,
        replayed: true,
        aiReply: aiReply
          ? {
              publicMessageId: aiReply.publicMessageId,
              body: aiReply.body,
              createdAt: aiReply.createdAt
            }
          : undefined,
        aiTurnInput: buildMemorySiteWidgetAiTurnInput(input, {
          publicConversationId,
          publicMessageId: existing.publicMessageId,
          agentAllowedToReply,
          aiState
        }, {
          recentMessages: toMemoryAiRecentMessages(
            conversation?.messages ?? [],
            existing.publicMessageId
          ),
          rollingSummary: toMemoryAiRollingSummary(
            conversation?.messages ?? [],
            existing.publicMessageId
          ),
          persistedSlots: this.aiSlotsByConversation.get(conversationId) ?? {},
          persistedRequirements:
            this.aiRequirementsByConversation.get(conversationId) ?? []
        })
      };
    }

    const now = new Date().toISOString();
    const publicSessionId = input.publicSessionId;
    let leadId = this.sessionLeads.get(publicSessionId);
    let conversationId = this.sessionConversations.get(publicSessionId);
    let lead = leadId ? this.leads.get(leadId) : undefined;

    if (!leadId || !lead) {
      leadId = randomUUID();
      conversationId = randomUUID();
      const publicConversationId = randomUUID();
      const channelIdentityId = randomUUID();
      lead = toManagerWidgetLead(input, leadId, conversationId, publicConversationId, channelIdentityId, now);
      this.leads.set(leadId, lead);
      this.sessionLeads.set(publicSessionId, leadId);
      this.sessionConversations.set(publicSessionId, conversationId);
      this.conversationLeads.set(conversationId, leadId);
      this.conversationSessions.set(conversationId, publicSessionId);
      this.conversationPublicIds.set(conversationId, publicConversationId);
      this.publicConversationIds.set(publicConversationId, conversationId);
      this.conversationIdentityIds.set(conversationId, channelIdentityId);
    } else {
      if (!conversationId) {
        conversationId = randomUUID();
        const publicConversationId = randomUUID();
        const channelIdentityId = randomUUID();
        this.sessionConversations.set(publicSessionId, conversationId);
        this.conversationLeads.set(conversationId, leadId);
        this.conversationSessions.set(conversationId, publicSessionId);
        this.conversationPublicIds.set(conversationId, publicConversationId);
        this.publicConversationIds.set(publicConversationId, conversationId);
        this.conversationIdentityIds.set(conversationId, channelIdentityId);
      }

      lead = {
        ...lead,
        updatedAt: now,
        timeline: [
          ...lead.timeline,
          {
            eventType: "conversation.message_received",
            summary: "Website widget message received",
            metadata: {
              public_message_id: input.publicMessageId,
              public_session_id: publicSessionId,
              automation_status: "disabled"
            },
            createdAt: now
          }
        ],
        conversations: lead.conversations.map((conversation) =>
          conversation.channelIdentity.widgetPublicSessionId === publicSessionId
            ? {
                ...conversation,
                agentAllowedToReply: input.agentAllowedToReply && conversation.agentAllowedToReply,
                updatedAt: now,
                messages: [
                  ...conversation.messages,
                  {
                    publicMessageId: input.publicMessageId,
                    direction: "inbound",
                    senderRole: "visitor",
                    body: input.request.message.text,
                    contentType: "text",
                    createdAt: now
                  }
                ]
              }
            : conversation
        )
      };
      this.leads.set(leadId, lead);
    }

    this.widgetIdempotency.set(input.request.idempotency_key, {
      leadId,
      publicSessionId,
      publicMessageId: input.publicMessageId,
      requestFingerprint: input.requestFingerprint
    });

    const publicConversationId = this.conversationPublicIds.get(conversationId) ?? randomUUID();
    const channelIdentityId = this.conversationIdentityIds.get(conversationId) ?? randomUUID();
    const conversation = this.leads
      .get(leadId)
      ?.conversations.find(
        (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
      );
    const agentAllowedToReply =
      (conversation?.agentAllowedToReply ?? false) && this.managerAiControl.enabled;
    const aiState = conversation?.aiState ?? "ai_collecting_info";

    return {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      publicSessionId,
      publicMessageId: input.publicMessageId,
      agentAllowedToReply,
      aiState,
      replayed: false,
      aiTurnInput: buildMemorySiteWidgetAiTurnInput(input, {
        publicConversationId,
        publicMessageId: input.publicMessageId,
        agentAllowedToReply,
        aiState
      }, {
        recentMessages: toMemoryAiRecentMessages(
          conversation?.messages ?? [],
          input.publicMessageId
        ),
        rollingSummary: toMemoryAiRollingSummary(
          conversation?.messages ?? [],
          input.publicMessageId
        ),
        persistedSlots: this.aiSlotsByConversation.get(conversationId) ?? {},
        persistedRequirements:
          this.aiRequirementsByConversation.get(conversationId) ?? []
      })
    };
  }

  async persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    if (input.channel === "telegram") {
      throw new TelegramOutboundBlockedError();
    }

    const { channel: _channel, provider: _provider, publicConversationId: _publicConversationId, ...siteWidgetInput } = input;
    return this.saveSiteWidgetAiMessage(siteWidgetInput);
  }

  async saveSiteWidgetAiMessage(
    input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    this.aiSaveCalls += 1;
    this.lastAiSaveInput = input;

    if (this.options.failAiPersistence) {
      throw new Error("ai persistence unavailable");
    }

    const existing = this.widgetAiIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        publicMessageId: existing.publicMessageId,
        body: existing.body,
        createdAt: existing.createdAt
      };
    }

    const leadId = this.conversationLeads.get(input.conversationId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);
    const lead = leadId ? this.leads.get(leadId) : undefined;

    if (!lead || !publicSessionId || leadId !== input.leadId) {
      throw new Error("memory conversation not found");
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
    );

    if (!conversation?.agentAllowedToReply || !this.managerAiControl.enabled) {
      throw new AgentReplyBlockedError();
    }

    const createdAt = new Date().toISOString();
    const sanitizedMetadata = sanitizeAiObservabilityMetadata(input.metadata);
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: createdAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_message_sent",
          summary: "Website widget AI reply persisted",
          metadata: {
            ...sanitizedMetadata,
            public_message_id: input.publicMessageId,
            inbound_public_message_id: input.inboundPublicMessageId
          },
          createdAt
        },
        ...(input.handoff
          ? [
              {
                eventType: "conversation.ai_handoff_created",
                summary: "AI dialog handed to a manager",
                metadata: {
                  public_conversation_id: conversation.publicConversationId,
                  inbound_public_message_id: input.inboundPublicMessageId,
                  outbound_public_message_id: input.publicMessageId,
                  reason: input.handoff.reason,
                  handoff_summary: input.handoff.summary,
                  slots: input.handoff.slotsSnapshot
                },
                createdAt
              }
            ]
          : [])
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.channelIdentity.widgetPublicSessionId === publicSessionId
          ? {
              ...candidate,
              agentAllowedToReply:
                input.agentAllowedToReplyAfterSend ?? candidate.agentAllowedToReply,
              aiState:
                input.agentAllowedToReplyAfterSend === false
                  ? "needs_manager"
                  : candidate.aiState,
              updatedAt: createdAt,
              messages: [
                ...candidate.messages,
                {
                  publicMessageId: input.publicMessageId,
                  direction: "outbound",
                  senderRole: "ai_assistant",
                  body: input.body,
                  contentType: "text",
                  createdAt
                }
              ]
            }
          : candidate
      )
    };

    this.leads.set(lead.leadId, updatedLead);

    if (input.slotUpdates?.length) {
      const slots = {
        ...(this.aiSlotsByConversation.get(input.conversationId) ?? {})
      };
      const conflicts = [...updatedLead.structuredIntake.conflicts];

      for (const slot of input.slotUpdates) {
        if (slots[slot.name]?.source === "manager") {
          const current = slots[slot.name];
          conflicts.push({
            publicConversationId: conversation.publicConversationId,
            name: slot.name,
            candidateValue: slot.value,
            currentValue: current?.value,
            sourceMessageId: slot.sourceMessageId,
            evidence: slot.evidence,
            applied: false,
            createdAt
          });
          continue;
        }

        slots[slot.name] = {
          value: slot.value,
          source: slot.source,
          sourceMessageId: slot.sourceMessageId,
          evidence: slot.evidence,
          confidence: slot.confidence,
          updatedAt: createdAt
        };
      }

      this.aiSlotsByConversation.set(input.conversationId, slots);
      const slotEntries = Object.entries(slots).flatMap(([name, value]) =>
        value
          ? [
              {
                publicConversationId: conversation.publicConversationId,
                name: name as AiSlotName,
                value: value.value,
                source: value.source,
                sourceMessageId: value.sourceMessageId,
                confidence: value.confidence,
                evidence: value.evidence
                  ? {
                      quote: value.evidence.quote,
                      start: value.evidence.start,
                      end: value.evidence.end
                    }
                  : undefined,
                updatedAt: value.updatedAt
              }
            ]
          : []
      );
      const knownNames = new Set(slotEntries.map((slot) => slot.name));

      updatedLead.structuredIntake = {
        slots: slotEntries,
        requirements: updatedLead.structuredIntake.requirements,
        conflicts,
        missingFields: CORE_STRUCTURED_INTAKE_SLOTS.filter((name) => !knownNames.has(name)),
        handoff: input.handoff
          ? {
              reason: input.handoff.reason,
              summary: input.handoff.summary,
              status: "active",
              createdAt
            }
          : updatedLead.structuredIntake.handoff,
        verification: input.aiRun
          ? {
              aiRunId: input.inboundPublicMessageId,
              status: input.handoff ? "handoff" : "replied",
              verdict: input.aiRun.verifierVerdict,
              generatorModelName:
                input.aiRun.generatorModelName ?? input.aiRun.modelVersion,
              verifierModelName: input.aiRun.verifierModelName,
              verifierVersion: input.aiRun.verifierVersion,
              catalogVersion: input.aiRun.catalogVersion,
              reviewLabels: [],
              createdAt
            }
          : updatedLead.structuredIntake.verification
      };
    }

    if (input.requirementUpdates?.length) {
      const requirements = [
        ...(this.aiRequirementsByConversation.get(input.conversationId) ?? [])
      ];

      for (const requirement of input.requirementUpdates) {
        const existingIndex = requirements.findIndex(
          (candidate) =>
            candidate.category === requirement.category &&
            candidate.mode === requirement.mode &&
            candidate.value === requirement.value
        );
        const persisted: AiTurnInput["knownRequirements"][number] = {
          category: requirement.category,
          mode: requirement.mode,
          value: requirement.value,
          source: requirement.source,
          sourceMessageId: requirement.sourceMessageId,
          evidence: requirement.evidence,
          confidence: requirement.confidence,
          updatedAt: createdAt
        };

        if (existingIndex >= 0) {
          requirements[existingIndex] = persisted;
        } else {
          requirements.push(persisted);
        }
      }

      this.aiRequirementsByConversation.set(input.conversationId, requirements.slice(-60));
      updatedLead.structuredIntake = {
        ...updatedLead.structuredIntake,
        requirements: requirements.map((requirement) => ({
          publicConversationId: conversation.publicConversationId,
          category: requirement.category,
          mode: requirement.mode,
          value: requirement.value,
          sourceMessageId: requirement.sourceMessageId,
          confidence: requirement.confidence,
          evidence: {
            quote: requirement.evidence.quote,
            start: requirement.evidence.start,
            end: requirement.evidence.end
          },
          updatedAt: requirement.updatedAt
        }))
      };
    }

    if (input.handoff || input.aiRun) {
      updatedLead.structuredIntake = {
        ...updatedLead.structuredIntake,
        handoff: input.handoff
          ? {
              reason: input.handoff.reason,
              summary: input.handoff.summary,
              status: "active",
              createdAt
            }
          : updatedLead.structuredIntake.handoff,
        verification: input.aiRun
          ? {
              aiRunId: input.inboundPublicMessageId,
              status: input.handoff ? "handoff" : "replied",
              verdict: input.aiRun.verifierVerdict,
              generatorModelName:
                input.aiRun.generatorModelName ?? input.aiRun.modelVersion,
              verifierModelName: input.aiRun.verifierModelName,
              verifierVersion: input.aiRun.verifierVersion,
              catalogVersion: input.aiRun.catalogVersion,
              reviewLabels: [],
              createdAt
            }
          : updatedLead.structuredIntake.verification
      };
    }

    this.widgetAiIdempotency.set(input.idempotencyKey, {
      publicMessageId: input.publicMessageId,
      body: input.body,
      createdAt,
      requestFingerprint: input.requestFingerprint
    });

    return {
      publicMessageId: input.publicMessageId,
      body: input.body,
      createdAt
    };
  }

  async recordSiteWidgetAiDegradation(
    input: RecordSiteWidgetAiDegradationInput
  ): Promise<void> {
    const lead = this.leads.get(input.leadId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);

    if (!lead || !publicSessionId) {
      throw new Error("memory conversation not found for AI degradation");
    }

    const createdAt = new Date().toISOString();
    const sanitizedMetadata = sanitizeAiObservabilityMetadata(input.metadata);
    const qualityEvent = toMemoryAiQualityEvent(input.reason);
    this.leads.set(input.leadId, {
      ...lead,
      updatedAt: createdAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_degraded",
          summary: "AI reply unavailable for this turn; manager review requested",
          metadata: {
            inbound_public_message_id: input.inboundPublicMessageId,
            input_fingerprint: input.inputFingerprint,
            reason: input.reason,
            ...sanitizedMetadata
          },
          createdAt
        }
      ],
      structuredIntake: {
        ...lead.structuredIntake,
        verification: {
          aiRunId: input.inboundPublicMessageId,
          status: "degraded",
          verdict:
            typeof sanitizedMetadata.verifier_verdict === "string"
              ? sanitizedMetadata.verifier_verdict
              : undefined,
          generatorModelName:
            typeof sanitizedMetadata.model_name === "string"
              ? sanitizedMetadata.model_name
              : undefined,
          verifierModelName:
            typeof sanitizedMetadata.verifier_model_name === "string"
              ? sanitizedMetadata.verifier_model_name
              : undefined,
          verifierVersion:
            typeof sanitizedMetadata.verifier_version === "string"
              ? sanitizedMetadata.verifier_version
              : undefined,
          catalogVersion:
            typeof sanitizedMetadata.catalog_version === "string"
              ? sanitizedMetadata.catalog_version
              : undefined,
          reviewLabels: [],
          createdAt
        }
      },
      conversations: lead.conversations.map((conversation) =>
        conversation.channelIdentity.widgetPublicSessionId === publicSessionId
          ? {
              ...conversation,
              latestUnresolvedAiQuality: {
                eventType: qualityEvent.eventType,
                reasonCode: qualityEvent.reasonCode,
                severity: qualityEvent.severity,
                runStatus: "degraded",
                createdAt
              },
              updatedAt: createdAt
            }
          : conversation
      )
    });
  }

  async recordSiteWidgetAiShadowComparison(
    input: RecordSiteWidgetAiShadowComparisonInput
  ): Promise<void> {
    if (
      !this.shadowComparisons.some(
        (comparison) =>
          comparison.inboundPublicMessageId === input.inboundPublicMessageId
      )
    ) {
      this.shadowComparisons.push(structuredClone(input));
    }
  }

  async getSiteWidgetHistory(publicSessionId: string): Promise<SiteWidgetHistoryResult | null> {
    const conversationId = this.sessionConversations.get(publicSessionId);
    const leadId = conversationId ? this.conversationLeads.get(conversationId) : undefined;
    const lead = leadId ? this.leads.get(leadId) : undefined;
    const conversation = lead?.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
    );

    if (!conversation) {
      return null;
    }

    return {
      publicSessionId,
      publicConversationId: conversation.publicConversationId,
      state:
        conversation.aiState === "closed"
          ? "closed"
          : conversation.aiState === "manager_active"
            ? "manager_active"
            : conversation.aiState === "needs_manager"
              ? "manager_pending"
              : "ai_active",
      messages: conversation.messages
        .filter(
          (message) =>
            message.contentType === "text" &&
            (message.senderRole === "visitor" ||
              message.senderRole === "ai_assistant" ||
              message.senderRole === "manager")
        )
        .map((message) => ({
          publicMessageId: message.publicMessageId,
          senderRole: message.senderRole as "visitor" | "ai_assistant" | "manager",
          text: message.body,
          submittedAt: message.createdAt
        }))
    };
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    return Array.from(this.leads.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ timeline, conversations, internalNotePlaceholder, ...lead }) => lead);
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    return this.leads.get(leadId) ?? null;
  }

  async getManagerAiControl(): Promise<ManagerAiControl> {
    return { ...this.managerAiControl };
  }

  async setManagerAiControl(input: SetManagerAiControlInput): Promise<ManagerAiControl> {
    if (input.expectedVersion !== this.managerAiControl.version) {
      throw new AiControlVersionConflictError();
    }

    this.managerAiControl = {
      enabled: input.enabled,
      version: this.managerAiControl.version + 1,
      changedByManagerEmail: input.changedByManagerEmail,
      changedAt: new Date().toISOString()
    };

    return { ...this.managerAiControl };
  }

  async setConversationAiControl(
    input: SetConversationAiControlInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicConversationId === input.publicConversationId
    );

    if (!conversation || conversation.channel !== "site_widget") {
      return null;
    }

    const nextAiState = input.enabled ? "ai_collecting_info" : "manager_active";

    if (
      conversation.agentAllowedToReply === input.enabled &&
      conversation.aiState === nextAiState
    ) {
      return lead;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_control_changed",
          summary: input.enabled ? "Manager enabled AI replies" : "Manager disabled AI replies",
          metadata: {
            public_conversation_id: input.publicConversationId,
            enabled: input.enabled,
            previous_agent_allowed_to_reply: conversation.agentAllowedToReply,
            previous_ai_state: conversation.aiState,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicConversationId === input.publicConversationId
          ? {
              ...candidate,
              agentAllowedToReply: input.enabled,
              aiState: nextAiState,
              updatedAt: changedAt
            }
          : candidate
      )
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async recordAiReviewLabel(
    input: RecordAiReviewLabelInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead?.structuredIntake.verification ||
        lead.structuredIntake.verification.aiRunId !== input.aiRunId) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: createdAt,
      structuredIntake: {
        ...lead.structuredIntake,
        verification: {
          ...lead.structuredIntake.verification,
          reviewLabels: [
            ...lead.structuredIntake.verification.reviewLabels,
            { label: input.label, note: input.note, createdAt }
          ]
        }
      },
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_review_labeled",
          summary: "Manager reviewed an AI response",
          metadata: {
            ai_run_id: input.aiRunId,
            label: input.label,
            note: input.note ?? null,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt
        }
      ]
    };

    this.leads.set(input.leadId, updatedLead);
    return updatedLead;
  }

  async changeManagerLeadStatus(
    input: ChangeManagerLeadStatusInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    if (lead.status === input.status) {
      return lead;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      status: input.status,
      nextStep: statusRequiresNextStep(input.status)
        ? {
            at: changedAt,
            summary: "Связаться с клиентом",
            channel: "manager_call"
          }
        : lead.nextStep,
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.status_changed",
          summary: `Lead status changed from ${lead.status} to ${input.status}`,
          metadata: {
            from_status: lead.status,
            to_status: input.status,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ]
    };
    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async setNextStep(input: SetNextStepInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      nextStep: {
        at: input.nextStepAt,
        summary: input.nextStepSummary,
        channel: input.nextStepChannel
      },
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.next_step_updated",
          summary: "Lead next step updated",
          metadata: {
            next_step_at: input.nextStepAt,
            next_step_summary: input.nextStepSummary,
            next_step_channel: input.nextStepChannel,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ]
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async recordManualContact(input: RecordManualContactInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      nextStep: input.nextStepAt
        ? {
            at: input.nextStepAt,
            summary: input.nextStepSummary ?? input.summary,
            channel: input.contactChannel
          }
        : lead.nextStep,
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.manual_contact_recorded",
          summary: "Manual contact recorded",
          metadata: {
            contact_channel: input.contactChannel,
            contacted_at: input.contactedAt,
            summary: input.summary,
            next_step_at: input.nextStepAt,
            next_step_summary: input.nextStepSummary,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ]
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async takeoverConversation(input: TakeoverConversationInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicConversationId === input.publicConversationId
    );

    if (!conversation) {
      return null;
    }

    if (!conversation.agentAllowedToReply && conversation.aiState === "manager_active") {
      return lead;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      nextStep: {
        at: changedAt,
        summary: "Связаться с клиентом",
        channel: conversation.channel === "telegram" ? "telegram" : "site_widget"
      },
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.manager_takeover",
          summary: "Manager takeover disabled AI replies",
          metadata: {
            public_conversation_id: input.publicConversationId,
            channel: conversation.channel,
            previous_agent_allowed_to_reply: conversation.agentAllowedToReply,
            previous_ai_state: conversation.aiState,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicConversationId === input.publicConversationId
          ? {
              ...candidate,
              agentAllowedToReply: false,
              aiState: "manager_active",
              updatedAt: changedAt
            }
          : candidate
      )
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async takeoverConversationByPublicId(
    input: TakeoverConversationByPublicIdInput
  ): Promise<ManagerLeadDetail | null> {
    const conversationId = this.publicConversationIds.get(input.publicConversationId);
    const leadId = conversationId ? this.conversationLeads.get(conversationId) : undefined;

    if (!leadId) {
      return null;
    }

    return this.takeoverConversation({
      leadId,
      publicConversationId: input.publicConversationId,
      changedByManagerId: input.changedByManagerId,
      changedByManagerEmail: input.changedByManagerEmail,
      changedByManagerRole: input.changedByManagerRole
    });
  }

  async takeoverSiteWidgetConversation(
    input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === input.publicSessionId
    );

    if (!conversation) {
      return null;
    }

    return this.takeoverConversation({
      leadId: input.leadId,
      publicConversationId: conversation.publicConversationId,
      changedByManagerId: input.changedByManagerId,
      changedByManagerEmail: input.changedByManagerEmail,
      changedByManagerRole: input.changedByManagerRole
    });
  }

  async getManagerTelegramBindingStatus(
    managerUserId: string
  ): Promise<ManagerTelegramBindingStatus> {
    const binding = Array.from(this.managerTelegramBindings.values()).find(
      (candidate) => candidate.managerUserId === managerUserId
    );

    if (!binding) {
      return { bound: false };
    }

    return {
      bound: true,
      username: binding.username,
      displayName: binding.displayName,
      externalChatId: `***${binding.externalChatId.slice(-4)}`,
      boundAt: binding.boundAt
    };
  }

  async createManagerTelegramBindToken(
    input: CreateManagerTelegramBindTokenInput
  ): Promise<CreateManagerTelegramBindTokenResult> {
    const token = `bind-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.managerTelegramTokens.set(token, {
      managerUserId: input.managerUserId,
      managerEmail: input.managerEmail,
      managerRole: input.managerRole,
      expiresAt
    });

    return { token, expiresAt };
  }

  async bindManagerTelegramChat(
    input: BindManagerTelegramChatInput
  ): Promise<BindManagerTelegramChatResult> {
    const token = this.managerTelegramTokens.get(input.token);

    if (!token) {
      return { status: "invalid_token" };
    }

    if (token.usedAt) {
      return { status: "used_token" };
    }

    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return { status: "expired_token" };
    }

    const bindingId = randomUUID();
    const now = new Date().toISOString();
    this.managerTelegramTokens.set(input.token, { ...token, usedAt: now });

    for (const [key, binding] of this.managerTelegramBindings.entries()) {
      if (
        binding.managerUserId === token.managerUserId ||
        (binding.providerAccountId === input.providerAccountId &&
          binding.externalChatId === input.externalChatId)
      ) {
        this.managerTelegramBindings.delete(key);
      }
    }

    this.managerTelegramBindings.set(bindingId, {
      id: bindingId,
      managerUserId: token.managerUserId,
      managerEmail: token.managerEmail,
      managerRole: token.managerRole,
      providerAccountId: input.providerAccountId,
      externalChatId: input.externalChatId,
      externalUserId: input.externalUserId,
      username: input.username,
      displayName: input.displayName,
      boundAt: now
    });

    return {
      status: "bound",
      managerUserId: token.managerUserId,
      managerEmail: token.managerEmail,
      managerRole: token.managerRole,
      bindingId
    };
  }

  async findManagerTelegramActor(
    input: FindManagerTelegramActorInput
  ): Promise<ManagerTelegramActor | null> {
    const binding = Array.from(this.managerTelegramBindings.values()).find(
      (candidate) =>
        candidate.providerAccountId === input.providerAccountId &&
        candidate.externalChatId === input.externalChatId &&
        candidate.externalUserId === input.externalUserId
    );

    if (!binding) {
      return null;
    }

    return {
      managerUserId: binding.managerUserId,
      managerEmail: binding.managerEmail,
      managerRole: binding.managerRole,
      bindingId: binding.id,
      externalChatId: binding.externalChatId
    };
  }

  async createManagerTelegramReplyContext(
    input: CreateManagerTelegramReplyContextInput
  ): Promise<CreateManagerTelegramReplyContextResult | null> {
    const conversationId = this.publicConversationIds.get(input.publicConversationId);
    const leadId = conversationId ? this.conversationLeads.get(conversationId) : undefined;
    const lead = leadId ? this.leads.get(leadId) : undefined;
    const conversation = lead?.conversations.find(
      (candidate) => candidate.publicConversationId === input.publicConversationId
    );

    if (!lead || !conversation || !conversationId || !leadId) {
      return null;
    }

    if (
      conversation.channel !== "telegram" ||
      conversation.agentAllowedToReply ||
      conversation.aiState !== "manager_active"
    ) {
      throw new ManagerTelegramReplyRequiresTakeoverError();
    }

    for (const context of this.managerTelegramReplyContexts.values()) {
      if (context.managerUserId === input.managerUserId && context.status === "pending") {
        context.status = "cancelled";
      }
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.managerTelegramReplyContexts.set(input.managerUserId, {
      managerUserId: input.managerUserId,
      managerTelegramBindingId: input.managerTelegramBindingId,
      leadId,
      conversationId,
      publicConversationId: input.publicConversationId,
      expiresAt,
      status: "pending"
    });

    return {
      leadId,
      publicConversationId: input.publicConversationId,
      expiresAt
    };
  }

  async clearManagerTelegramReplyContext(
    input: ClearManagerTelegramReplyContextInput
  ): Promise<void> {
    const context = this.managerTelegramReplyContexts.get(input.managerUserId);

    if (context?.managerTelegramBindingId === input.managerTelegramBindingId) {
      context.status = input.reason;
    }
  }

  async persistManagerTelegramReply(
    input: PersistManagerTelegramReplyInput
  ): Promise<PersistManagerTelegramReplyResult> {
    const existing = this.managerReplyIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        leadId: existing.leadId,
        publicConversationId: existing.publicConversationId,
        publicMessageId: existing.publicMessageId,
        deliveryStatus: "pending",
        replayed: true
      };
    }

    const context = this.managerTelegramReplyContexts.get(input.managerUserId);

    if (
      !context ||
      context.managerTelegramBindingId !== input.managerTelegramBindingId ||
      context.status !== "pending" ||
      new Date(context.expiresAt).getTime() <= Date.now()
    ) {
      throw new ManagerTelegramReplyContextMissingError();
    }

    const lead = this.leads.get(context.leadId);
    const conversation = lead?.conversations.find(
      (candidate) => candidate.publicConversationId === context.publicConversationId
    );

    if (!lead || !conversation) {
      throw new ManagerTelegramReplyContextMissingError();
    }

    if (
      conversation.channel !== "telegram" ||
      conversation.agentAllowedToReply ||
      conversation.aiState !== "manager_active"
    ) {
      throw new ManagerTelegramReplyRequiresTakeoverError();
    }

    const createdAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: createdAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.manager_message_queued",
          summary: "Manager Telegram reply queued for delivery",
          metadata: {
            public_conversation_id: context.publicConversationId,
            public_message_id: input.publicMessageId,
            delivery_status: "pending",
            changed_by_manager_email: input.managerEmail
          },
          createdAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicConversationId === context.publicConversationId
          ? {
              ...candidate,
              updatedAt: createdAt,
              messages: [
                ...candidate.messages,
                {
                  publicMessageId: input.publicMessageId,
                  direction: "outbound",
                  senderRole: "manager",
                  body: input.body,
                  contentType: "text",
                  delivery: {
                    status: "pending",
                    attemptCount: 0,
                    updatedAt: createdAt
                  },
                  createdAt
                }
              ]
            }
          : candidate
      )
    };

    context.status = "used";
    this.leads.set(lead.leadId, updatedLead);
    this.managerReplyIdempotency.set(input.idempotencyKey, {
      leadId: lead.leadId,
      publicConversationId: context.publicConversationId,
      publicMessageId: input.publicMessageId,
      requestFingerprint: input.requestFingerprint
    });

    return {
      leadId: lead.leadId,
      publicConversationId: context.publicConversationId,
      publicMessageId: input.publicMessageId,
      deliveryStatus: "pending",
      replayed: false
    };
  }

  private hasActiveManagerTelegramDestination(providerAccountId?: string) {
    return Array.from(this.managerTelegramBindings.values()).some(
      (binding) =>
        binding.providerAccountId === providerAccountId &&
        (binding.managerRole === "owner" || binding.managerRole === "manager")
    );
  }
}

function toManagerLead(
  input: SaveAcceptedSiteFormSubmissionInput,
  leadId: string,
  createdAt: string
): ManagerLeadDetail {
  return {
    leadId,
    publicSubmissionId: input.publicSubmissionId,
    status: "new",
    source: {
      channel: "site_form",
      pageUrl: input.request.source.page_url,
      formKind: input.request.source.form_kind,
      referrerUrl: input.request.source.referrer_url,
      utm: input.request.source.utm
    },
    contact: {
      name: input.request.contact.name,
      phone: input.request.contact.phone,
      email: input.request.contact.email,
      preferredContact: input.request.contact.preferred_contact,
      city: input.request.contact.city
    },
    request: {
      text: input.request.request?.message,
      productInterest: input.request.request?.product_interest
    },
    submittedAt: input.request.submitted_at,
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        eventType: "lead.created_from_site_form",
        summary: "Lead created from public website form",
        metadata: {},
        createdAt
      }
    ],
    conversations: [],
    structuredIntake: emptyStructuredIntake(),
    internalNotePlaceholder: ""
  };
}

function toManagerWidgetLead(
  input: SaveAcceptedSiteWidgetMessageInput,
  leadId: string,
  _conversationId: string,
  publicConversationId: string,
  channelIdentityId: string,
  createdAt: string
): ManagerLeadDetail {
  return {
    leadId,
    publicSubmissionId: input.publicMessageId,
    status: "new",
    source: {
      channel: "site_widget",
      pageUrl: input.request.source.page_url,
      formKind: "site_widget",
      referrerUrl: input.request.source.referrer_url,
      utm: input.request.source.utm,
      widgetInstanceId: input.request.source.widget_instance_id
    },
    contact: {
      name: input.request.contact?.name ?? "Site visitor",
      phone: input.request.contact?.phone,
      email: input.request.contact?.email,
      preferredContact: input.request.contact?.preferred_contact,
      city: input.request.contact?.city
    },
    request: {
      text: input.request.message.text
    },
    submittedAt: input.request.submitted_at,
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        eventType: "lead.created_from_site_widget",
        summary: "Lead created from public website widget",
        metadata: {
          public_session_id: input.publicSessionId,
          public_conversation_id: publicConversationId,
          channel_identity_id: channelIdentityId,
          automation_status: input.agentAllowedToReply ? "enabled" : "disabled"
        },
        createdAt
      },
      {
        eventType: "conversation.message_received",
        summary: "Website widget message received",
        metadata: {
          public_message_id: input.publicMessageId,
          public_session_id: input.publicSessionId,
          public_conversation_id: publicConversationId,
          automation_status: input.agentAllowedToReply ? "enabled" : "disabled"
        },
        createdAt
      }
    ],
    conversations: [
      {
        publicConversationId,
        channel: "site_widget",
        channelIdentity: {
          provider: "site_widget",
          widgetPublicSessionId: input.publicSessionId,
          widgetInstanceId: input.request.source.widget_instance_id
        },
        status: "open",
        aiState: "ai_collecting_info",
        agentAllowedToReply: input.agentAllowedToReply,
        sourcePageUrl: input.request.source.page_url,
        createdAt,
        updatedAt: createdAt,
        messages: [
          {
            publicMessageId: input.publicMessageId,
            direction: "inbound",
            senderRole: "visitor",
            body: input.request.message.text,
            contentType: "text",
            createdAt
          }
        ]
      }
    ],
    structuredIntake: emptyStructuredIntake(),
    internalNotePlaceholder: ""
  };
}

function buildMemorySiteWidgetAiTurnInput(
  input: SaveAcceptedSiteWidgetMessageInput,
  accepted: {
    publicConversationId: string;
    publicMessageId: string;
    agentAllowedToReply: boolean;
    aiState: SaveAcceptedSiteWidgetMessageResult["aiState"];
  },
  context: {
    recentMessages: AiTurnInput["compactContext"]["messages"];
    rollingSummary?: AiTurnInput["compactContext"]["rollingSummary"];
    persistedSlots: AiKnownSlots;
    persistedRequirements: AiTurnInput["knownRequirements"];
  }
): AiTurnInput {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: accepted.publicConversationId,
    publicMessageId: accepted.publicMessageId,
    requestFingerprint: input.requestFingerprint,
    submittedAt: input.request.submitted_at,
    text: input.request.message.text,
    page: {
      url: input.request.source.page_url,
      widgetInstanceId: input.request.source.widget_instance_id,
      referrerUrl: input.request.source.referrer_url,
      title: input.request.source.page_title
    },
    customer: {
      name: input.request.contact?.name,
      phoneProvided: Boolean(input.request.contact?.phone),
      emailProvided: Boolean(input.request.contact?.email),
      preferredContact: input.request.contact?.preferred_contact,
      city: input.request.contact?.city
    },
    visitor: {
      locale: input.request.visitor_context?.locale,
      timezone: input.request.visitor_context?.timezone
    },
    gate: {
      aiState: accepted.aiState,
      agentAllowedToReply: accepted.agentAllowedToReply
    },
    recentMessages: context.recentMessages,
    rollingSummary: context.rollingSummary,
    persistedSlots: context.persistedSlots,
    persistedRequirements: context.persistedRequirements
  });
}

function toMemoryAiRecentMessages(
  messages: ManagerLeadDetail["conversations"][number]["messages"],
  currentPublicMessageId: string
): AiTurnInput["compactContext"]["messages"] {
  const eligible = messages
    .filter(
      (message) =>
        message.publicMessageId !== currentPublicMessageId &&
        message.contentType === "text" &&
        (message.direction === "inbound" || message.direction === "outbound") &&
        (message.senderRole === "visitor" || message.senderRole === "ai_assistant") &&
        message.body.trim()
    )
    .slice(-12);
  const bounded: AiTurnInput["compactContext"]["messages"] = [];
  let remainingCharacters = 12_000;

  for (let index = eligible.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
    const message = eligible[index];

    if (!message) {
      continue;
    }

    const fullText = message.body.trim();
    const text =
      fullText.length <= remainingCharacters
        ? fullText
        : fullText.slice(fullText.length - remainingCharacters);

    bounded.unshift({
      publicMessageId: message.publicMessageId,
      direction: message.direction as "inbound" | "outbound",
      senderRole: message.senderRole as "visitor" | "ai_assistant",
      contentType: "text",
      submittedAt: message.createdAt,
      text
    });
    remainingCharacters -= text.length;
  }

  return bounded;
}

function toMemoryAiRollingSummary(
  messages: ManagerLeadDetail["conversations"][number]["messages"],
  currentPublicMessageId: string
): AiTurnInput["compactContext"]["rollingSummary"] | undefined {
  const eligible = messages.filter(
    (message) =>
      message.publicMessageId !== currentPublicMessageId &&
      message.contentType === "text" &&
      (message.direction === "inbound" || message.direction === "outbound") &&
      (message.senderRole === "visitor" || message.senderRole === "ai_assistant") &&
      message.body.trim()
  );
  const older = eligible.slice(0, Math.max(0, eligible.length - 12));

  if (!older.length) {
    return undefined;
  }

  const summary = older
    .map((message) => {
      const speaker = message.senderRole === "visitor" ? "Клиент" : "Ассистент";
      return `[${message.createdAt}] ${speaker}: ${message.body.trim()}`;
    })
    .join("\n");
  const bounded = summary.length <= 12_000 ? summary : summary.slice(-12_000);
  const covered = older.at(-1)!;

  return {
    text: bounded,
    coveredThroughPublicMessageId: covered.publicMessageId,
    updatedAt: covered.createdAt
  };
}

function toManagerTelegramLead(
  input: AcceptInboundMessageInput,
  leadId: string,
  _conversationId: string,
  publicConversationId: string,
  channelIdentityId: string,
  createdAt: string
): ManagerLeadDetail {
  const contentType = input.message.contentType ?? "text";
  const needsManager = Boolean(input.needsManagerReason) || contentType !== "text";

  return {
    leadId,
    publicSubmissionId: input.publicMessageId,
    status: "new",
    source: {
      channel: "telegram"
    },
    contact: {
      name: input.contact?.name ?? input.displayName ?? "Telegram",
      phone: input.contact?.phone,
      email: input.contact?.email,
      preferredContact: input.contact?.preferredContact ?? "telegram",
      city: input.contact?.city
    },
    request: {
      text: input.message.text || input.message.caption
    },
    submittedAt: input.message.submittedAt,
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        eventType: "lead.created_from_telegram",
        summary: "Lead created from Telegram inbound",
        metadata: {
          public_conversation_id: publicConversationId,
          channel_identity_id: channelIdentityId,
          provider_account_id: input.providerAccountId,
          external_chat_id: input.externalChatId
        },
        createdAt
      },
      {
        eventType: "conversation.message_received",
        summary: "Telegram message received",
        metadata: {
          public_message_id: input.publicMessageId,
          public_conversation_id: publicConversationId,
          channel: "telegram",
          content_type: contentType,
          provider_message_id: input.providerMessageId,
          provider_update_id: input.providerUpdateId
        },
        createdAt
      },
      ...(needsManager
        ? [
            {
              eventType: "manager.notification_enqueued",
              summary: "Telegram manager notification blocked because no destination is bound",
              metadata: {
                public_conversation_id: publicConversationId,
                public_message_id: input.publicMessageId,
                status: "blocked_no_destination",
                needs_manager_reason: input.needsManagerReason ?? "telegram_media"
              },
              createdAt
            }
          ]
        : [])
    ],
    conversations: [
      {
        publicConversationId,
        channel: "telegram",
        channelIdentity: {
          provider: input.provider,
          displayName: input.displayName ?? input.contact?.name,
          username: input.username ?? input.contact?.username,
          externalChatId: input.externalChatId,
          externalUserId: input.externalUserId
        },
        status: "open",
        aiState: needsManager ? "needs_manager" : "ai_collecting_info",
        agentAllowedToReply: input.automationRequested && !needsManager,
        createdAt,
        updatedAt: createdAt,
        messages: [toManagerConversationMessage(input, contentType, createdAt)]
      }
    ],
    structuredIntake: emptyStructuredIntake(),
    internalNotePlaceholder: ""
  };
}

function toManagerConversationMessage(
  input: AcceptInboundMessageInput,
  contentType: ConversationContentType,
  createdAt: string
): ManagerLeadDetail["conversations"][number]["messages"][number] {
  return {
    publicMessageId: input.publicMessageId,
    direction: "inbound",
    senderRole: "visitor",
    body: input.message.text || input.message.caption || `[${contentType}]`,
    contentType,
    caption: input.message.caption,
    providerFileId: input.message.providerFileId,
    createdAt
  };
}

function toMemoryAiQualityEvent(
  reason: string
): Pick<ManagerAiQualitySummary, "eventType" | "reasonCode" | "severity"> {
  if (reason === "missing_openai_config") {
    return { eventType: "degradation", reasonCode: reason, severity: "warning" };
  }

  if (reason === "model_error" || reason === "semantic_verifier_error") {
    return { eventType: "model_failure", reasonCode: reason, severity: "critical" };
  }

  if (reason === "turn_timeout") {
    return { eventType: "model_failure", reasonCode: reason, severity: "error" };
  }

  if (
    reason === "empty_model_response" ||
    reason === "unsafe_model_response" ||
    reason === "grounding_validation_failed"
  ) {
    return { eventType: "policy_violation", reasonCode: reason, severity: "error" };
  }

  if (reason === "agent_reply_blocked") {
    return { eventType: "blocked", reasonCode: reason, severity: "info" };
  }

  if (reason === "ai_persistence_unconfirmed") {
    return { eventType: "runtime_failure", reasonCode: reason, severity: "critical" };
  }

  return {
    eventType: "degradation",
    reasonCode: normalizeMemoryReasonCode(reason),
    severity: "warning"
  };
}

function normalizeMemoryReasonCode(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 120);

  return normalized || "unknown";
}

const CORE_STRUCTURED_INTAKE_SLOTS: readonly AiSlotName[] = [
  "monumentType",
  "material",
  "size",
  "city",
  "installation",
  "desiredTiming",
  "preferredContact"
];

function emptyStructuredIntake(): ManagerLeadDetail["structuredIntake"] {
  return {
    slots: [],
    requirements: [],
    conflicts: [],
    missingFields: [...CORE_STRUCTURED_INTAKE_SLOTS]
  };
}

function markTelegramNotificationPending(lead: ManagerLeadDetail): ManagerLeadDetail {
  return {
    ...lead,
    timeline: lead.timeline.map((event) =>
      event.eventType === "manager.notification_enqueued"
        ? {
            ...event,
            summary: "Telegram manager notification queued",
            metadata: {
              ...event.metadata,
              status: "pending"
            }
          }
        : event
    )
  };
}

function telegramIdentityKey(input: AcceptInboundMessageInput) {
  return `${input.provider}:${input.providerAccountId}:${input.externalChatId}`;
}

function telegramProviderReplayKey(input: AcceptInboundMessageInput) {
  const providerBase = telegramIdentityKey(input);

  if (input.providerMessageId) {
    return `${providerBase}:message:${input.providerMessageId}`;
  }

  if (input.providerUpdateId) {
    return `${providerBase}:update:${input.providerUpdateId}`;
  }

  return null;
}

function statusRequiresNextStep(status: ManagerLeadListItem["status"]) {
  return status === "in_progress" || status === "waiting_response";
}
