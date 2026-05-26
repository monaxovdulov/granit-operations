import { randomUUID } from "node:crypto";

import {
  MANAGER_SESSION_COOKIE,
  hashSessionToken
} from "../../src/auth/session.js";
import type {
  AuthenticatedManager,
  CompleteYandexLoginResult,
  CreateManagerSessionInput,
  ManagerAuthRepository,
  YandexManagerProfile
} from "../../src/repositories/manager-auth-repository.js";

export function testManagerAuthConfig() {
  return {
    yandexClientId: "test-client-id",
    yandexClientSecret: "test-client-secret",
    yandexRedirectUri: "https://manager.example/auth/yandex/callback",
    sessionSecret: "test-session-secret-for-manager-auth",
    cookieSecure: false
  };
}

export class MemoryManagerAuthRepository implements ManagerAuthRepository {
  private readonly user: AuthenticatedManager;
  private readonly sessions = new Map<string, { user: AuthenticatedManager; expiresAt: Date }>();

  constructor(role: AuthenticatedManager["role"] = "owner") {
    this.user = {
      id: randomUUID(),
      email: "owner@yandex.ru",
      yandexUid: "yandex-owner-1",
      role,
      status: "active",
      lastLoginAt: new Date().toISOString()
    };
  }

  createSessionCookie() {
    const token = `test-manager-session-${randomUUID()}`;
    this.sessions.set(hashSessionToken(token), {
      user: this.user,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    return `${MANAGER_SESSION_COOKIE}=${token}`;
  }

  async completeYandexLogin(_profile: YandexManagerProfile): Promise<CompleteYandexLoginResult> {
    return { ok: true, user: this.user };
  }

  async createManagerSession(input: CreateManagerSessionInput): Promise<void> {
    this.sessions.set(input.sessionTokenHash, {
      user: this.user,
      expiresAt: input.expiresAt
    });
  }

  async findManagerSession(
    sessionTokenHash: string,
    now: Date
  ): Promise<AuthenticatedManager | null> {
    const session = this.sessions.get(sessionTokenHash);

    if (!session || session.expiresAt <= now) {
      return null;
    }

    return session.user;
  }

  async revokeManagerSession(sessionTokenHash: string): Promise<void> {
    this.sessions.delete(sessionTokenHash);
  }
}
