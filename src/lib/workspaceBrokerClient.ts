import {
  workspaceBrokerResponseSchema,
  type WorkspaceActivateResult,
  type WorkspaceBrokerErrorCode,
  type WorkspaceChooseResult,
  type WorkspaceCurrentResult,
  type WorkspaceRecentListResult,
  type WorkspaceRecentPinResult,
  type WorkspaceRecentRemoveResult,
  type WorkspaceRevealResult,
  type WorkspaceSwitchStatusResult,
} from "@protocol/workspace";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface WorkspaceBrokerClientOptions {
  baseUrl: string;
  token: string;
  fetcher?: Fetcher;
  createRequestId?: () => string;
  createIdempotencyKey?: () => string;
}

export interface WorkspaceBrokerRequestOptions {
  signal?: AbortSignal;
}

export class WorkspaceBrokerError extends Error {
  readonly code: WorkspaceBrokerErrorCode | "http_error" | "invalid_response";
  readonly status?: number;
  readonly recoverable?: boolean;

  constructor(
    message: string,
    code: WorkspaceBrokerError["code"],
    options: { status?: number; recoverable?: boolean } = {},
  ) {
    super(message);
    this.name = "WorkspaceBrokerError";
    this.code = code;
    this.status = options.status;
    this.recoverable = options.recoverable;
  }
}

function defaultRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  const error = new Error("The workspace broker request was cancelled");
  error.name = "AbortError";
  return error;
}

export class WorkspaceBrokerClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: Fetcher;
  private readonly createRequestId: () => string;
  private readonly createIdempotencyKey: () => string;

  constructor(options: WorkspaceBrokerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.createRequestId = options.createRequestId ?? defaultRequestId;
    this.createIdempotencyKey = options.createIdempotencyKey ?? defaultRequestId;
  }

  choose(options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceChooseResult> {
    return this.request("/workspace/choose", "POST", { type: "workspace.choose" }, options, "workspace.choose.result");
  }

  activate(workspaceId: string, options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceActivateResult> {
    return this.request("/workspace/activate", "POST", {
      type: "workspace.activate", workspaceId, idempotencyKey: this.createIdempotencyKey(),
    }, options, "workspace.activate.result");
  }

  current(options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceCurrentResult> {
    return this.request("/workspace/current", "GET", { type: "workspace.current" }, options, "workspace.current.result");
  }

  listRecents(options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceRecentListResult> {
    return this.request("/workspace/recent", "GET", { type: "workspace.recent.list" }, options, "workspace.recent.list.result");
  }

  removeRecent(workspaceId: string, options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceRecentRemoveResult> {
    return this.request("/workspace/recent/remove", "POST", {
      type: "workspace.recent.remove", workspaceId, idempotencyKey: this.createIdempotencyKey(),
    }, options, "workspace.recent.remove.result");
  }

  setRecentPinned(workspaceId: string, pinned: boolean, options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceRecentPinResult> {
    return this.request("/workspace/recent/pin", "POST", {
      type: "workspace.recent.pin", workspaceId, pinned, idempotencyKey: this.createIdempotencyKey(),
    }, options, "workspace.recent.pin.result");
  }

  reveal(workspaceId: string, relativePath: string, options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceRevealResult> {
    return this.request("/workspace/reveal", "POST", { type: "workspace.reveal", workspaceId, relativePath }, options, "workspace.reveal.result");
  }

  switchStatus(options: WorkspaceBrokerRequestOptions = {}): Promise<WorkspaceSwitchStatusResult> {
    return this.request("/workspace/switch/status", "GET", { type: "workspace.switch.status" }, options, "workspace.switch.status.result");
  }

  private async request<T extends { type: string }>(
    path: string,
    method: "GET" | "POST",
    request: Record<string, unknown>,
    options: WorkspaceBrokerRequestOptions,
    expectedType: T["type"],
  ): Promise<T> {
    if (options.signal?.aborted) throw abortError();
    const requestId = this.createRequestId();
    const body: Record<string, unknown> = { ...request, requestId };
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw abortError();
      throw error;
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      throw new WorkspaceBrokerError("Workspace broker returned invalid JSON", "invalid_response", { status: response.status });
    }
    const parsed = workspaceBrokerResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new WorkspaceBrokerError("Workspace broker returned an invalid response", "invalid_response", { status: response.status });
    }
    if (parsed.data.type === "workspace.broker.error") {
      throw new WorkspaceBrokerError(parsed.data.message, parsed.data.code, {
        status: response.status,
        recoverable: parsed.data.recoverable,
      });
    }
    if (!response.ok) {
      throw new WorkspaceBrokerError(`Workspace broker request failed (${response.status})`, "http_error", { status: response.status });
    }
    if (parsed.data.type !== expectedType) {
      throw new WorkspaceBrokerError("Workspace broker returned an unexpected response", "invalid_response", { status: response.status });
    }
    return parsed.data as unknown as T;
  }
}
