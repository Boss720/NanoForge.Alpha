/**
 * Authenticated local agent host — Module 2, Task 4.
 *
 * Loopback-only Fastify server. The browser control plane connects over a
 * single-use authenticated WebSocket:
 *   ws://127.0.0.1:<ephemeral-port>/agent?token=<single-use-token>
 *
 * Security contract enforced here:
 * - binds 127.0.0.1 by default, or configurable via HOST/BIND_ADDRESS;
 * - cryptographic tokens, each consumable exactly once (`tokenStore.consume`);
 * - missing / malformed / unknown / reused tokens close the socket with 4401;
 * - origin validation on WebSocket handshakes rejecting untrusted web origins;
 * - max message payload limit configured to prevent memory exhaustion;
 * - strict security headers on all HTTP responses;
 * - every inbound frame is validated against the Zod protocol (protocol.ts);
 *   violations close the socket with 4400.
 *
 * `createHost()` is the test/programmatic factory. Executed directly
 * (`npm run start:host` / tsx) it reads PORT, HOST, and TOKEN from the environment
 * (generating an ephemeral port and a fresh token when unset) and prints the
 * connection URL.
 */
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { attachAgentSession, type AgentSessionOptions } from "./session.js";
import {
  decodeClientMessage,
  type HostMessage,
  type RunState,
} from "./protocol.js";
import {
  safeParseTerminalClientMessage,
  type TerminalServerMessage,
} from "@protocol/terminal";
import { SubagentSupervisor } from "./agents/supervisor.js";
import { DaemonManager } from "./daemons/manager.js";
import { PtyManager } from "./terminal/ptyManager.js";
import { logger } from "./logger.js";
import type { WorkspaceDescriptor } from "@protocol/workspace";
import { validateWorkspaceRoot } from "./workspace/runtime.js";

export const HOST_VERSION = "0.1.0";

/** WebSocket close codes used by this host. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_INVALID_MESSAGE = 4400;

export const MAX_WS_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  // The packaged launcher serves the UI on 4183 by default.
  "http://localhost:4183",
  "http://127.0.0.1:4183",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4040",
  "http://127.0.0.1:4040",
  "https://nano-gpt.com",
];

/**
 * Accept launcher-provided browser origins only when they are explicit local
 * loopback HTTP origins. This keeps custom launcher ports usable without
 * turning an environment variable into a remote-origin bypass.
 */
export function parseLauncherAllowedOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(",").flatMap((candidate) => {
    try {
      const url = new URL(candidate.trim());
      if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) return [];
      if (!url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return [];
      return [url.origin];
    } catch {
      return [];
    }
  });
}

export function isAllowedOrigin(
  origin?: string,
  allowedOrigins?: (string | RegExp)[],
  allowNonBrowser = false,
): boolean {
  if (!origin || origin === "null") {
    return Boolean(allowNonBrowser);
  }
  try {
    const url = new URL(origin);
    const normalized = `${url.protocol}//${url.host}`.toLowerCase();
    const effective = allowedOrigins && allowedOrigins.length > 0
      ? allowedOrigins
      : DEFAULT_ALLOWED_ORIGINS;

    for (const allowed of effective) {
      if (typeof allowed === "string") {
        const normAllowed = allowed.toLowerCase().trim();
        if (normalized === normAllowed || origin.toLowerCase().trim() === normAllowed) {
          return true;
        }
      } else if (allowed instanceof RegExp) {
        if (allowed.test(normalized) || allowed.test(origin)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Tokens are 192-bit random values, base64url-encoded (32 chars). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const TOKEN_BYTES = 24;

/* ------------------------------------------------------------------------ */
/* Single-use token store                                                   */
/* ------------------------------------------------------------------------ */

export interface TokenStore {
  /** Mint a fresh single-use token and register it. */
  issue(): string;
  /** Register an externally supplied token; rejects malformed values. */
  register(token: string): string;
  /**
   * Consume a token: returns true exactly once for a registered token, then
   * never again. Malformed, unknown, or reused tokens return false.
   */
  consume(token: unknown): boolean;
  /** Number of currently outstanding (unconsumed) tokens. */
  readonly size: number;
}

export function createTokenStore(maxOutstanding = 64): TokenStore {
  const outstanding = new Set<string>();
  return {
    issue() {
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      return this.register(token);
    },
    register(token: string) {
      if (!TOKEN_PATTERN.test(token)) {
        throw new Error("refusing to register a malformed token");
      }
      if (outstanding.size >= maxOutstanding) {
        const oldest = outstanding.values().next().value;
        if (oldest !== undefined) outstanding.delete(oldest);
      }
      outstanding.add(token);
      return token;
    },
    consume(token: unknown) {
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
      if (!outstanding.has(token)) return false;
      outstanding.delete(token);
      return true;
    },
    get size() {
      return outstanding.size;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Host factory                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Protocol attachment: installs the message loop on an authenticated socket.
 * The default is the wave-1 scaffold ({@link attachAgentProtocol}); the
 * Task 20 composition (`composition.ts`) injects a RunCoordinator-backed
 * session through this seam instead.
 */
export type ProtocolAttachment = (
  socket: WebSocket,
  context: { hostId: string },
) => void;

export interface HostOptions {
  /** Host/interface to bind (defaults to 127.0.0.1 or env HOST/BIND_ADDRESS). */
  host?: string;
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Pre-shared token (e.g. from env); a fresh one is generated otherwise. */
  token?: string;
  /** Enable Fastify's logger. */
  logger?: boolean;
  /** Maximum inbound WS message payload size in bytes (default: 5MB). */
  maxPayload?: number;
  /** Additional allowed origins for WebSocket connections. */
  allowedOrigins?: (string | RegExp)[];
  /** Whether to accept missing/null origins from non-browser/CLI transports. Defaults to false. */
  allowNonBrowserClients?: boolean;
  /** Authenticated-socket handler; defaults to {@link attachAgentProtocol}. */
  attach?: ProtocolAttachment;
  /** Configuration for the real coordinator/workspace session. */
  session?: AgentSessionOptions;
}

export interface HostHandle {
  app: FastifyInstance;
  /** Host interface bound. */
  host: string;
  /** Actual bound port (resolved after listen). */
  port: number;
  /** The single-use token for the first connection. */
  token: string;
  /** Token store (tests mint extra tokens via `tokenStore.issue()`). */
  tokenStore: TokenStore;
  /** Stable id of this host instance, sent in `host.ready`. */
  hostId: string;
  /** Subsystems */
  daemonManager: DaemonManager;
  ptyManager: PtyManager;
  subagentSupervisor: SubagentSupervisor;
  /** Canonical workspace identity shared by every privileged subsystem. */
  workspace: WorkspaceDescriptor;
  /** Whether the host is shutting down. */
  readonly isClosing: boolean;
  /** Close all sockets and shut the server down. */
  close(graceMs?: number): Promise<void>;
}

export async function createHost(options: HostOptions = {}): Promise<HostHandle> {
  const configuredGeneration = Number(process.env.NANOFORGE_WORKSPACE_GENERATION ?? "1");
  const workspaceGeneration = Number.isSafeInteger(configuredGeneration) && configuredGeneration > 0
    ? configuredGeneration
    : 1;
  const validatedWorkspace = await validateWorkspaceRoot(
    options.session?.workspaceRoot ?? process.env.NANOFORGE_WORKSPACE ?? process.cwd(),
    workspaceGeneration,
  );
  const workspaceRoot = validatedWorkspace.canonicalRoot;
  const app = Fastify({ logger: options.logger ?? false });
  const tokenStore = createTokenStore();
  const token =
    options.token !== undefined
      ? tokenStore.register(options.token)
      : tokenStore.issue();
  const hostId = randomUUID();
  const sockets = new Set<WebSocket>();
  let isClosing = false;

  const daemonManager = options.session?.daemonManager ?? new DaemonManager(undefined, undefined, workspaceRoot);
  const ptyManager = options.session?.ptyManager ?? new PtyManager({ workspaceRoot });
  const subagentSupervisor =
    options.session?.subagentSupervisor ??
    new SubagentSupervisor({
      workspaceRoot,
      daemonSupervisor: daemonManager.supervisor,
      scheduler: daemonManager.scheduler,
    });

  const sameRoot = (candidate: string | undefined): boolean =>
    candidate !== undefined && path.resolve(candidate).toLowerCase() === path.resolve(workspaceRoot).toLowerCase();
  if (!sameRoot(ptyManager.workspaceRoot)) {
    throw new Error("PTY manager workspace root does not match the host workspace root");
  }
  if (!sameRoot(subagentSupervisor.workspaceRoot)) {
    throw new Error("Subagent supervisor workspace root does not match the host workspace root");
  }
  if (daemonManager.workspaceRoot !== undefined && !sameRoot(daemonManager.workspaceRoot)) {
    throw new Error("Daemon manager workspace root does not match the host workspace root");
  }
  if (!sameRoot(subagentSupervisor.memory.workspaceRoot)) {
    throw new Error("Memory engine workspace root does not match the host workspace root");
  }

  await app.register(websocket, {
    options: {
      maxPayload: options.maxPayload ?? MAX_WS_PAYLOAD_BYTES,
    },
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox;");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
  });

  const bindHost =
    options.host ??
    process.env.BIND_ADDRESS ??
    process.env.HOST ??
    process.env.NANOFORGE_HOST ??
    "127.0.0.1";
  const portToBind = options.port ?? (process.env.PORT ? Number(process.env.PORT) : 0);

  app.get("/health", async () => {
    const mem = process.memoryUsage();
    const subagentNodes = subagentSupervisor.registry.getAll();
    const tasks = daemonManager.supervisor.listTasks();
    const schedules = daemonManager.scheduler.listSchedules();
    const terminals = ptyManager.listSessions();

    return {
      ok: true,
      version: HOST_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      hostId,
      bindAddress: bindHost,
      port: (app.server.address() as any)?.port ?? portToBind,
      memory: {
        rssMb: +(mem.rss / (1024 * 1024)).toFixed(2),
        heapTotalMb: +(mem.heapTotal / (1024 * 1024)).toFixed(2),
        heapUsedMb: +(mem.heapUsed / (1024 * 1024)).toFixed(2),
        externalMb: +(mem.external / (1024 * 1024)).toFixed(2),
        arrayBuffersMb: +(mem.arrayBuffers / (1024 * 1024)).toFixed(2),
        rssBytes: mem.rss,
        heapTotalBytes: mem.heapTotal,
        heapUsedBytes: mem.heapUsed,
        externalBytes: mem.external,
        arrayBuffersBytes: mem.arrayBuffers,
      },
      subagents: {
        total: subagentNodes.length,
        running: subagentNodes.filter((n) => n.state === "running").length,
        idle: subagentNodes.filter((n) => n.state === "idle").length,
        errored: subagentNodes.filter((n) => n.state === "errored").length,
        waiting: subagentNodes.filter((n) => n.state.startsWith("waiting_for_")).length,
      },
      daemons: {
        totalTasks: tasks.length,
        runningTasks: tasks.filter((t) => t.status === "running").length,
        activeSchedules: schedules.filter((s) => s.status === "active").length,
        tasks: tasks.map((t) => ({
          taskId: t.taskId,
          pid: t.pid,
          command: t.command,
          isDaemon: t.isDaemon,
          status: t.status,
          startedAt: t.startedAt,
          truncated: t.truncated ?? false,
        })),
      },
      connections: {
        activeSockets: sockets.size,
        outstandingTokens: tokenStore.size,
      },
      terminals: {
        activeSessions: terminals.filter((t) => t.status === "running").length,
        totalSessions: terminals.length,
      },
      workspace: validatedWorkspace.descriptor,
    };
  });

  const handleWs = (socket: WebSocket, req: any) => {
    if (isClosing) {
      socket.close(1001, "Server shutting down");
      return;
    }
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, options.allowedOrigins, options.allowNonBrowserClients)) {
      logger.warn("host.origin_unauthorized", "Rejected WebSocket connection due to origin mismatch", {
        origin: typeof origin === "string" ? origin.slice(0, 128) : "missing",
      });
      socket.close(CLOSE_UNAUTHORIZED, "unauthorized origin: origin mismatch");
      return;
    }
    const queryToken = new URL(req.url ?? "/agent", "http://127.0.0.1")
      .searchParams.get("token");
    if (!tokenStore.consume(queryToken)) {
      socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    if (options.attach) {
      options.attach(socket, { hostId });
    } else {
      attachAgentSession(socket, { hostId }, {
        ...options.session,
        workspaceRoot,
        workspaceDescriptor: validatedWorkspace.descriptor,
        daemonManager,
        ptyManager,
        subagentSupervisor,
      });
    }
  };

  app.get("/agent", { websocket: true }, handleWs);
  app.get("/ws", { websocket: true }, handleWs);

  await app.listen({ host: bindHost, port: portToBind });
  const address = app.server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : portToBind;

  return {
    app,
    host: bindHost,
    port,
    token,
    tokenStore,
    hostId,
    daemonManager,
    ptyManager,
    subagentSupervisor,
    workspace: validatedWorkspace.descriptor,
    get isClosing() {
      return isClosing;
    },
    async close(graceMs = 1000) {
      if (isClosing) return;
      isClosing = true;

      const drainPromises: Promise<void>[] = [];
      for (const socket of sockets) {
        try {
          if (socket.readyState === 1) {
            socket.send(
              JSON.stringify({
                type: "host.closing",
                reason: "Server shutting down",
                at: new Date().toISOString(),
              })
            );
            socket.close(1001, "Server shutting down");
          }
          drainPromises.push(
            new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                try {
                  socket.terminate();
                } catch {
                  /* ignore */
                }
                resolve();
              }, graceMs);
              socket.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
            })
          );
        } catch {
          try {
            socket.terminate();
          } catch {
            /* ignore */
          }
        }
      }
      await Promise.allSettled(drainPromises);
      sockets.clear();

      try {
        await subagentSupervisor.dispose();
      } catch (err) {
        logger.error("host.close.subagents_error", "Error disposing subagents", undefined, err);
      }

      try {
        await daemonManager.dispose();
      } catch (err) {
        logger.error("host.close.daemons_error", "Error disposing daemons", undefined, err);
      }

      try {
        ptyManager.dispose();
      } catch (err) {
        logger.error("host.close.pty_error", "Error disposing pty manager", undefined, err);
      }

      await app.close();
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Protocol attachment                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Minimal validated message loop. The full run coordinator arrives in Task
 * 18; this scaffold accepts `plan.submit` (queues a run and reports
 * `run.state`), answers `ping`, acknowledges pause/cancel via `run.event`,
 * and enforces the protocol contract on every frame.
 */
export function attachAgentProtocol(
  socket: WebSocket,
  context: { hostId: string },
): void {
  const runStates = new Map<string, RunState>();

  const send = (message: HostMessage | TerminalServerMessage): void => {
    const payload = JSON.stringify(message);
    // The ws socket may still be CONNECTING when the route handler runs;
    // queue the frame until the upgrade completes instead of dropping it.
    if (socket.readyState === 1) socket.send(payload);
    else socket.once("open", () => socket.send(payload));
  };
  const now = () => new Date().toISOString();

  send({ type: "host.ready", version: HOST_VERSION, hostId: context.hostId, at: now() });

  socket.on("message", (data: unknown) => {
    const decoded = decodeClientMessage(data);
    if (!decoded.ok) {
      if (typeof data === "string" || data instanceof Buffer || Array.isArray(data)) {
        try {
          const parsed = JSON.parse(String(data));
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "type" in parsed &&
            typeof (parsed as { type: unknown }).type === "string" &&
            ((parsed as { type: string }).type).startsWith("terminal.")
          ) {
            const terminalResult = safeParseTerminalClientMessage(parsed);
            if (terminalResult.success) {
              const tMsg = terminalResult.data;
              if (tMsg.type === "terminal.create") {
                send({
                  type: "terminal.created",
                  id: tMsg.id ?? randomUUID(),
                  sessionId: tMsg.sessionId,
                  title: tMsg.title ?? "terminal-1",
                  pid: process.pid,
                  cols: tMsg.cols ?? 80,
                  rows: tMsg.rows ?? 24,
                });
              }
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
      socket.close(CLOSE_INVALID_MESSAGE, "invalid message");
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case "ping":
        send({ type: "pong", at: now() });
        break;
      case "plan.submit": {
        const runId = randomUUID();
        runStates.set(runId, "queued");
        send({ type: "run.state", runId, state: "queued", at: now() });
        break;
      }
      case "run.pause":
      case "run.resume":
      case "run.cancel": {
        const known = runStates.has(message.runId);
        if (message.type === "run.cancel" && known) {
          runStates.set(message.runId, "cancelled");
          send({
            type: "run.state",
            runId: message.runId,
            state: "cancelled",
            at: now(),
          });
        } else {
          send({
            type: "run.event",
            runId: message.runId,
            event: known ? `${message.type}.requested` : "unknown_run",
            at: now(),
          });
        }
        break;
      }
      case "approval.grant":
      case "approval.deny":
      case "tool.response":
        // Consumed by the run coordinator (Task 18); validated here only.
        break;
    }
  });
}

/* ------------------------------------------------------------------------ */
/* Standalone entry point                                                   */
/* ------------------------------------------------------------------------ */

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const launcherOrigins = parseLauncherAllowedOrigins(process.env.NANOFORGE_ALLOWED_ORIGINS);
  const host = await createHost({
    host: process.env.BIND_ADDRESS ?? process.env.HOST ?? "127.0.0.1",
    port: process.env.PORT ? Number(process.env.PORT) : 0,
    token: process.env.TOKEN,
    logger: true,
    ...(launcherOrigins.length > 0 ? { allowedOrigins: launcherOrigins } : {}),
    session: {
      workspaceRoot: process.env.NANOFORGE_WORKSPACE,
      allowWorkspaceWrites: process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES === "1",
    },
  });
  console.log(
    `agent-host v${HOST_VERSION} listening: ws://${host.host}:${host.port}/agent?token=${host.token}`,
  );

  let isShuttingDown = false;
  const handleSignal = async (sig: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[agent-host] Received ${sig}, initiating graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      console.error("[agent-host] Shutdown timed out (5s), forcing process.exit(1)");
      process.exit(1);
    }, 5000);
    forceTimer.unref();

    try {
      await host.close(1000);
      clearTimeout(forceTimer);
      console.log("[agent-host] Shutdown completed cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("[agent-host] Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void handleSignal("SIGINT"));
  process.once("SIGTERM", () => void handleSignal("SIGTERM"));

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("process.unhandled_rejection", "Unhandled promise rejection captured", { promise }, reason);
  });
  process.on("uncaughtException", (error) => {
    logger.error("process.uncaught_exception", "Uncaught exception captured", undefined, error);
  });
}
