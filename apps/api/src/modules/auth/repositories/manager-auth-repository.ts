export type ManagerRole = "owner" | "manager" | "viewer";
export type ManagerUserStatus = "invited" | "active" | "disabled";

export type YandexManagerProfile = {
  yandexUid: string;
  email: string;
  login?: string;
  displayName?: string;
};

export type AuthenticatedManager = {
  id: string;
  email: string;
  yandexUid: string | null;
  role: ManagerRole;
  status: "active";
  lastLoginAt: string | null;
};

export type CompleteYandexLoginResult =
  | {
      ok: true;
      user: AuthenticatedManager;
    }
  | {
      ok: false;
      reason: "not_allowed" | "disabled" | "identity_conflict";
    };

export type CreateManagerSessionInput = {
  managerUserId: string;
  sessionTokenHash: string;
  expiresAt: Date;
};

export interface ManagerAuthRepository {
  completeYandexLogin(profile: YandexManagerProfile): Promise<CompleteYandexLoginResult>;
  createManagerSession(input: CreateManagerSessionInput): Promise<void>;
  findManagerSession(sessionTokenHash: string, now: Date): Promise<AuthenticatedManager | null>;
  revokeManagerSession(sessionTokenHash: string, now: Date): Promise<void>;
}

export function normalizeManagerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isManagerRole(value: string): value is ManagerRole {
  return value === "owner" || value === "manager" || value === "viewer";
}

export function isManagerUserStatus(value: string): value is ManagerUserStatus {
  return value === "invited" || value === "active" || value === "disabled";
}
