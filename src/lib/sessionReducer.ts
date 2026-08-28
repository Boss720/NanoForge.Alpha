import type { Message, Session } from "@/types";

/**
 * Pure session-list reducers (roadmap Task 0.2).
 *
 * These functions never mutate their inputs and preserve object identity for
 * every session/message that was not touched, so React can rely on reference
 * equality for memoization.
 *
 * The key design point: they take an explicit `sessionId` and know nothing
 * about an "active" session. Callers must capture the target session id at
 * send time (not `activeId`) so streaming deltas cannot leak into a session
 * the user switched to mid-run.
 */

/**
 * Returns a new sessions array where the message `msgId` inside session
 * `sessionId` has been replaced by `fn(message)`. Every other session and
 * message keeps its original object reference.
 *
 * If the session or message is not found, the ORIGINAL array reference is
 * returned unchanged (callers can bail out via `===`).
 */
export function patchSessionMessage(
  sessions: Session[],
  sessionId: string,
  msgId: string,
  fn: (m: Message) => Message,
): Session[] {
  let changed = false;
  const next = sessions.map((session) => {
    if (session.id !== sessionId) return session;
    let msgFound = false;
    const messages = session.messages.map((m) => {
      if (m.id !== msgId) return m;
      msgFound = true;
      return fn(m);
    });
    if (!msgFound) return session;
    changed = true;
    return { ...session, messages };
  });
  return changed ? next : sessions;
}

/**
 * Returns a new sessions array with `message` appended to session
 * `sessionId`. All other sessions keep their original references. If the
 * session is not found the original array reference is returned.
 */
export function appendSessionMessage(
  sessions: Session[],
  sessionId: string,
  message: Message,
): Session[] {
  let changed = false;
  const next = sessions.map((session) => {
    if (session.id !== sessionId) return session;
    changed = true;
    return { ...session, messages: [...session.messages, message] };
  });
  return changed ? next : sessions;
}
