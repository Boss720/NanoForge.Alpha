/**
 * Actor-Model Mailbox Bus & Priority Message Router.
 *
 * Implements:
 * - Actor FIFO queues with priority ordering (`high` > `normal` > `low`)
 * - Authorization enforcement (SEC-SUB-03): sender may only message parent, child, or sibling
 * - Audit history ledger of all inter-agent message exchanges
 */
import {
  SUBAGENT_ERROR_CODES,
  type SubagentMessage,
} from "@protocol/subagents";
import type { SubagentRegistry } from "./registry.js";

const PRIORITY_WEIGHT: Record<string, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

export class SubagentMailbox {
  private readonly queues = new Map<string, SubagentMessage[]>();
  private readonly auditLedger: SubagentMessage[] = [];

  /**
   * Validates inter-agent message authorization under SEC-SUB-03:
   * Senders may only message:
   * 1. Their direct parent (recipientId === sender.parentId)
   * 2. Any of their direct children (recipient.parentId === sender.id)
   * 3. Any sibling sharing the exact same parent (recipient.parentId === sender.parentId)
   */
  validateAuthorization(
    senderId: string,
    recipientId: string,
    registry: SubagentRegistry
  ): void {
    const recipient = registry.get(recipientId);
    if (!recipient) {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_RECIPIENT_NOT_FOUND}: Recipient subagent "${recipientId}" not found or terminated`
      );
    }

    const sender = registry.get(senderId);
    // If sender is null (e.g. root orchestrator caller without a node), allow if recipient is root-level
    if (!sender) {
      if (recipient.parentId === null) {
        return; // Root caller messaging root subagent
      }
      return; // Permitted for root host/orchestrator
    }

    const isParent = recipient.id === sender.parentId;
    const isChild = recipient.parentId === sender.id;
    const isSibling =
      sender.parentId !== null &&
      recipient.parentId !== null &&
      sender.parentId === recipient.parentId;

    if (!isParent && !isChild && !isSibling) {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT}: Subagent "${senderId}" (${sender.name}) is not authorized to message "${recipientId}" (${recipient.name}). Messages may only be sent to parent, child, or sibling.`
      );
    }
  }

  /**
   * Enqueues a message into the recipient's actor mailbox, sorted by priority.
   */
  enqueue(message: SubagentMessage, registry?: SubagentRegistry): void {
    if (registry) {
      this.validateAuthorization(message.senderId, message.recipientId, registry);
    }

    const recipientId = message.recipientId;
    if (!this.queues.has(recipientId)) {
      this.queues.set(recipientId, []);
    }

    const queue = this.queues.get(recipientId)!;
    const weight = PRIORITY_WEIGHT[message.priority] ?? 2;

    // Insert according to priority (stable insertion)
    let insertIndex = queue.length;
    for (let i = 0; i < queue.length; i++) {
      const currentWeight = PRIORITY_WEIGHT[queue[i].priority] ?? 2;
      if (weight > currentWeight) {
        insertIndex = i;
        break;
      }
    }

    queue.splice(insertIndex, 0, message);
    this.auditLedger.push(message);
  }

  /**
   * Dequeues the next message from a subagent's mailbox.
   */
  dequeue(subagentId: string): SubagentMessage | undefined {
    const queue = this.queues.get(subagentId);
    if (!queue || queue.length === 0) return undefined;
    return queue.shift();
  }

  /**
   * Peeks at the next message without removing it.
   */
  peek(subagentId: string): SubagentMessage | undefined {
    const queue = this.queues.get(subagentId);
    if (!queue || queue.length === 0) return undefined;
    return queue[0];
  }

  /**
   * Returns all pending messages currently in the subagent's queue.
   */
  getPending(subagentId: string): SubagentMessage[] {
    const queue = this.queues.get(subagentId);
    return queue ? [...queue] : [];
  }

  /**
   * Returns pending message count.
   */
  getPendingCount(subagentId: string): number {
    return this.queues.get(subagentId)?.length ?? 0;
  }

  /**
   * Retrieves message history from the audit ledger.
   */
  getHistory(subagentId?: string): SubagentMessage[] {
    if (!subagentId) {
      return [...this.auditLedger];
    }
    return this.auditLedger.filter(
      (m) => m.senderId === subagentId || m.recipientId === subagentId
    );
  }

  /**
   * Clears a subagent's mailbox or all mailboxes if no ID provided.
   */
  clear(subagentId?: string): void {
    if (subagentId) {
      this.queues.delete(subagentId);
    } else {
      this.queues.clear();
      this.auditLedger.length = 0;
    }
  }
}
