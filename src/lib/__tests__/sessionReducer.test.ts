import { describe, expect, it } from "vitest";
import type { Message, Session } from "@/types";
import { appendSessionMessage, patchSessionMessage } from "@/lib/sessionReducer";

function makeMessage(id: string, content = `msg-${id}`): Message {
  return { id, role: "assistant", content, ts: 1000 };
}

function makeSession(id: string, messages: Message[]): Session {
  return { id, title: `Session ${id}`, messages, model: "test-model", createdAt: 1 };
}

describe("patchSessionMessage", () => {
  it("patches only the targeted message in the targeted session", () => {
    const sessionA = makeSession("A", [makeMessage("a1"), makeMessage("a2")]);
    const sessionB = makeSession("B", [makeMessage("b1"), makeMessage("b2")]);
    const sessions = [sessionA, sessionB];

    // Simulates the cross-session bug scenario: session A is "active" in the
    // UI, but the run targets session B. The reducer takes no activeId, so it
    // can only touch B.
    const next = patchSessionMessage(sessions, "B", "b2", (m) => ({
      ...m,
      content: "streamed delta",
      streaming: true,
    }));

    expect(next).not.toBe(sessions);
    // Session A is completely untouched — same reference.
    expect(next[0]).toBe(sessionA);
    // Session B is a new object, with the untouched message preserved.
    expect(next[1]).not.toBe(sessionB);
    expect(next[1].messages[0]).toBe(sessionB.messages[0]);
    expect(next[1].messages[1]).not.toBe(sessionB.messages[1]);
    expect(next[1].messages[1].content).toBe("streamed delta");
    expect(next[1].messages[1].streaming).toBe(true);
  });

  it("does not mutate the input array or sessions", () => {
    const sessionB = makeSession("B", [makeMessage("b1")]);
    const sessions = [makeSession("A", []), sessionB];
    const snapshot = structuredClone(sessions);

    patchSessionMessage(sessions, "B", "b1", (m) => ({ ...m, content: "changed" }));

    expect(sessions).toEqual(snapshot);
  });

  it("returns the original array reference when the session is not found", () => {
    const sessions = [makeSession("A", [makeMessage("a1")])];
    const next = patchSessionMessage(sessions, "NOPE", "a1", (m) => m);
    expect(next).toBe(sessions);
  });

  it("returns the original array reference when the message is not found", () => {
    const sessions = [makeSession("A", [makeMessage("a1")])];
    const next = patchSessionMessage(sessions, "A", "NOPE", (m) => m);
    expect(next).toBe(sessions);
  });

  it("passes the current message to fn and uses its return value", () => {
    const msg = makeMessage("m1", "hello");
    const sessions = [makeSession("S", [msg])];
    const next = patchSessionMessage(sessions, "S", "m1", (m) => ({
      ...m,
      content: m.content.toUpperCase(),
    }));
    expect(next[0].messages[0].content).toBe("HELLO");
  });
});

describe("appendSessionMessage", () => {
  it("appends to the targeted session only", () => {
    const sessionA = makeSession("A", [makeMessage("a1")]);
    const sessionB = makeSession("B", []);
    const sessions = [sessionA, sessionB];
    const msg = makeMessage("new");

    const next = appendSessionMessage(sessions, "B", msg);

    expect(next[0]).toBe(sessionA);
    expect(next[1]).not.toBe(sessionB);
    expect(next[1].messages).toHaveLength(1);
    expect(next[1].messages[0]).toBe(msg);
    // Original session B was not mutated.
    expect(sessionB.messages).toHaveLength(0);
  });

  it("returns the original array reference when the session is missing", () => {
    const sessions = [makeSession("A", [])];
    expect(appendSessionMessage(sessions, "NOPE", makeMessage("x"))).toBe(sessions);
  });
});
