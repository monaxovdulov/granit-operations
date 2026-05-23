export type CookieOptions = {
  path?: string;
  maxAgeSeconds?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
};

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        const rawName = separator >= 0 ? part.slice(0, separator) : part;
        const rawValue = separator >= 0 ? part.slice(separator + 1) : "";

        return [rawName, decodeURIComponent(rawValue)];
      })
  );
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAgeSeconds)}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  parts.push(`Path=${options.path ?? "/"}`);

  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }

  if (options.secure ?? true) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);

  return parts.join("; ");
}
