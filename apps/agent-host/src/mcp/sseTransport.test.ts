import { describe, it, expect } from "vitest";
import { createSseMcpTransport } from "./sseTransport";

// Mock EventSource globally for testing
class MockEventSource {
  onopen?: () => void;
  onerror?: (event: unknown) => void;
  listeners: Record<string, Array<(event: { data: unknown }) => void>> = {};
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(event: string, cb: (event: { data: unknown }) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  close() {}
  
  // Test helper to trigger events
  emit(event: string, data: unknown) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        cb({ data });
      }
    }
  }
}

describe("sseTransport", () => {
  it("connects and receives endpoint", async () => {
    // Create our mock EventSource first
    const mockES = new MockEventSource("http://localhost:3000/sse");
    
    // Override the constructor locally in the module by polluting global
    const globalObject = globalThis as unknown as { EventSource?: (url: string) => MockEventSource };
    const originalEventSource = globalObject.EventSource;
    globalObject.EventSource = function(url: string) {
      mockES.url = url;
      return mockES;
    };

    const transport = createSseMcpTransport({ url: "http://localhost:3000/sse" });
    
    // Start connection asynchronously
    const startPromise = transport.start();
    
    expect(transport).toBeDefined();

    // Trigger endpoint event
    mockES.emit("endpoint", "/message-endpoint");
    await startPromise;
    
    // Clean up
    globalObject.EventSource = originalEventSource;
  });
});
