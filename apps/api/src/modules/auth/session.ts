import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MANAGER_SESSION_COOKIE = "manager_session";
export const MANAGER_OAUTH_STATE_COOKIE = "manager_oauth_state";

export type SignedCookiePayload = {
  createdAt: string;
};

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createSignedCookieValue(payload: SignedCookiePayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function readSignedCookieValue<TPayload extends SignedCookiePayload>(
  value: string | undefined,
  secret: string,
  maxAgeMs: number,
  now: Date
): TPayload | null {
  if (!value) {
    return null;
  }

  const [encodedPayload, receivedSignature] = value.split(".");

  if (!encodedPayload || !receivedSignature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, secret);

  if (!safeEqual(receivedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TPayload;
    const createdAt = new Date(payload.createdAt);

    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }

    if (now.getTime() - createdAt.getTime() > maxAgeMs) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
