import type { LeadStatus, ManagerLeadDetail, ManagerLeadListItem, ManagerUser } from "./types";

export class AuthRequiredError extends Error {
  constructor() {
    super("manager auth required");
    this.name = "AuthRequiredError";
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown
  ) {
    super(`manager api request failed with ${status}`);
    this.name = "ApiRequestError";
  }
}

export const managerApi = {
  async me() {
    return requestJson<{ user: ManagerUser }>("/manager/me");
  },
  async listLeads() {
    return requestJson<{ leads: ManagerLeadListItem[] }>("/manager/leads");
  },
  async getLead(leadId: string) {
    return requestJson<{ lead: ManagerLeadDetail }>(`/manager/leads/${encodeURIComponent(leadId)}`);
  },
  async changeLeadStatus(leadId: string, status: LeadStatus) {
    return requestJson<{ lead: ManagerLeadDetail }>(
      `/manager/leads/${encodeURIComponent(leadId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status })
      }
    );
  },
  async takeoverConversation(leadId: string, publicConversationId: string) {
    return requestJson<{ lead: ManagerLeadDetail }>(
      `/manager/leads/${encodeURIComponent(leadId)}/conversations/${encodeURIComponent(
        publicConversationId
      )}/takeover`,
      {
        method: "PATCH"
      }
    );
  },
  async logout() {
    const response = await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });

    if (!response.ok && response.status !== 401) {
      throw new ApiRequestError(response.status, await readPayload(response));
    }
  }
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin"
  });

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    throw new ApiRequestError(response.status, await readPayload(response));
  }

  return (await readPayload(response)) as T;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
