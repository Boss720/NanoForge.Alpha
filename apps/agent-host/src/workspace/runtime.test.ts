import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertWorkspaceGeneration, validateWorkspaceRoot } from './runtime.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const target of cleanup.splice(0)) {
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('workspace runtime validation', () => {
  it('canonicalizes Windows-compatible paths with spaces and Unicode', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-root-'));
    cleanup.push(parent);
    const root = path.join(parent, 'Project Space Ω');
    await fs.mkdir(root);
    const validated = await validateWorkspaceRoot(root, 4);
    expect(validated.canonicalRoot).toBe(await fs.realpath(root));
    expect(validated.descriptor).toMatchObject({
      name: 'Project Space Ω',
      generation: 4,
    });
    expect(validated.descriptor.id).toMatch(/^workspace-[a-f0-9]{24}$/);
  });

  it('rejects missing paths, files, and overly broad roots', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-root-'));
    cleanup.push(parent);
    const file = path.join(parent, 'not-a-folder.txt');
    await fs.writeFile(file, 'x');
    await expect(validateWorkspaceRoot(path.join(parent, 'missing'))).rejects.toMatchObject({ code: 'not_found' });
    await expect(validateWorkspaceRoot(file)).rejects.toMatchObject({ code: 'not_directory' });
    await expect(validateWorkspaceRoot(path.parse(parent).root)).rejects.toMatchObject({ code: 'root_too_broad' });
  });

  it('rejects stale generations while allowing legacy omitted generations', () => {
    expect(() => assertWorkspaceGeneration(2, 3)).toThrow(/stale/i);
    expect(() => assertWorkspaceGeneration(undefined, 3)).not.toThrow();
    expect(() => assertWorkspaceGeneration(3, 3)).not.toThrow();
  });
});
