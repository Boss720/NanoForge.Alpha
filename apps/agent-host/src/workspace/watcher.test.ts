import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceWatcher } from './watcher.js';

describe('workspace watcher security boundary', () => {
  it('emits ordinary source changes but never sensitive paths', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-watcher-'));
    const events: string[] = [];
    const watcher = createWorkspaceWatcher({ workspaceRoot, debounceMs: 20 }, (event) => events.push(event.path));

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.writeFile(path.join(workspaceRoot, 'source.ts'), 'export const ok = true;', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, '.env'), 'TOKEN=secret', 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(events).toContain('source.ts');
      expect(events).not.toContain('.env');
    } finally {
      await watcher.close();
      await fs.unlink(path.join(workspaceRoot, 'source.ts')).catch(() => undefined);
      await fs.unlink(path.join(workspaceRoot, '.env')).catch(() => undefined);
      await fs.rmdir(workspaceRoot).catch(() => undefined);
    }
  }, 10000);
});
