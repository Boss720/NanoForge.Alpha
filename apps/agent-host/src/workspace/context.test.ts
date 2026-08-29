import { describe, expect, it } from 'vitest';
import type { ValidatedWorkspace } from './runtime.js';
import { WorkspaceContext } from './context.js';

const validatedWorkspace = (): ValidatedWorkspace => ({
  canonicalRoot: 'C:/Users/Example/Project',
  descriptor: {
    id: 'workspace-opaque-id',
    name: 'Project',
    displayPath: 'C:/Users/Example/Project',
    generation: 7,
    capabilities: {
      read: true,
      stat: true,
      watch: true,
      search: true,
      git: true,
      terminal: true,
      subagents: true,
      memory: true,
      reviewedWrite: false,
    },
  },
});

describe('WorkspaceContext', () => {
  it('takes an immutable host-private snapshot of a validated workspace', () => {
    const validated = validatedWorkspace();
    const context = WorkspaceContext.fromValidated(validated);

    validated.descriptor.capabilities.read = false;

    expect(context.canonicalRoot).toBe('C:/Users/Example/Project');
    expect(context.descriptor.capabilities.read).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.descriptor)).toBe(true);
    expect(Object.isFrozen(context.capabilities)).toBe(true);
  });

  it('matches only the originating workspace identity and generation', () => {
    const context = WorkspaceContext.fromValidated(validatedWorkspace());
    const scope = context.createCancellationScope();

    expect(context.matchesIdentity({ id: 'workspace-opaque-id', generation: 7 })).toBe(true);
    expect(context.matchesIdentity({ id: 'workspace-opaque-id', generation: 8 })).toBe(false);
    expect(context.matchesIdentity({ id: 'other-workspace', generation: 7 })).toBe(false);
    expect(scope.shouldCancel(context)).toBe(false);
    expect(scope.shouldCancel(WorkspaceContext.fromValidated({
      ...validatedWorkspace(),
      descriptor: { ...validatedWorkspace().descriptor, generation: 8 },
    }))).toBe(true);
  });

  it('serializes only browser-safe workspace data', () => {
    const context = WorkspaceContext.fromValidated(validatedWorkspace());
    const browserSafe = context.toBrowserSafe();

    expect(browserSafe).toEqual({
      id: 'workspace-opaque-id',
      name: 'Project',
      generation: 7,
      capabilities: expect.any(Object),
    });
    expect(JSON.stringify(browserSafe)).not.toContain('C:/Users/Example/Project');
    expect(browserSafe).not.toHaveProperty('canonicalRoot');
    expect(browserSafe).not.toHaveProperty('displayPath');
  });
});
