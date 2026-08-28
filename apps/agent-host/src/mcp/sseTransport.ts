import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface EventSourceLike {
  onopen?: () => void;
  onerror?: () => void;
  addEventListener(event: string, cb: (event: { data: string }) => void): void;
  close(): void;
}

export interface SseMcpClientOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export function createSseMcpTransport(options: SseMcpClientOptions): Transport {
  return new SseTransport(options);
}

class SseTransport implements Transport {
  private _options: SseMcpClientOptions;
  private _eventSource: EventSourceLike | undefined;
  private _endpoint?: string;
  
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: SseMcpClientOptions) {
    this._options = options;
  }

  async start(): Promise<void> {
    if (this._eventSource) {
      throw new Error("SseTransport already started.");
    }

    return new Promise((resolve, reject) => {
      type EventSourceCtor = new (url: string, init?: { headers?: Record<string, string> }) => EventSourceLike;
      const ES = (globalThis as unknown as { EventSource?: EventSourceCtor }).EventSource;
      if (!ES) {
        throw new Error("EventSource is not defined in global environment.");
      }

      const es = new ES(this._options.url, {
        headers: this._options.headers,
      });

      this._eventSource = es;

      es.onopen = () => {
        // We wait for the 'endpoint' event from MCP server to know where to POST
      };

      es.onerror = () => {
        if (this.onerror) {
          this.onerror(new Error("SSE Error"));
        }
        reject(new Error("Failed to connect to SSE endpoint"));
      };

      es.addEventListener("endpoint", (event: { data: string }) => {
        const endpointUri = event.data;
        // Resolve relative URL
        this._endpoint = new URL(endpointUri, this._options.url).toString();
        resolve();
      });

      es.addEventListener("message", (event: { data: string }) => {
        if (!this.onmessage) return;
        try {
          const message = JSON.parse(event.data);
          this.onmessage(message);
        } catch (error: unknown) {
          if (this.onerror) {
            this.onerror(new Error(`Failed to parse message: ${String(error)}`));
          }
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = undefined;
    }
    if (this.onclose) {
      this.onclose();
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._endpoint) {
      throw new Error("Not connected");
    }

    const response = await fetch(this._endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this._options.headers,
      },
      body: JSON.stringify(message),
      // In a real environment, handle timeout here using AbortController
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP error ${response.status}: ${text}`);
    }
  }
}
