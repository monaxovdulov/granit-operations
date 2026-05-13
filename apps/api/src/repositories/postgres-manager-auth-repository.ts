import { eq, sql } from "drizzle-orm";

import { managerSessions, managerUsers, type OperationsDb } from "@granit/db";

import {
  normalizeManagerEmail,
  type AuthenticatedManager,
  type CompleteYandexLoginResult,
  type CreateManagerSessionInput,
  type ManagerAuthRepository,
  type YandexManagerProfile
} from "./manager-auth-repository.js";

export class PostgresManagerAuthRepository implements ManagerAuthRepository {
  constructor(private readonly db: OperationsDb) {}

  async completeYandexLogin(profile: YandexManagerProfile): Promise<CompleteYandexLoginResult> {
    const email = normalizeManagerEmail(profile.email);
    const [user] = await this.db
      .select()
      .from(managerUsers)
      .where(sql`lower(${managerUsers.email}) = ${email}`)
      .limit(1);

    if (!user) {
      return { ok: false, reason: "not_allowed" };
    }

    if (user.status === "disabled") {
      return { ok: false, reason: "disabled" };
    }

    if (user.yandexUid && user.yandexUid !== profile.yandexUid) {
      return { ok: false, reason: "identity_conflict" };
    }

    try {
      const [updated] = await this.db
        .update(managerUsers)
        .set({
          email,
          yandexUid: profile.yandexUid,
          status: "active",
          lastLoginAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(managerUsers.id, user.id))
        .returning();

      if (!updated || updated.status !== "active") {
        return { ok: false, reason: "not_allowed" };
      }

      return { ok: true, user: toAuthenticatedManager(updated) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: "identity_conflict" };
      }

      throw error;
    }
  }

  async createManagerSession(input: CreateManagerSessionInput): Promise<void> {
    await this.db.insert(managerSessions).values({
      managerUserId: input.managerUserId,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt
    });
  }

  async findManagerSession(sessionTokenHash: string, now: Date): Promise<AuthenticatedManager | null> {
    const [row] = await this.db
      .select()
      .from(managerSessions)
      .innerJoin(managerUsers, eq(managerSessions.managerUserId, managerUsers.id))
      .where(eq(managerSessions.sessionTokenHash, sessionTokenHash))
      .limit(1);

    if (!row) {
      return null;
    }

    if (row.manager_sessions.revokedAt || row.manager_sessions.expiresAt <= now) {
      return null;
    }

    if (row.manager_users.status !== "active") {
      return null;
    }

    await this.db
      .update(managerSessions)
      .set({ lastSeenAt: now })
      .where(eq(managerSessions.id, row.manager_sessions.id));

    return toAuthenticatedManager(row.manager_users);
  }

  async revokeManagerSession(sessionTokenHash: string, now: Date): Promise<void> {
    await this.db
      .update(managerSessions)
      .set({ revokedAt: now })
      .where(eq(managerSessions.sessionTokenHash, sessionTokenHash));
  }
}

function toAuthenticatedManager(user: typeof managerUsers.$inferSelect): AuthenticatedManager {
  if (user.status !== "active") {
    throw new Error(`cannot authenticate manager user with status ${user.status}`);
  }

  if (user.role !== "owner" && user.role !== "manager" && user.role !== "viewer") {
    throw new Error(`invalid manager role ${user.role}`);
  }

  return {
    id: user.id,
    email: user.email,
    yandexUid: user.yandexUid,
    role: user.role,
    status: "active",
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
