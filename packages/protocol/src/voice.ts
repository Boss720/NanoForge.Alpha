/**
 * Voice Call Wire Protocol, State Machine, & Validation Schemas.
 *
 * Provides isomorphic Zod schemas, TypeScript types, and pure helper utilities
 * for interactive voice call sessions, transcripts, TTS chunks, barge-in interrupts,
 * and WebSocket wire frames.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Status Enums & Identifiers                                      */
/* ------------------------------------------------------------------ */

export const voiceCallStatusSchema = z.enum([
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "muted",
  "ended",
]);
export type VoiceCallStatus = z.infer<typeof voiceCallStatusSchema>;

export const voiceCallEndReasonSchema = z.enum([
  "user_hangup",
  "agent_hangup",
  "timeout",
  "error",
  "connection_lost",
]);
export type VoiceCallEndReason = z.infer<typeof voiceCallEndReasonSchema>;

export const voiceInterruptReasonSchema = z.enum([
  "user_speech_detected",
  "user_manual_button",
  "session_closed",
]);
export type VoiceInterruptReason = z.infer<typeof voiceInterruptReasonSchema>;

export const voiceTranscriptKindSchema = z.enum(["interim", "final"]);
export type VoiceTranscriptKind = z.infer<typeof voiceTranscriptKindSchema>;

export const voiceTimbreSchema = z.enum(["neutral", "warm", "crisp", "expressive"]);
export type VoiceTimbre = z.infer<typeof voiceTimbreSchema>;

export const voiceSpeakerSchema = z.enum(["user", "agent"]);
export type VoiceSpeaker = z.infer<typeof voiceSpeakerSchema>;

export const voiceTurnStateSchema = z.enum([
  "started",
  "transcribing",
  "thinking",
  "speaking",
  "completed",
  "interrupted",
  "error",
]);
export type VoiceTurnState = z.infer<typeof voiceTurnStateSchema>;

/* ------------------------------------------------------------------ */
/* 2. Constants & Protocol Error Codes                                */
/* ------------------------------------------------------------------ */

export const VOICE_ERROR_CODES = {
  ERR_VOICE_SESSION_NOT_FOUND: "ERR_VOICE_SESSION_NOT_FOUND",
  ERR_VOICE_INVALID_STATE_TRANSITION: "ERR_VOICE_INVALID_STATE_TRANSITION",
  ERR_VOICE_ALREADY_ACTIVE: "ERR_VOICE_ALREADY_ACTIVE",
  ERR_VOICE_ALREADY_MUTED: "ERR_VOICE_ALREADY_MUTED",
  ERR_VOICE_NOT_MUTED: "ERR_VOICE_NOT_MUTED",
  ERR_VOICE_INTERRUPT_FAILED: "ERR_VOICE_INTERRUPT_FAILED",
  ERR_VOICE_AUDIO_STREAM_ERROR: "ERR_VOICE_AUDIO_STREAM_ERROR",
  ERR_VOICE_SYNTHESIS_ERROR: "ERR_VOICE_SYNTHESIS_ERROR",
  ERR_VOICE_RECOGNITION_ERROR: "ERR_VOICE_RECOGNITION_ERROR",
  ERR_VOICE_DEVICE_PERMISSION_DENIED: "ERR_VOICE_DEVICE_PERMISSION_DENIED",
} as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];

export const DEFAULT_VOICE_RATE = 1.0;
export const DEFAULT_VOICE_PITCH = 1.0;
export const DEFAULT_VOICE_TIMBRE: VoiceTimbre = "neutral";
export const DEFAULT_VOICE_LANGUAGE = "en-US";
export const DEFAULT_MIC_GAIN = 1.0;
export const DEFAULT_SPEAKER_VOLUME = 1.0;
export const MIN_MIC_GAIN = 0.0;
export const MAX_MIC_GAIN = 2.0;
export const MIN_SPEAKER_VOLUME = 0.0;
export const MAX_SPEAKER_VOLUME = 1.0;
export const MAX_TRANSCRIPT_LENGTH = 16384;

/* ------------------------------------------------------------------ */
/* 3. Core Entity Schemas                                             */
/* ------------------------------------------------------------------ */

export const voiceProfileSchema = z.object({
  voiceId: z.string().min(1).default("default-voice"),
  name: z.string().min(1).default("Agent Voice"),
  rate: z.number().min(0.1).max(10.0).default(DEFAULT_VOICE_RATE),
  pitch: z.number().min(0.0).max(2.0).default(DEFAULT_VOICE_PITCH),
  timbre: voiceTimbreSchema.default(DEFAULT_VOICE_TIMBRE),
  language: z.string().min(1).default(DEFAULT_VOICE_LANGUAGE),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const voiceParticipantSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().max(128).optional(),
  agentId: z.string().optional(),
  agentName: z.string().min(1).max(128).default("NanoForge Agent"),
  avatarUrl: z.string().optional(),
});
export type VoiceParticipant = z.infer<typeof voiceParticipantSchema>;

export const voiceCallSessionSchema = z.object({
  sessionId: z.string().uuid(),
  status: voiceCallStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationSeconds: z.number().nonnegative().default(0),
  isMuted: z.boolean().default(false),
  inputGain: z.number().min(MIN_MIC_GAIN).max(MAX_MIC_GAIN).default(DEFAULT_MIC_GAIN),
  outputVolume: z.number().min(MIN_SPEAKER_VOLUME).max(MAX_SPEAKER_VOLUME).default(DEFAULT_SPEAKER_VOLUME),
  voiceProfile: voiceProfileSchema.default({
    voiceId: "default-voice",
    name: "Agent Voice",
    rate: DEFAULT_VOICE_RATE,
    pitch: DEFAULT_VOICE_PITCH,
    timbre: DEFAULT_VOICE_TIMBRE,
    language: DEFAULT_VOICE_LANGUAGE,
  }),
  participant: voiceParticipantSchema,
  currentTurnId: z.string().optional(),
  totalTurns: z.number().int().nonnegative().default(0),
  endReason: voiceCallEndReasonSchema.optional(),
});
export type VoiceCallSession = z.infer<typeof voiceCallSessionSchema>;

export const voiceTranscriptFrameSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  speaker: voiceSpeakerSchema,
  kind: voiceTranscriptKindSchema,
  text: z.string().max(MAX_TRANSCRIPT_LENGTH),
  confidence: z.number().min(0).max(1).default(1.0),
  isFinal: z.boolean(),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  waveformBins: z.array(z.number()).optional(),
});
export type VoiceTranscriptFrame = z.infer<typeof voiceTranscriptFrameSchema>;

export const voiceTtsChunkSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  textChunk: z.string(),
  audioBase64: z.string().optional(),
  mimeType: z.string().default("audio/wav").optional(),
  isLastChunk: z.boolean().default(false),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  waveformBins: z.array(z.number()).optional(),
});
export type VoiceTtsChunk = z.infer<typeof voiceTtsChunkSchema>;

export const voiceTurnSyncSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  state: voiceTurnStateSchema,
  prompt: z.string(),
  response: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional(),
  timestamp: z.string().datetime(),
});
export type VoiceTurnSync = z.infer<typeof voiceTurnSyncSchema>;

export const voiceInterruptFrameSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  reason: voiceInterruptReasonSchema,
  interruptedAtMs: z.number().nonnegative(),
  spokenTextSnippet: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type VoiceInterruptFrame = z.infer<typeof voiceInterruptFrameSchema>;

export const audioVisualDataSchema = z.object({
  timeDomainData: z.array(z.number()),
  frequencyData: z.array(z.number()),
  rmsVolume: z.number().min(0.0).max(1.0),
});
export type AudioVisualData = z.infer<typeof audioVisualDataSchema>;

/* ------------------------------------------------------------------ */
/* 4. Client RPC Message Schemas (Client -> Host)                     */
/* ------------------------------------------------------------------ */

export const voiceSessionStartMsgSchema = z.object({
  type: z.literal("voice.session.start"),
  requestId: z.string().min(1),
  voiceProfile: voiceProfileSchema.partial().optional(),
  participant: voiceParticipantSchema.partial().optional(),
  inputGain: z.number().min(MIN_MIC_GAIN).max(MAX_MIC_GAIN).optional(),
  outputVolume: z.number().min(MIN_SPEAKER_VOLUME).max(MAX_SPEAKER_VOLUME).optional(),
});
export type VoiceSessionStartMsg = z.infer<typeof voiceSessionStartMsgSchema>;

export const voiceSessionPauseMsgSchema = z.object({
  type: z.literal("voice.session.pause"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
});
export type VoiceSessionPauseMsg = z.infer<typeof voiceSessionPauseMsgSchema>;

export const voiceSessionResumeMsgSchema = z.object({
  type: z.literal("voice.session.resume"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
});
export type VoiceSessionResumeMsg = z.infer<typeof voiceSessionResumeMsgSchema>;

export const voiceSessionEndMsgSchema = z.object({
  type: z.literal("voice.session.end"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  reason: voiceCallEndReasonSchema.optional(),
});
export type VoiceSessionEndMsg = z.infer<typeof voiceSessionEndMsgSchema>;

export const voiceSessionMuteMsgSchema = z.object({
  type: z.literal("voice.session.mute"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  muted: z.boolean(),
});
export type VoiceSessionMuteMsg = z.infer<typeof voiceSessionMuteMsgSchema>;

export const voiceSessionGainMsgSchema = z.object({
  type: z.literal("voice.session.gain"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  inputGain: z.number().min(MIN_MIC_GAIN).max(MAX_MIC_GAIN).optional(),
  outputVolume: z.number().min(MIN_SPEAKER_VOLUME).max(MAX_SPEAKER_VOLUME).optional(),
});
export type VoiceSessionGainMsg = z.infer<typeof voiceSessionGainMsgSchema>;

export const voiceTranscriptSubmitMsgSchema = z.object({
  type: z.literal("voice.transcript.submit"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  text: z.string().max(MAX_TRANSCRIPT_LENGTH),
  isFinal: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});
export type VoiceTranscriptSubmitMsg = z.infer<typeof voiceTranscriptSubmitMsgSchema>;

export const voiceInterruptMsgSchema = z.object({
  type: z.literal("voice.interrupt"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).optional(),
  reason: voiceInterruptReasonSchema,
  spokenTextSnippet: z.string().optional(),
});
export type VoiceInterruptMsg = z.infer<typeof voiceInterruptMsgSchema>;

export const voiceAudioChunkMsgSchema = z.object({
  type: z.literal("voice.audio.chunk"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).optional(),
  data: z.string(),
  format: z.string().optional(),
});
export type VoiceAudioChunkMsg = z.infer<typeof voiceAudioChunkMsgSchema>;

export const voiceClientMessageSchema = z.discriminatedUnion("type", [
  voiceSessionStartMsgSchema,
  voiceSessionPauseMsgSchema,
  voiceSessionResumeMsgSchema,
  voiceSessionEndMsgSchema,
  voiceSessionMuteMsgSchema,
  voiceSessionGainMsgSchema,
  voiceTranscriptSubmitMsgSchema,
  voiceInterruptMsgSchema,
  voiceAudioChunkMsgSchema,
]);
export type VoiceClientMessage = z.infer<typeof voiceClientMessageSchema>;

/* ------------------------------------------------------------------ */
/* 5. Host Event Schemas (Host -> Client)                             */
/* ------------------------------------------------------------------ */

export const voiceSessionReadyEventSchema = z.object({
  type: z.literal("voice.session.ready"),
  requestId: z.string().optional(),
  session: voiceCallSessionSchema,
  at: z.string().datetime(),
});
export type VoiceSessionReadyEvent = z.infer<typeof voiceSessionReadyEventSchema>;

export const voiceSessionStateEventSchema = z.object({
  type: z.literal("voice.session.state"),
  requestId: z.string().optional(),
  sessionId: z.string().uuid(),
  status: voiceCallStatusSchema,
  at: z.string().datetime(),
  detail: z.string().optional(),
});
export type VoiceSessionStateEvent = z.infer<typeof voiceSessionStateEventSchema>;

export const voiceTranscriptEventSchema = z.object({
  type: z.literal("voice.transcript.event"),
  frame: voiceTranscriptFrameSchema,
  at: z.string().datetime(),
});
export type VoiceTranscriptEvent = z.infer<typeof voiceTranscriptEventSchema>;

export const voiceTtsChunkEventSchema = z.object({
  type: z.literal("voice.tts.chunk"),
  chunk: voiceTtsChunkSchema,
  at: z.string().datetime(),
});
export type VoiceTtsChunkEvent = z.infer<typeof voiceTtsChunkEventSchema>;

export const voiceTurnEventSchema = z.object({
  type: z.literal("voice.turn.event"),
  turn: voiceTurnSyncSchema,
  at: z.string().datetime(),
});
export type VoiceTurnEvent = z.infer<typeof voiceTurnEventSchema>;

export const voiceInterruptedEventSchema = z.object({
  type: z.literal("voice.interrupted"),
  frame: voiceInterruptFrameSchema,
  at: z.string().datetime(),
});
export type VoiceInterruptedEvent = z.infer<typeof voiceInterruptedEventSchema>;

export const voiceErrorEventSchema = z.object({
  type: z.literal("voice.error"),
  requestId: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  code: z.string(),
  message: z.string(),
  at: z.string().datetime(),
});
export type VoiceErrorEvent = z.infer<typeof voiceErrorEventSchema>;

export const voiceHostEventSchema = z.discriminatedUnion("type", [
  voiceSessionReadyEventSchema,
  voiceSessionStateEventSchema,
  voiceTranscriptEventSchema,
  voiceTtsChunkEventSchema,
  voiceTurnEventSchema,
  voiceInterruptedEventSchema,
  voiceErrorEventSchema,
]);
export type VoiceHostEvent = z.infer<typeof voiceHostEventSchema>;

/* ------------------------------------------------------------------ */
/* 6. State Transition Engine & Helper Functions                      */
/* ------------------------------------------------------------------ */

const VALID_TRANSITIONS: Readonly<Record<VoiceCallStatus, ReadonlySet<VoiceCallStatus>>> = {
  idle: new Set(["connecting", "ended"]),
  connecting: new Set(["listening", "muted", "ended", "idle"]),
  listening: new Set(["thinking", "speaking", "muted", "ended", "idle"]),
  thinking: new Set(["speaking", "listening", "muted", "ended", "idle"]),
  speaking: new Set(["listening", "thinking", "muted", "ended", "idle"]),
  muted: new Set(["listening", "thinking", "speaking", "ended", "idle"]),
  ended: new Set(["connecting", "idle"]),
};

export function isValidVoiceStateTransition(
  current: VoiceCallStatus,
  next: VoiceCallStatus
): boolean {
  if (current === next) return true;
  const allowed = VALID_TRANSITIONS[current];
  return allowed ? allowed.has(next) : false;
}
export const canTransitionVoiceState = isValidVoiceStateTransition;

export function isVoiceCallActive(status: VoiceCallStatus): boolean {
  return status !== "idle" && status !== "ended";
}
export const isVoiceSessionActive = isVoiceCallActive;

export function isVoiceCallTerminal(status: VoiceCallStatus): boolean {
  return status === "ended";
}
export const isVoiceSessionTerminal = isVoiceCallTerminal;

export function canAcceptVoiceInput(status: VoiceCallStatus): boolean {
  return status === "listening";
}

export function canInterruptAgent(status: VoiceCallStatus): boolean {
  return status === "speaking" || status === "thinking";
}

export function clampGain(gain: number): number {
  return Math.min(MAX_MIC_GAIN, Math.max(MIN_MIC_GAIN, Number.isFinite(gain) ? gain : DEFAULT_MIC_GAIN));
}

export function clampVolume(volume: number): number {
  return Math.min(MAX_SPEAKER_VOLUME, Math.max(MIN_SPEAKER_VOLUME, Number.isFinite(volume) ? volume : DEFAULT_SPEAKER_VOLUME));
}

export function createVoiceProfile(params?: Partial<VoiceProfile>): VoiceProfile {
  return voiceProfileSchema.parse({
    voiceId: params?.voiceId ?? "default-voice",
    name: params?.name ?? "Agent Voice",
    rate: params?.rate ?? DEFAULT_VOICE_RATE,
    pitch: params?.pitch ?? DEFAULT_VOICE_PITCH,
    timbre: params?.timbre ?? DEFAULT_VOICE_TIMBRE,
    language: params?.language ?? DEFAULT_VOICE_LANGUAGE,
  });
}

export function createVoiceParticipant(params?: Partial<VoiceParticipant>): VoiceParticipant {
  return voiceParticipantSchema.parse({
    userId: params?.userId ?? "user-default",
    userName: params?.userName,
    agentId: params?.agentId,
    agentName: params?.agentName ?? "NanoForge Agent",
    avatarUrl: params?.avatarUrl,
  });
}

export type CreateVoiceCallSessionParams = Omit<
  Partial<VoiceCallSession>,
  "voiceProfile" | "participant"
> & {
  voiceProfile?: Partial<VoiceProfile>;
  participant?: Partial<VoiceParticipant>;
};

export function createVoiceCallSession(params?: CreateVoiceCallSessionParams): VoiceCallSession {
  const sessionId = params?.sessionId ?? crypto.randomUUID();
  const startedAt = params?.startedAt ?? new Date().toISOString();

  return voiceCallSessionSchema.parse({
    sessionId,
    status: params?.status ?? "connecting",
    startedAt,
    endedAt: params?.endedAt,
    durationSeconds: params?.durationSeconds ?? 0,
    isMuted: params?.isMuted ?? false,
    inputGain: params?.inputGain !== undefined ? clampGain(params.inputGain) : DEFAULT_MIC_GAIN,
    outputVolume: params?.outputVolume !== undefined ? clampVolume(params.outputVolume) : DEFAULT_SPEAKER_VOLUME,
    voiceProfile: createVoiceProfile(params?.voiceProfile),
    participant: createVoiceParticipant(params?.participant),
    currentTurnId: params?.currentTurnId,
    totalTurns: params?.totalTurns ?? 0,
    endReason: params?.endReason,
  });
}

export function createVoiceTranscriptFrame(params: {
  sessionId: string;
  turnId: string;
  speaker: VoiceSpeaker;
  kind: VoiceTranscriptKind;
  text: string;
  confidence?: number;
  isFinal: boolean;
  timestamp?: string;
  durationMs?: number;
  waveformBins?: number[];
}): VoiceTranscriptFrame {
  return voiceTranscriptFrameSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    speaker: params.speaker,
    kind: params.kind,
    text: params.text,
    confidence: params.confidence ?? 1.0,
    isFinal: params.isFinal,
    timestamp: params.timestamp ?? new Date().toISOString(),
    durationMs: params.durationMs,
    waveformBins: params.waveformBins,
  });
}

export function createVoiceTtsChunk(params: {
  sessionId: string;
  turnId: string;
  chunkIndex: number;
  textChunk: string;
  audioBase64?: string;
  mimeType?: string;
  isLastChunk?: boolean;
  timestamp?: string;
  durationMs?: number;
  waveformBins?: number[];
}): VoiceTtsChunk {
  return voiceTtsChunkSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    chunkIndex: params.chunkIndex,
    textChunk: params.textChunk,
    audioBase64: params.audioBase64,
    mimeType: params.mimeType ?? "audio/wav",
    isLastChunk: params.isLastChunk ?? false,
    timestamp: params.timestamp ?? new Date().toISOString(),
    durationMs: params.durationMs,
    waveformBins: params.waveformBins,
  });
}

export function createVoiceTurnSync(params: {
  sessionId: string;
  turnId: string;
  state: VoiceTurnState;
  prompt: string;
  response?: string;
  tokensUsed?: number;
  latencyMs?: number;
  timestamp?: string;
}): VoiceTurnSync {
  return voiceTurnSyncSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
    prompt: params.prompt,
    response: params.response,
    tokensUsed: params.tokensUsed,
    latencyMs: params.latencyMs,
    timestamp: params.timestamp ?? new Date().toISOString(),
  });
}

export function createVoiceInterruptFrame(params: {
  sessionId: string;
  turnId: string;
  reason: VoiceInterruptReason;
  interruptedAtMs: number;
  spokenTextSnippet?: string;
  timestamp?: string;
}): VoiceInterruptFrame {
  return voiceInterruptFrameSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    reason: params.reason,
    interruptedAtMs: params.interruptedAtMs,
    spokenTextSnippet: params.spokenTextSnippet,
    timestamp: params.timestamp ?? new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* 7. Wire Parsing and Validation Utilities                           */
/* ------------------------------------------------------------------ */

export function parseVoiceClientMessage(raw: unknown): VoiceClientMessage {
  return voiceClientMessageSchema.parse(raw);
}

export function safeParseVoiceClientMessage(
  raw: unknown
): ReturnType<typeof voiceClientMessageSchema.safeParse> {
  return voiceClientMessageSchema.safeParse(raw);
}

export function parseVoiceHostEvent(raw: unknown): VoiceHostEvent {
  return voiceHostEventSchema.parse(raw);
}

export function safeParseVoiceHostEvent(
  raw: unknown
): ReturnType<typeof voiceHostEventSchema.safeParse> {
  return voiceHostEventSchema.safeParse(raw);
}

export function isVoiceClientMessage(raw: unknown): raw is VoiceClientMessage {
  return voiceClientMessageSchema.safeParse(raw).success;
}

export function isVoiceHostEvent(raw: unknown): raw is VoiceHostEvent {
  return voiceHostEventSchema.safeParse(raw).success;
}
