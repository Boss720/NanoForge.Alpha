/**
 * Terminal Wire Protocol Contracts — PTY virtual terminal frames.
 *
 * Defines Zod schemas and TypeScript types for bidirectional terminal
 * multiplexing over WebSockets or IPC streams between the browser control plane,
 * headless CLI, and the agent host daemon.
 *
 * Pure types and validation helpers only — no Node APIs.
 */

import { z } from "zod";

/* ------------------------------------------------------------------------ */
/* Client-to-Host Terminal Messages                                         */
/* ------------------------------------------------------------------------ */

/**
 * Request to create / allocate a new PTY session.
 */
export const terminalCreateSchema = z.object({
  type: z.literal("terminal.create"),
  id: z.string().optional(),
  sessionId: z.string().optional(),
  title: z.string().max(64).optional(),
  cols: z.number().int().positive().optional().default(80),
  rows: z.number().int().positive().optional().default(24),
  cwd: z.string().max(4096).optional(),
  env: z.record(z.string(), z.string()).optional(),
  shell: z.string().optional(),
  executable: z.string().max(1024).optional(),
  args: z.array(z.string()).optional().default([]),
});
export type TerminalCreateMessage = z.infer<typeof terminalCreateSchema>;

/**
 * Keystroke or standard input stream chunk sent to a terminal session.
 */
export const terminalInputSchema = z.object({
  type: z.literal("terminal.input"),
  id: z.string(),
  sessionId: z.string().optional(),
  data: z.string(),
});
export type TerminalInputMessage = z.infer<typeof terminalInputSchema>;

/**
 * Notification of terminal viewport geometry resize (columns and rows).
 */
export const terminalResizeSchema = z.object({
  type: z.literal("terminal.resize"),
  id: z.string(),
  sessionId: z.string().optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalResizeMessage = z.infer<typeof terminalResizeSchema>;

/**
 * Request to terminate or interrupt a terminal process with a POSIX signal.
 */
export const terminalKillSchema = z.object({
  type: z.literal("terminal.kill"),
  id: z.string(),
  sessionId: z.string().optional(),
  signal: z.string().optional(),
});
export type TerminalKillMessage = z.infer<typeof terminalKillSchema>;

/**
 * Union of all client-initiated terminal control and data frames.
 */
export const terminalClientMessageSchema = z.discriminatedUnion("type", [
  terminalCreateSchema,
  terminalInputSchema,
  terminalResizeSchema,
  terminalKillSchema,
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

/* ------------------------------------------------------------------------ */
/* Host-to-Client Terminal Messages                                         */
/* ------------------------------------------------------------------------ */

/**
 * Confirmation emitted by the host when a PTY session has been successfully spawned.
 */
export const terminalCreatedSchema = z.object({
  type: z.literal("terminal.created"),
  id: z.string(),
  sessionId: z.string().optional(),
  title: z.string().optional(),
  pid: z.number().int().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalCreatedMessage = z.infer<typeof terminalCreatedSchema>;

/**
 * Output data chunk emitted by the PTY process (ANSI/UTF-8 stream).
 */
export const terminalDataSchema = z.object({
  type: z.literal("terminal.data"),
  id: z.string(),
  sessionId: z.string().optional(),
  data: z.string(),
});
export type TerminalDataMessage = z.infer<typeof terminalDataSchema>;

/**
 * Notification emitted when the child process exits or terminates.
 */
export const terminalExitSchema = z.object({
  type: z.literal("terminal.exit"),
  id: z.string(),
  sessionId: z.string().optional(),
  exitCode: z.number().int(),
  signal: z.string().optional(),
});
export type TerminalExitMessage = z.infer<typeof terminalExitSchema>;

/**
 * Union of all host-emitted terminal lifecycle and output frames.
 */
export const terminalServerMessageSchema = z.discriminatedUnion("type", [
  terminalCreatedSchema,
  terminalDataSchema,
  terminalExitSchema,
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;

/**
 * Alias for server-to-client message union.
 */
export const terminalHostMessageSchema = terminalServerMessageSchema;
export type TerminalHostMessage = TerminalServerMessage;

/**
 * Union of all terminal messages across both directions.
 */
export const terminalMessageSchema = z.discriminatedUnion("type", [
  terminalCreateSchema,
  terminalInputSchema,
  terminalResizeSchema,
  terminalKillSchema,
  terminalCreatedSchema,
  terminalDataSchema,
  terminalExitSchema,
]);
export type TerminalMessage = z.infer<typeof terminalMessageSchema>;

/* ------------------------------------------------------------------------ */
/* Legacy / PRD Compatibility Aliases                                       */
/* ------------------------------------------------------------------------ */

export const ptyCreateFrameSchema = terminalCreateSchema;
export type PtyCreateFrame = TerminalCreateMessage;

export const ptyInputFrameSchema = terminalInputSchema;
export type PtyInputFrame = TerminalInputMessage;

export const ptyResizeFrameSchema = terminalResizeSchema;
export type PtyResizeFrame = TerminalResizeMessage;

export const ptyKillFrameSchema = terminalKillSchema;
export type PtyKillFrame = TerminalKillMessage;

export const ptyCreatedEventSchema = terminalCreatedSchema;
export type PtyCreatedEvent = TerminalCreatedMessage;

export const ptyDataEventSchema = terminalDataSchema;
export type PtyDataEvent = TerminalDataMessage;

export const ptyExitEventSchema = terminalExitSchema;
export type PtyExitEvent = TerminalExitMessage;

export const ptyClientMessageSchema = terminalClientMessageSchema;
export type PtyClientMessage = TerminalClientMessage;

export const ptyHostMessageSchema = terminalServerMessageSchema;
export type PtyHostMessage = TerminalServerMessage;

/* ------------------------------------------------------------------------ */
/* Validation and Parsing Pure Helpers                                      */
/* ------------------------------------------------------------------------ */

export function parseTerminalClientMessage(raw: unknown): TerminalClientMessage {
  return terminalClientMessageSchema.parse(raw);
}

export function safeParseTerminalClientMessage(
  raw: unknown,
): ReturnType<typeof terminalClientMessageSchema.safeParse> {
  return terminalClientMessageSchema.safeParse(raw);
}

export function parseTerminalServerMessage(raw: unknown): TerminalServerMessage {
  return terminalServerMessageSchema.parse(raw);
}

export function safeParseTerminalServerMessage(
  raw: unknown,
): ReturnType<typeof terminalServerMessageSchema.safeParse> {
  return terminalServerMessageSchema.safeParse(raw);
}

export function parseTerminalMessage(raw: unknown): TerminalMessage {
  return terminalMessageSchema.parse(raw);
}

export function safeParseTerminalMessage(
  raw: unknown,
): ReturnType<typeof terminalMessageSchema.safeParse> {
  return terminalMessageSchema.safeParse(raw);
}

export function isTerminalClientMessage(raw: unknown): raw is TerminalClientMessage {
  return terminalClientMessageSchema.safeParse(raw).success;
}

export function isTerminalServerMessage(raw: unknown): raw is TerminalServerMessage {
  return terminalServerMessageSchema.safeParse(raw).success;
}

export function isTerminalMessage(raw: unknown): raw is TerminalMessage {
  return terminalMessageSchema.safeParse(raw).success;
}
