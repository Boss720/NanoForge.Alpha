/**
 * Mock Fetch & SSE Stream Generator for Provider Tests.
 */

export function createMockFetch(
  chunks: string[],
  options: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    delayMs?: number;
  } = {}
): typeof fetch {
  const encoder = new TextEncoder();
  const status = options.status ?? 200;
  const statusText = options.statusText ?? "OK";
  const headers = new Headers({
    "content-type": "text/event-stream",
    ...options.headers,
  });

  return (async (input: Request | string | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      const abortError = new Error("This operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    if (status >= 400) {
      return new Response(chunks.join("\n"), {
        status,
        statusText,
        headers: { "content-type": "application/json" },
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) {
          if (init?.signal?.aborted) {
            controller.error(new Error("Aborted"));
            return;
          }
          if (options.delayMs) {
            await new Promise((r) => setTimeout(r, options.delayMs));
          }
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status,
      statusText,
      headers,
    });
  }) as typeof fetch;
}
