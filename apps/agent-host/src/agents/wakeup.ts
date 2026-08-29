/**
 * Reactive Wakeup Engine (Zero-Polling Event Dispatcher).
 *
 * Automatically resumes suspended agents without CPU spin or polling loops:
 * - Formats structured `<system_notification>` XML/Markdown blocks into transcript
 * - Handles Inbound Messages, Child State Changes, Daemon Task completions, Timer Expiries, and Fallback Wakeups
 */
import { EventEmitter } from "node:events";
import {
  formatWakeupNotification,
  type SubagentInfo,
  type SubagentMessage,
  type WakeupNotificationOptions,
} from "@protocol/subagents";

export type WakeupCallback = (formattedBlock: string, options: WakeupNotificationOptions) => void;

export class ReactiveWakeupEngine extends EventEmitter {
  private readonly subagentListeners = new Map<string, Set<WakeupCallback>>();

  /**
   * Registers a reactive wakeup listener for a subagent.
   */
  registerWakeup(subagentId: string, callback: WakeupCallback): () => void {
    if (!this.subagentListeners.has(subagentId)) {
      this.subagentListeners.set(subagentId, new Set());
    }
    this.subagentListeners.get(subagentId)!.add(callback);

    return () => {
      const set = this.subagentListeners.get(subagentId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.subagentListeners.delete(subagentId);
        }
      }
    };
  }

  /**
   * Dispatches a structured wakeup event to target subagent listeners.
   */
  dispatchWakeup(targetSubagentId: string, options: WakeupNotificationOptions): void {
    const formatted = formatWakeupNotification(options);
    const set = this.subagentListeners.get(targetSubagentId);

    if (set && set.size > 0) {
      for (const callback of set) {
        try {
          callback(formatted, options);
        } catch (err) {
          console.error(`Wakeup callback error for subagent ${targetSubagentId}:`, err);
        }
      }
    }

    this.emit("wakeup", { targetSubagentId, formatted, options });
  }

  /**
   * Triggers wakeup when an inter-agent message arrives in a subagent's mailbox.
   */
  wakeOnMessage(message: SubagentMessage): void {
    this.dispatchWakeup(message.recipientId, {
      trigger: "MESSAGE_RECEIVED",
      sourceId: message.senderId,
      sourceName: message.senderName,
      timestamp: message.timestamp,
      summary: `Inbound message: "${message.subject}" - ${message.body.slice(0, 120)}...`,
      attachedArtifact: message.referencedArtifacts[0],
      details: {
        messageId: message.messageId,
        priority: message.priority,
      },
    });
  }

  /**
   * Triggers wakeup for parent when a child subagent completes successfully.
   */
  wakeOnChildCompleted(childInfo: SubagentInfo, handoffArtifact?: string): void {
    if (!childInfo.parentId) return;

    this.dispatchWakeup(childInfo.parentId, {
      trigger: "CHILD_COMPLETED",
      sourceId: childInfo.id,
      sourceName: childInfo.name,
      timestamp: childInfo.completedAt ?? new Date().toISOString(),
      summary: `Child subagent "${childInfo.name}" (${childInfo.archetype}) completed successfully (turns: ${childInfo.turnCount}, tokens: ${childInfo.tokensUsed}).`,
      attachedArtifact: handoffArtifact,
      details: {
        childId: childInfo.id,
        archetype: childInfo.archetype,
        tokensUsed: childInfo.tokensUsed,
      },
    });
  }

  /**
   * Triggers wakeup for parent when a child subagent encounters an error.
   */
  wakeOnChildErrored(childInfo: SubagentInfo, error: string): void {
    if (!childInfo.parentId) return;

    this.dispatchWakeup(childInfo.parentId, {
      trigger: "CHILD_ERRORED",
      sourceId: childInfo.id,
      sourceName: childInfo.name,
      timestamp: childInfo.completedAt ?? new Date().toISOString(),
      summary: `Child subagent "${childInfo.name}" encountered an error: ${error}`,
      details: {
        childId: childInfo.id,
        error,
        exitCode: childInfo.exitCode,
      },
    });
  }

  /**
   * Triggers wakeup when a supervised daemon task finishes.
   */
  wakeOnTaskCompleted(
    taskId: string,
    exitCode: number | null,
    summary: string,
    targetSubagentId?: string
  ): void {
    if (!targetSubagentId) return;

    this.dispatchWakeup(targetSubagentId, {
      trigger: "TASK_COMPLETED",
      sourceId: taskId,
      timestamp: new Date().toISOString(),
      summary: `Background task ${taskId} finished with exit code ${exitCode ?? 0}: ${summary}`,
      details: {
        taskId,
        exitCode,
      },
    });
  }

  /**
   * Triggers wakeup when a scheduled timer fires.
   */
  wakeOnTimerExpired(scheduleId: string, prompt: string, targetSubagentId?: string): void {
    if (!targetSubagentId) return;

    this.dispatchWakeup(targetSubagentId, {
      trigger: "TIMER_EXPIRED",
      sourceId: scheduleId,
      timestamp: new Date().toISOString(),
      summary: `Timer expired: ${prompt}`,
      details: {
        scheduleId,
      },
    });
  }

  /**
   * Triggers fallback wakeup when a monitored sender terminates.
   */
  wakeOnSenderTerminated(targetSubagentId: string, terminatedSenderId: string): void {
    this.dispatchWakeup(targetSubagentId, {
      trigger: "SENDER_TERMINATED",
      sourceId: terminatedSenderId,
      timestamp: new Date().toISOString(),
      summary: `Monitored sender ${terminatedSenderId} terminated prematurely. Resuming execution fallback.`,
      details: {
        terminatedSenderId,
      },
    });
  }

  /**
   * Cleans up all listeners for a subagent.
   */
  clear(subagentId: string): void {
    this.subagentListeners.delete(subagentId);
  }
}
