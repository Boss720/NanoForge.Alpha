import { logger } from "./logger.js";

export interface ShutdownOptions {
  graceMs?: number;
  reason?: string;
}

export type ShutdownHandler = () => Promise<void> | void;

export class ShutdownCoordinator {
  private isShuttingDown = false;
  private readonly handlers: Array<{ name: string; fn: ShutdownHandler; priority: number }> = [];

  /**
   * Registers a shutdown handler with a given priority (higher numbers run earlier).
   */
  register(name: string, fn: ShutdownHandler, priority = 10): () => void {
    const entry = { name, fn, priority };
    this.handlers.push(entry);
    this.handlers.sort((a, b) => b.priority - a.priority);
    return () => {
      const idx = this.handlers.indexOf(entry);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Executes all registered shutdown handlers in priority order.
   */
  async shutdown(signalOrReason = "SIGTERM", _options: ShutdownOptions = {}): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info("host.shutdown.start", `Initiating graceful shutdown due to ${signalOrReason}`, {
      signalOrReason,
    });

    for (const { name, fn } of this.handlers) {
      try {
        logger.debug("host.shutdown.step", `Executing shutdown handler: ${name}`, { name });
        await fn();
      } catch (err) {
        logger.error("host.shutdown.error", `Error executing shutdown handler ${name}`, { name }, err);
      }
    }

    logger.info("host.shutdown.complete", "Graceful shutdown finished successfully", { signalOrReason });
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();
