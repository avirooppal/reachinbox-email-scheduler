import { User, Sender, Email, EmailCounts, EmailTimeline, Attachment } from "../types";

const API_BASE = "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "include"
  });

  if (!res.ok) {
    let errMsg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      errMsg = data.error || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  return res.json();
}

export const api = {
  auth: {
    me: async (): Promise<{ user: User }> => {
      return request<{ user: User }>("/auth/me");
    },
    login: async (creds: { email: string; password: string }): Promise<{ user: User; token: string }> => {
      return request<{ user: User; token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(creds)
      });
    },
    register: async (data: { email: string; password: string; name?: string }): Promise<{ user: User; token: string }> => {
      return request<{ user: User; token: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(data)
      });
    },
    logout: async (): Promise<void> => {
      await request("/auth/logout", { method: "POST" });
    },
    googleUrl: "/auth/google"
  },

  emails: {
    list: async (params: {
      status?: "scheduled" | "sent" | "failed";
      starred?: boolean;
      q?: string;
      page?: number;
      limit?: number;
    } = {}): Promise<{ emails: Email[]; total: number; page: number; totalPages: number }> => {
      const qry = new URLSearchParams();
      if (params.status) qry.set("status", params.status);
      if (params.starred !== undefined) qry.set("starred", String(params.starred));
      if (params.q) qry.set("q", params.q);
      if (params.page) qry.set("page", String(params.page));
      if (params.limit) qry.set("limit", String(params.limit));

      return request(`/api/emails?${qry.toString()}`);
    },

    counts: async (): Promise<EmailCounts> => {
      return request<EmailCounts>("/api/emails/counts");
    },

    get: async (id: string): Promise<{ email: Email }> => {
      return request<{ email: Email }>(`/api/emails/${id}`);
    },

    timeline: async (id: string): Promise<EmailTimeline> => {
      return request<EmailTimeline>(`/api/emails/${id}/timeline`);
    },

    toggleStar: async (id: string, isStarred: boolean): Promise<{ email: Email }> => {
      return request<{ email: Email }>(`/api/emails/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isStarred })
      });
    },

    delete: async (id: string): Promise<{ status: string; message: string }> => {
      return request<{ status: string; message: string }>(`/api/emails/${id}`, {
        method: "DELETE"
      });
    }
  },

  senders: {
    list: async (): Promise<{ senders: Sender[] }> => {
      return request<{ senders: Sender[] }>("/api/senders");
    },

    createEthereal: async (name?: string): Promise<{ sender: Sender }> => {
      return request<{ sender: Sender }>("/api/senders/ethereal", {
        method: "POST",
        body: JSON.stringify({ name })
      });
    }
  },

  campaigns: {
    schedule: async (payload: {
      subject: string;
      body: string;
      startAt?: string;
      senderId?: string;
      delayMs?: number;
      hourlyLimit?: number;
      attachmentIds?: string[];
      recipients: Array<{ email: string; name?: string; vars?: Record<string, string> }>;
    }) => {
      return request<{ campaignId: string; accepted: number; plannedFinishAt: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
  },

  attachments: {
    upload: async (files: File[]): Promise<{ attachments: Attachment[] }> => {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch("/api/attachments", {
        method: "POST",
        body: formData,
        credentials: "include"
      });

      if (!res.ok) {
        let msg = "Failed to upload attachments";
        try {
          const json = await res.json();
          msg = json.error || msg;
        } catch {}
        throw new Error(msg);
      }

      return res.json();
    },

    url: (id: string) => `/api/attachments/${id}`
  }
};
