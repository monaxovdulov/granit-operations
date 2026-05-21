import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PUBLIC_INTAKE_CONTRACT_VERSION,
  PUBLIC_INTAKE_EVENT_TYPE,
  type SiteFormIntakeRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "../src/app.js";
import type { ManagerAuthConfig } from "../src/auth/manager-auth.js";
import { MANAGER_SESSION_COOKIE, hashSessionToken } from "../src/auth/session.js";
import type { YandexOAuthClient } from "../src/auth/yandex-oauth.js";
import {
  IdempotencyConflictError,
  type AcceptInboundMessageInput,
  type AcceptInboundMessageResult,
  type BindManagerTelegramChatInput,
  type BindManagerTelegramChatResult,
  type ChangeManagerLeadStatusInput,
  type ClearManagerTelegramReplyContextInput,
  type CreateManagerTelegramBindTokenInput,
  type CreateManagerTelegramBindTokenResult,
  type CreateManagerTelegramReplyContextInput,
  type CreateManagerTelegramReplyContextResult,
  type FindManagerTelegramActorInput,
  type IntakeRepository,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type ManagerTelegramActor,
  type ManagerTelegramBindingStatus,
  type PersistManagerTelegramReplyInput,
  type PersistManagerTelegramReplyResult,
  type PersistAiReplyWithSendGateInput,
  type RecordManualContactInput,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult,
  type SaveSiteWidgetAiMessageInput,
  type SaveSiteWidgetAiMessageResult,
  type SetNextStepInput,
  type TakeoverConversationByPublicIdInput,
  type TakeoverConversationInput,
  type TakeoverSiteWidgetConversationInput
} from "../src/repositories/intake-repository.js";
import {
  normalizeManagerEmail,
  type AuthenticatedManager,
  type CompleteYandexLoginResult,
  type CreateManagerSessionInput,
  type ManagerAuthRepository,
  type ManagerRole,
  type ManagerUserStatus,
  type YandexManagerProfile
} from "../src/repositories/manager-auth-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];
const tempDirs: string[] = [];

type MemoryManagerUser = Omit<AuthenticatedManager, "status"> & {
  status: ManagerUserStatus;
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("manager Yandex auth", () => {
  it("keeps public intake open but denies manager API when auth is not configured", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(buildApi({ repository }));

    const publicResponse = await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: validRequest()
    });
    const managerResponse = await app.inject({ method: "GET", url: "/manager/leads" });
    const startResponse = await app.inject({ method: "GET", url: "/auth/yandex/start" });

    expect(publicResponse.statusCode).toBe(202);
    expect(managerResponse.statusCode).toBe(401);
    expect(managerResponse.json()).toEqual({ error: "manager_auth_required" });
    expect(startResponse.statusCode).toBe(503);
    expect(startResponse.json()).toEqual({ error: "manager_auth_not_configured" });
  });

  it("serves a public manager login shell without embedding lead data", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(
      buildApi({
        repository,
        managerShell: { distRoot: await createManagerShellFixture() }
      })
    );

    await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: validRequest()
    });

    const rootShellResponse = await app.inject({ method: "GET", url: "/" });
    const shellResponse = await app.inject({ method: "GET", url: "/manager" });
    const managerApiResponse = await app.inject({ method: "GET", url: "/manager/leads" });

    expect(rootShellResponse.statusCode).toBe(200);
    expect(rootShellResponse.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(rootShellResponse.body).toContain('id="root"');
    expect(rootShellResponse.body).not.toContain("Test Visitor");
    expect(rootShellResponse.body).not.toContain("+15551234567");
    expect(rootShellResponse.body).not.toContain("Need a consultation");
    expect(shellResponse.statusCode).toBe(200);
    expect(shellResponse.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(shellResponse.headers["cache-control"]).toBe("no-store");
    expect(shellResponse.body).toContain('id="root"');
    expect(shellResponse.body).not.toContain("Test Visitor");
    expect(shellResponse.body).not.toContain("+15551234567");
    expect(shellResponse.body).not.toContain("Need a consultation");
    expect(managerApiResponse.statusCode).toBe(401);
    expect(managerApiResponse.json()).toEqual({ error: "manager_auth_required" });
  });

  it("completes Yandex callback for an allowlisted email and issues a manager session", async () => {
    const repository = new MemoryIntakeRepository();
    const authRepository = new MemoryManagerAuthRepository();
    authRepository.addUser({ email: "Owner@Yandex.ru", role: "owner", status: "invited" });
    const yandexOAuthClient = new FakeYandexOAuthClient({
      yandexUid: "yandex-owner-1",
      email: "owner@yandex.ru"
    });
    const app = track(
      buildApi({
        repository,
        managerAuth: {
          repository: authRepository,
          config: testManagerAuthConfig(),
          yandexOAuthClient
        }
      })
    );

    await app.inject({
      method: "POST",
      url: "/public/intake/site-form",
      payload: validRequest()
    });

    const startResponse = await app.inject({
      method: "GET",
      url: "/auth/yandex/start?return_to=/manager/leads"
    });
    const redirect = new URL(startResponse.headers.location as string);
    const oauthCookie = cookiePair(getSetCookies(startResponse), "manager_oauth_state");
    const state = redirect.searchParams.get("state");

    expect(startResponse.statusCode).toBe(302);
    expect(redirect.origin).toBe("https://oauth.yandex.com");
    expect(redirect.searchParams.get("response_type")).toBe("code");
    expect(redirect.searchParams.get("scope")).toBe("login:email");
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state).toBeTruthy();
    expect(oauthCookie).toMatch(/^manager_oauth_state=/);

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/yandex/callback?code=auth-code&state=${state}`,
      headers: { cookie: oauthCookie }
    });
    const sessionCookie = cookiePair(getSetCookies(callbackResponse), MANAGER_SESSION_COOKIE);

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("/manager/leads");
    expect(sessionCookie).toMatch(/^manager_session=/);
    expect(authRepository.getUser("owner@yandex.ru")).toMatchObject({
      status: "active",
      yandexUid: "yandex-owner-1"
    });

    const managerResponse = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: sessionCookie }
    });
    const meResponse = await app.inject({
      method: "GET",
      url: "/manager/me",
      headers: { cookie: sessionCookie }
    });

    expect(managerResponse.statusCode).toBe(200);
    expect(managerResponse.json().leads).toHaveLength(1);
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user).toMatchObject({
      email: "owner@yandex.ru",
      role: "owner",
      status: "active"
    });
  });

  it("sets HttpOnly Secure SameSite=Lax on OAuth and session cookies in secure runtime", async () => {
    const authRepository = new MemoryManagerAuthRepository();
    authRepository.addUser({ email: "owner@yandex.ru", role: "owner", status: "invited" });
    const app = track(
      buildApi({
        repository: new MemoryIntakeRepository(),
        managerAuth: {
          repository: authRepository,
          config: testManagerAuthConfig({ cookieSecure: true }),
          yandexOAuthClient: new FakeYandexOAuthClient({
            yandexUid: "secure-owner-uid",
            email: "owner@yandex.ru"
          })
        }
      })
    );

    const startResponse = await app.inject({ method: "GET", url: "/auth/yandex/start" });
    const redirect = new URL(startResponse.headers.location as string);
    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/yandex/callback?code=auth-code&state=${redirect.searchParams.get("state")}`,
      headers: {
        cookie: cookiePair(getSetCookies(startResponse), "manager_oauth_state")
      }
    });

    expectCookieFlags(cookieHeader(getSetCookies(startResponse), "manager_oauth_state"));
    expectCookieFlags(cookieHeader(getSetCookies(callbackResponse), "manager_oauth_state"));
    expectCookieFlags(cookieHeader(getSetCookies(callbackResponse), MANAGER_SESSION_COOKIE));
  });

  it("rejects Yandex users outside the operations allowlist", async () => {
    const app = track(
      buildApi({
        repository: new MemoryIntakeRepository(),
        managerAuth: {
          repository: new MemoryManagerAuthRepository(),
          config: testManagerAuthConfig(),
          yandexOAuthClient: new FakeYandexOAuthClient({
            yandexUid: "outside-uid",
            email: "outside@yandex.ru"
          })
        }
      })
    );

    const startResponse = await app.inject({ method: "GET", url: "/auth/yandex/start" });
    const redirect = new URL(startResponse.headers.location as string);
    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/yandex/callback?code=auth-code&state=${redirect.searchParams.get("state")}`,
      headers: { cookie: cookiePair(getSetCookies(startResponse), "manager_oauth_state") }
    });

    expect(callbackResponse.statusCode).toBe(403);
    expect(callbackResponse.json()).toEqual({
      error: "manager_access_denied",
      reason: "not_allowed"
    });
    expect(getSetCookies(callbackResponse).some((cookie) => cookie.startsWith("manager_session="))).toBe(
      false
    );
  });

  it("rejects callbacks without a matching signed OAuth state cookie", async () => {
    const app = track(
      buildApi({
        repository: new MemoryIntakeRepository(),
        managerAuth: {
          repository: new MemoryManagerAuthRepository(),
          config: testManagerAuthConfig(),
          yandexOAuthClient: new FakeYandexOAuthClient({
            yandexUid: "owner-uid",
            email: "owner@yandex.ru"
          })
        }
      })
    );

    const response = await app.inject({
      method: "GET",
      url: "/auth/yandex/callback?code=auth-code&state=wrong"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_oauth_state" });
  });

  it("revokes the server-side session on logout", async () => {
    const authRepository = new MemoryManagerAuthRepository();
    const sessionCookie = authRepository.createSessionCookie();
    const app = track(
      buildApi({
        repository: new MemoryIntakeRepository(),
        managerAuth: {
          repository: authRepository,
          config: testManagerAuthConfig()
        }
      })
    );

    const beforeLogout = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: sessionCookie }
    });
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: sessionCookie }
    });
    const afterLogout = await app.inject({
      method: "GET",
      url: "/manager/leads",
      headers: { cookie: sessionCookie }
    });

    expect(beforeLogout.statusCode).toBe(200);
    expect(logout.statusCode).toBe(204);
    expect(afterLogout.statusCode).toBe(401);
  });
});

function validRequest(): SiteFormIntakeRequest {
  return {
    schema_version: PUBLIC_INTAKE_CONTRACT_VERSION,
    event_type: PUBLIC_INTAKE_EVENT_TYPE,
    idempotency_key: `test-key-${randomUUID()}`,
    submitted_at: "2026-05-11T10:00:00.000Z",
    source: {
      channel: "site_form",
      page_url: "https://granit.example/catalog/memorial",
      form_kind: "catalog_request"
    },
    contact: {
      name: "Test Visitor",
      phone: "+15551234567",
      preferred_contact: "phone"
    },
    request: {
      message: "Need a consultation for a family monument"
    },
    consent: {
      privacy_policy: true
    }
  };
}

function testManagerAuthConfig(overrides: Partial<ManagerAuthConfig> = {}): ManagerAuthConfig {
  return {
    yandexClientId: "test-client-id",
    yandexClientSecret: "test-client-secret",
    yandexRedirectUri: "https://manager.example/auth/yandex/callback",
    sessionSecret: "test-session-secret-for-manager-auth",
    cookieSecure: false,
    sessionTtlSeconds: 60 * 60,
    oauthStateTtlSeconds: 10 * 60,
    ...overrides
  };
}

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function getSetCookies(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers["set-cookie"];

  if (Array.isArray(header)) {
    return header as string[];
  }

  if (typeof header === "string") {
    return [header];
  }

  return [];
}

function cookiePair(cookies: string[], name: string): string {
  const cookie = cookieHeader(cookies, name);

  return cookie.split(";")[0] ?? "";
}

function cookieHeader(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));

  if (!cookie) {
    return "";
  }

  return cookie;
}

function expectCookieFlags(cookie: string) {
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Lax");
}

async function createManagerShellFixture(): Promise<string> {
  const distRoot = await mkdtemp(path.join(tmpdir(), "granit-manager-shell-"));
  tempDirs.push(distRoot);
  await mkdir(path.join(distRoot, "assets"));
  await writeFile(
    path.join(distRoot, "index.html"),
    '<!doctype html><html lang="ru"><body><div id="root"></div><script src="/manager/assets/app.js"></script></body></html>',
    "utf8"
  );
  await writeFile(path.join(distRoot, "assets", "app.js"), 'console.log("manager shell");', "utf8");

  return distRoot;
}

class FakeYandexOAuthClient implements YandexOAuthClient {
  constructor(private readonly profile: YandexManagerProfile) {}

  buildAuthorizationUrl(input: { state: string; codeChallenge: string }): string {
    const url = new URL("https://oauth.yandex.com/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "https://manager.example/auth/yandex/callback");
    url.searchParams.set("scope", "login:email");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return url.toString();
  }

  async exchangeCodeForToken(): Promise<string> {
    return "test-yandex-access-token";
  }

  async fetchProfile(): Promise<YandexManagerProfile> {
    return this.profile;
  }
}

class MemoryManagerAuthRepository implements ManagerAuthRepository {
  private readonly users = new Map<string, MemoryManagerUser>();
  private readonly sessions = new Map<
    string,
    {
      userId: string;
      expiresAt: Date;
      revokedAt?: Date;
    }
  >();

  constructor() {
    this.addUser({
      email: "session-owner@yandex.ru",
      role: "owner",
      status: "active",
      yandexUid: "session-owner-uid"
    });
  }

  addUser(input: {
    email: string;
    role: ManagerRole;
    status: ManagerUserStatus;
    yandexUid?: string | null;
  }) {
    const email = normalizeManagerEmail(input.email);
    this.users.set(email, {
      id: randomUUID(),
      email,
      yandexUid: input.yandexUid ?? null,
      role: input.role,
      status: input.status,
      lastLoginAt: null
    });
  }

  getUser(email: string) {
    return this.users.get(normalizeManagerEmail(email));
  }

  createSessionCookie() {
    const user = this.users.get("session-owner@yandex.ru");

    if (!user) {
      throw new Error("test user missing");
    }

    const token = `test-manager-session-${randomUUID()}`;
    this.sessions.set(hashSessionToken(token), {
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    return `${MANAGER_SESSION_COOKIE}=${token}`;
  }

  async completeYandexLogin(profile: YandexManagerProfile): Promise<CompleteYandexLoginResult> {
    const user = this.users.get(normalizeManagerEmail(profile.email));

    if (!user) {
      return { ok: false, reason: "not_allowed" };
    }

    if (user.status === "disabled") {
      return { ok: false, reason: "disabled" };
    }

    if (user.yandexUid && user.yandexUid !== profile.yandexUid) {
      return { ok: false, reason: "identity_conflict" };
    }

    user.yandexUid = profile.yandexUid;
    user.status = "active";
    user.lastLoginAt = new Date().toISOString();

    return { ok: true, user: user as AuthenticatedManager };
  }

  async createManagerSession(input: CreateManagerSessionInput): Promise<void> {
    this.sessions.set(input.sessionTokenHash, {
      userId: input.managerUserId,
      expiresAt: input.expiresAt
    });
  }

  async findManagerSession(
    sessionTokenHash: string,
    now: Date
  ): Promise<AuthenticatedManager | null> {
    const session = this.sessions.get(sessionTokenHash);

    if (!session || session.revokedAt || session.expiresAt <= now) {
      return null;
    }

    const user = Array.from(this.users.values()).find((candidate) => candidate.id === session.userId);

    if (!user || user.status !== "active") {
      return null;
    }

    return user as AuthenticatedManager;
  }

  async revokeManagerSession(sessionTokenHash: string, now: Date): Promise<void> {
    const session = this.sessions.get(sessionTokenHash);

    if (session) {
      session.revokedAt = now;
    }
  }
}

class MemoryIntakeRepository implements IntakeRepository {
  private readonly leads = new Map<string, ManagerLeadDetail>();
  private readonly idempotency = new Map<
    string,
    {
      leadId: string;
      publicSubmissionId: string;
      requestFingerprint: string;
    }
  >();

  async saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult> {
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
    if (input.channel !== "site_widget") {
      throw new Error("not implemented in manager auth tests");
    }

    const saved = await this.saveAcceptedSiteWidgetMessage({
      publicMessageId: input.publicMessageId,
      publicSessionId: input.widgetPublicSessionId ?? randomUUID(),
      agentAllowedToReply: input.automationRequested,
      request: {
        schema_version: "site_widget.v1",
        event_type: "site_widget.message_submitted",
        idempotency_key: input.idempotencyKey,
        submitted_at: input.message.submittedAt,
        public_session_id: input.widgetPublicSessionId,
        source: {
          channel: "site_widget",
          page_url: input.sourcePageUrl ?? "https://granit.example/widget",
          widget_instance_id: input.widgetInstanceId ?? "widget"
        },
        message: {
          role: "visitor",
          text: input.message.text
        },
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
      replayed: saved.replayed
    };
  }

  async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    const leadId = randomUUID();
    const conversationId = randomUUID();
    const publicConversationId = randomUUID();
    const channelIdentityId = randomUUID();
    const now = new Date().toISOString();
    this.leads.set(leadId, {
      leadId,
      publicSubmissionId: input.publicMessageId,
      status: "new",
      source: {
        channel: "site_widget",
        pageUrl: input.request.source.page_url,
        formKind: "site_widget",
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
      createdAt: now,
      updatedAt: now,
      timeline: [
        {
          eventType: "lead.created_from_site_widget",
          summary: "Lead created from public website widget",
          metadata: {},
          createdAt: now
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
          createdAt: now,
          updatedAt: now,
          messages: [
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
      ],
      internalNotePlaceholder: ""
    });

    return {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      publicSessionId: input.publicSessionId,
      publicMessageId: input.publicMessageId,
      agentAllowedToReply: input.agentAllowedToReply,
      aiState: "ai_collecting_info",
      replayed: false
    };
  }

  async persistAiReplyWithSendGate(
    _input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    throw new Error("not implemented in manager auth tests");
  }

  async saveSiteWidgetAiMessage(
    _input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    throw new Error("not implemented in manager auth tests");
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    return Array.from(this.leads.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ timeline, conversations, internalNotePlaceholder, ...lead }) => lead);
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    return this.leads.get(leadId) ?? null;
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
      nextStep:
        input.status === "in_progress" || input.status === "waiting_response"
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

  async setNextStep(_input: SetNextStepInput): Promise<ManagerLeadDetail | null> {
    return null;
  }

  async recordManualContact(_input: RecordManualContactInput): Promise<ManagerLeadDetail | null> {
    return null;
  }

  async takeoverSiteWidgetConversation(
    _input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null> {
    return null;
  }

  async takeoverConversation(_input: TakeoverConversationInput): Promise<ManagerLeadDetail | null> {
    return null;
  }

  async takeoverConversationByPublicId(
    _input: TakeoverConversationByPublicIdInput
  ): Promise<ManagerLeadDetail | null> {
    return null;
  }

  async getManagerTelegramBindingStatus(
    _managerUserId: string
  ): Promise<ManagerTelegramBindingStatus> {
    return { bound: false };
  }

  async createManagerTelegramBindToken(
    _input: CreateManagerTelegramBindTokenInput
  ): Promise<CreateManagerTelegramBindTokenResult> {
    return {
      token: `bind-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };
  }

  async bindManagerTelegramChat(
    _input: BindManagerTelegramChatInput
  ): Promise<BindManagerTelegramChatResult> {
    return { status: "invalid_token" };
  }

  async findManagerTelegramActor(
    _input: FindManagerTelegramActorInput
  ): Promise<ManagerTelegramActor | null> {
    return null;
  }

  async createManagerTelegramReplyContext(
    _input: CreateManagerTelegramReplyContextInput
  ): Promise<CreateManagerTelegramReplyContextResult | null> {
    return null;
  }

  async clearManagerTelegramReplyContext(
    _input: ClearManagerTelegramReplyContextInput
  ): Promise<void> {}

  async persistManagerTelegramReply(
    _input: PersistManagerTelegramReplyInput
  ): Promise<PersistManagerTelegramReplyResult> {
    throw new Error("not implemented in manager auth tests");
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
    internalNotePlaceholder: ""
  };
}
