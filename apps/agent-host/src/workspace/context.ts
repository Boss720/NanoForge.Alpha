import type { WorkspaceCapabilities, WorkspaceDescriptor } from '@protocol/workspace';
import type { ValidatedWorkspace } from './runtime.js';

/**
 * The stable, generation-aware identity of a workspace-scoped operation.
 * It intentionally contains no filesystem path and can therefore be passed to
 * cancellation and event-routing boundaries.
 */
export interface WorkspaceIdentity {
  readonly id: string;
  readonly generation: number;
}

/** A browser-safe subset of the host-owned workspace descriptor. */
export interface BrowserSafeWorkspaceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly generation: number;
  readonly capabilities: Readonly<WorkspaceCapabilities>;
}

/**
 * Captures an operation's workspace identity so it can be discarded after a
 * workspace handoff. Call `shouldCancel(activeContext)` before publishing an
 * operation result or continuing background work.
 */
export interface WorkspaceCancellationScope {
  readonly identity: WorkspaceIdentity;
  matches(context: WorkspaceContext): boolean;
  shouldCancel(activeContext: WorkspaceContext | undefined): boolean;
}

const snapshotCapabilities = (capabilities: WorkspaceCapabilities): Readonly<WorkspaceCapabilities> =>
  Object.freeze({ ...capabilities });

const snapshotDescriptor = (descriptor: WorkspaceDescriptor): Readonly<WorkspaceDescriptor> =>
  Object.freeze({
    ...descriptor,
    capabilities: snapshotCapabilities(descriptor.capabilities),
  });

/**
 * Host-only workspace state. The canonical root must only cross privilege
 * boundaries through host operations; use `toBrowserSafe()` for UI data.
 */
export class WorkspaceContext {
  readonly canonicalRoot: string;
  readonly descriptor: Readonly<WorkspaceDescriptor>;
  readonly capabilities: Readonly<WorkspaceCapabilities>;
  readonly generation: number;
  readonly identity: WorkspaceIdentity;

  private constructor(validated: ValidatedWorkspace) {
    this.canonicalRoot = validated.canonicalRoot;
    this.descriptor = snapshotDescriptor(validated.descriptor);
    this.capabilities = this.descriptor.capabilities;
    this.generation = this.descriptor.generation;
    this.identity = Object.freeze({ id: this.descriptor.id, generation: this.generation });
    Object.freeze(this);
  }

  static fromValidated(validated: ValidatedWorkspace): WorkspaceContext {
    return new WorkspaceContext(validated);
  }

  matchesIdentity(identity: WorkspaceIdentity | undefined): boolean {
    return identity?.id === this.identity.id && identity.generation === this.identity.generation;
  }

  createCancellationScope(): WorkspaceCancellationScope {
    const identity = this.identity;
    return Object.freeze({
      identity,
      matches: (context: WorkspaceContext): boolean => context.matchesIdentity(identity),
      shouldCancel: (activeContext: WorkspaceContext | undefined): boolean => !activeContext?.matchesIdentity(identity),
    });
  }

  toBrowserSafe(): BrowserSafeWorkspaceDescriptor {
    return Object.freeze({
      id: this.descriptor.id,
      name: this.descriptor.name,
      generation: this.generation,
      capabilities: this.capabilities,
    });
  }
}
