/**
 * ReyGrid API client — the main HTTP client.
 *
 * Built on the Fetch API (works in Node.js ≥18, Deno, Bun, browsers),
 * with full control over the base URL and authentication.
 */

import {
  mapApiError,
  ReyGridNetworkError,
  ReyGridStreamError,
} from "./errors.js";
import { Paginator } from "./pagination.js";
import { parseSSEStream } from "./sse.js";
import type {
  CancelToolResponse,
  ChatDeltaEvent,
  ChatRequest,
  ChatResponse,
  Conversation,
  ConversationsResponse,
  DeleteMessagesResponse,
  Message,
  MessagesResponse,
  PingResponse,
  Tool,
  Usage,
  ValidateResponse,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://reygrid.com/api/v1";

export interface ReyGridConfig {
  /**
   * API base URL.  Defaults to `https://reygrid.com/api/v1`.
   * Override to point at a custom/proxy/local deployment.
   *
   * ```ts
   * new ReyGrid({ apiKey: "...", baseUrl: "http://localhost:8080/api/v1" })
   * ```
   */
  baseUrl?: string;

  /**
   * API key sent as a `Authorization: Bearer <key>` header.
   */
  apiKey?: string;

  /**
   * Additional default headers applied to every request.
   */
  headers?: Record<string, string>;

  /** Request timeout in milliseconds (default 60_000). */
  timeoutMs?: number;

  /**
   * Advanced: provide a custom `fetch` implementation
   * (useful for testing, proxies, or non-standard runtimes).
   */
  fetch?: typeof fetch;

  /** Global error handler hook, e.g. for logging. */
  onError?: (error: unknown, context: RequestContext) => void;
}

export interface RequestContext {
  method: string;
  url: string;
  /** true when the request was authenticated. */
  authenticated: boolean;
}

/**
 * The ReyGrid client.
 */
export class ReyGrid {
  public readonly baseUrl: string;
  private apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onError?: ReyGridConfig["onError"];

  constructor(config: ReyGridConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.headers = { ...config.headers };
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.onError = config.onError;

    if (!this.fetchImpl) {
      throw new Error(
        "No fetch implementation available. Node.js ≥18 is required, or supply `fetch` in config.",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /** Set (or clear) the API key at runtime. */
  setApiKey(apiKey?: string): this {
    this.apiKey = apiKey;
    return this;
  }

  /** Get the current API key. */
  getApiKey(): string | undefined {
    return this.apiKey;
  }

  // -------------------------------------------------------------------------
  // Low-level request
  // -------------------------------------------------------------------------

  /**
   * Execute a raw request against the API.
   * Generally you should use the typed convenience methods instead.
   */
  async request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), init.timeoutMs ?? this.timeoutMs);

    const requestInit: RequestInit = {
      ...init,
      signal: init.signal ?? ctrl.signal,
      headers: this.buildHeaders(init.headers),
    };

    const context: RequestContext = {
      method: init.method ?? "GET",
      url,
      authenticated: Boolean(this.apiKey),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(url, requestInit);
    } catch (e) {
      clearTimeout(timeout);
      const err = new ReyGridNetworkError(
        `Network error while calling ${context.method} ${url}: ${(e as Error).message}`,
        e,
      );
      this.onError?.(err, context);
      throw err;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await this.parseErrorBody(res);
      const mapped = mapApiError(res.status, body);
      this.onError?.(mapped, context);
      throw mapped;
    }

    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (isJson) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  private buildHeaders(existing?: HeadersInit): Headers {
    const h = new Headers();
    for (const [k, v] of Object.entries(this.headers)) h.set(k, v);
    if (existing) {
      const tmp = new Headers(existing);
      tmp.forEach((value, key) => h.set(key, value));
    }
    if (!h.has("Accept")) h.set("Accept", "application/json");
    if (!h.has("Content-Type")) h.set("Content-Type", "application/json");
    if (this.apiKey) h.set("Authorization", `Bearer ${this.apiKey}`);
    return h;
  }

  private async parseErrorBody(res: Response): Promise<any> {
    try {
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (ct.includes("application/json")) return JSON.parse(text);
      if (res.status === 401) {
        return { error: text || "Unauthorized", code: "AUTH_REQUIRED" };
      }
      return { message: text || `HTTP ${res.status}` };
    } catch {
      return { message: `HTTP ${res.status}` };
    }
  }

  // -------------------------------------------------------------------------
  // Health / validate
  // -------------------------------------------------------------------------

  /** Health check — is the API operational? */
  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>("/ping");
  }

  /**
   * Validate the API key and return usage info.
   * Throws `ReyGridAuthError` when the key is missing or invalid.
   */
  async validate(): Promise<ValidateResponse> {
    return this.request<ValidateResponse>("/validate");
  }

  /** Convenience: resolve the current usage / quota. */
  async getUsage(): Promise<Usage> {
    const v = await this.validate();
    return v.usage;
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  /**
   * Send a message to an agent.
   *
   * @param agentId   The ID of the agent.
   * @param message   The user message text.
   * @param opts      Additional chat options (conversationId, userId,
   *                  tools, results, stream).
   */
  async chat(agentId: string, message: string, opts: Omit<ChatRequest, "message"> = {}): Promise<ChatResponse> {
    const body: ChatRequest = { message, ...opts };
    return this.request<ChatResponse>(`/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Stream a chat response via SSE.
   *
   * Returns an async iterator of `ChatDeltaEvent` deltas.
   *
   * @example
   * ```ts
   * const stream = reygrid.streamChat("agent-123", "Hello!");
   * for await (const delta of stream) {
   *   process.stdout.write(delta.content ?? "");
   * }
   * ```
   */
  async *streamChat(
    agentId: string,
    message: string,
    opts: Omit<ChatRequest, "message" | "stream"> = {},
  ): AsyncGenerator<ChatDeltaEvent> {
    const url = `${this.baseUrl}/agents/${encodeURIComponent(agentId)}/chat`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);

    const body: ChatRequest = { ...opts, message, stream: true };

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      throw new ReyGridNetworkError(`Network error streaming chat: ${(e as Error).message}`, e);
    }

    if (!res.ok) {
      clearTimeout(timeout);
      const errBody = await this.parseErrorBody(res);
      throw mapApiError(res.status, errBody);
    }

    try {
      yield* parseSSEStream(res.body);
    } catch (e) {
      throw new ReyGridStreamError(`Stream error: ${(e as Error).message}`, e);
    } finally {
      clearTimeout(timeout);
    }
  }

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------

  /**
   * List conversations belonging to an agent.
   */
  async listConversations(agentId: string, opts: { page?: number; size?: number } = {}): Promise<ConversationsResponse> {
    const qs = this.queryString({ page: opts.page, size: opts.size });
    return this.request<ConversationsResponse>(
      `/agents/${encodeURIComponent(agentId)}/conversations${qs}`,
    );
  }

  /**
   * Paginate through all of an agent's conversations.
   */
  paginateConversations(agentId: string, size = 20): Paginator<Conversation> {
    return new Paginator<Conversation>((page, pageSize) =>
      this.listConversations(agentId, { page, size: pageSize }).then((r) => ({
        data: r.conversations,
        pagination: r.pagination,
      })),
      size,
    );
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  /**
   * List messages of a conversation.
   *
   * @param conversationRef  A conversationId OR a persistent userId.
   */
  async listMessages(
    agentId: string,
    conversationRef: string,
    opts: { page?: number; size?: number } = {},
  ): Promise<MessagesResponse> {
    const qs = this.queryString({ page: opts.page, size: opts.size });
    return this.request<MessagesResponse>(
      `/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationRef)}/messages${qs}`,
    );
  }

  /**
   * Paginate through all messages of a conversation.
   */
  paginateMessages(
    agentId: string,
    conversationRef: string,
    size = 20,
  ): Paginator<Message> {
    return new Paginator<Message>((page, pageSize) =>
      this.listMessages(agentId, conversationRef, { page, size: pageSize }).then((r) => ({
        data: r.messages,
        pagination: r.pagination,
      })),
      size,
    );
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  /** Delete an entire conversation (all its messages). */
  async deleteConversation(
    agentId: string,
    conversationRef: string,
  ): Promise<DeleteMessagesResponse> {
    return this.request<DeleteMessagesResponse>(
      `/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationRef)}`,
      { method: "DELETE" },
    );
  }

  /**
   * Delete a specific message.
   *
   * @param cascade  When true, also deletes the message immediately following.
   */
  async deleteMessage(
    agentId: string,
    conversationRef: string,
    messageId: string,
    cascade = false,
  ): Promise<DeleteMessagesResponse> {
    const qs = this.queryString({ cascade });
    return this.request<DeleteMessagesResponse>(
      `/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationRef)}/messages/${encodeURIComponent(messageId)}${qs}`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------------------------------------
  // Tool cancel
  // -------------------------------------------------------------------------

  /** Cancel an in-flight tool call belonging to a conversation. */
  async cancelToolCall(
    agentId: string,
    conversationRef: string,
    toolCallId: string,
  ): Promise<CancelToolResponse> {
    return this.request<CancelToolResponse>(
      `/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationRef)}/tool/cancel/${encodeURIComponent(toolCallId)}`,
      { method: "POST" },
    );
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private queryString(params: Record<string, unknown>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (entries.length === 0) return "";
    const qs = new URLSearchParams();
    for (const [k, v] of entries) qs.set(k, String(v));
    return `?${qs.toString()}`;
  }
}

export type { Tool };