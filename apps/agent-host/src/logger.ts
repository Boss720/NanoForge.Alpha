import { redactObject } from "./audit/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  hostId?: string;
  correlationId?: string;
  runId?: string;
  stepId?: string;
  subagentId?: string;
  taskId?: string;
  scheduleId?: string;
  sessionId?: string;
  tool?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private level: LogLevel;
  private readonly defaultContext: LogContext;
  private readonly isJson: boolean;

  constructor(options: { level?: LogLevel; context?: LogContext; format?: "json" | "pretty" } = {}) {
    this.level = (process.env.LOG_LEVEL as LogLevel) ?? options.level ?? "info";
    this.defaultContext = options.context ?? {};
    this.isJson = (process.env.LOG_FORMAT ?? options.format) === "json" || process.env.NODE_ENV === "production";
  }

  child(context: LogContext): Logger {
    return new Logger({
      level: this.level,
      context: { ...this.defaultContext, ...context },
      format: this.isJson ? "json" : "pretty",
    });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_WEIGHTS[level] >= LOG_LEVEL_WEIGHTS[this.level];
  }

  private write(level: LogLevel, event: string, message: string, context?: LogContext, err?: unknown): void {
    if (!this.shouldLog(level)) return;

    const mergedContext = redactObject({ ...this.defaultContext, ...context }) as LogContext;
    const timestamp = new Date().toISOString();

    const entry: StructuredLogEntry = {
      timestamp,
      level,
      event,
      message,
      ...(Object.keys(mergedContext).length > 0 ? { context: mergedContext } : {}),
    };

    if (err instanceof Error) {
      entry.error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    } else if (err !== undefined) {
      entry.error = {
        name: "Error",
        message: String(err),
      };
    }

    if (this.isJson) {
      const serialized = JSON.stringify(entry);
      if (level === "error") process.stderr.write(serialized + "\n");
      else process.stdout.write(serialized + "\n");
    } else {
      const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${event}]`;
      const contextStr = Object.keys(mergedContext).length > 0 ? ` ${JSON.stringify(mergedContext)}` : "";
      const errStr = entry.error?.stack ? `\n  ${entry.error.stack}` : entry.error ? ` (${entry.error.message})` : "";
      const line = `${prefix} ${message}${contextStr}${errStr}\n`;
      if (level === "error") process.stderr.write(line);
      else process.stdout.write(line);
    }
  }

  debug(event: string, message: string, context?: LogContext): void {
    this.write("debug", event, message, context);
  }

  info(event: string, message: string, context?: LogContext): void {
    this.write("info", event, message, context);
  }

  warn(event: string, message: string, context?: LogContext, err?: unknown): void {
    this.write("warn", event, message, context, err);
  }

  error(event: string, message: string, context?: LogContext, err?: unknown): void {
    this.write("error", event, message, context, err);
  }
}

export const logger = new Logger();
