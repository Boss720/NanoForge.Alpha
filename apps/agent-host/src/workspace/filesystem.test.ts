import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { handleReadDir, handleReadFile, handleWriteFile, handleStat, handleSearch, handleGitStatus, setWorkspaceFilesystemOperationHookForTest } from './filesystem.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';

vi.mock('execa');

describe('workspace filesystem', () => {
  let tmpDir: string;
  let extraTmpDirs: string[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-test-'));
    extraTmpDirs = [];
    // Setup some test files
    await fs.mkdir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'console.log("hello");', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Hello', 'utf8');
    await fs.mkdir(path.join(tmpDir, 'node_modules'));
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'test.js'), 'bad', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    for (const target of extraTmpDirs) await fs.rm(target, { recursive: true, force: true });
    setWorkspaceFilesystemOperationHookForTest();
    vi.restoreAllMocks();
  });

  describe('handleReadDir', () => {
    it('returns sorted entries with directories first and ignores node_modules', async () => {
      const entries = await handleReadDir(tmpDir, '.');
      
      expect(entries).toHaveLength(2); // src (dir), README.md (file). node_modules ignored.
      expect(entries[0].name).toBe('src');
      expect(entries[0].isDir).toBe(true);
      expect(entries[1].name).toBe('README.md');
      expect(entries[1].isDir).toBe(false);
      expect(entries[1].size).toBeGreaterThan(0);
      expect(entries[1].modified).toBeDefined();
    });

    it('blocks path traversal', async () => {
      await expect(handleReadDir(tmpDir, '../')).rejects.toThrow();
    });

    it('does not list sensitive files while keeping ordinary source entries visible', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.local'), 'API_TOKEN=do-not-leak', 'utf8');
      await fs.writeFile(path.join(tmpDir, 'credentials.json'), '{}', 'utf8');

      const entries = await handleReadDir(tmpDir, '.');
      expect(entries.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(['.env.local', 'credentials.json']));
      expect(entries.map((entry) => entry.name)).toContain('README.md');
    });
  });

  describe('handleReadFile', () => {
    it('returns content with correct language detection', async () => {
      const file = await handleReadFile(tmpDir, 'src/index.ts');
      expect(file.content).toBe('console.log("hello");');
      expect(file.language).toBe('typescript');
      expect(file.size).toBeGreaterThan(0);
    });

    it('blocks files outside workspace', async () => {
      await expect(handleReadFile(tmpDir, '../etc/passwd')).rejects.toThrow();
    });

    it('blocks symlinks or junctions that escape the workspace', async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-outside-'));
      extraTmpDirs.push(outside);
      await fs.writeFile(path.join(outside, 'secret.txt'), 'outside');
      const link = path.join(tmpDir, 'outside-link');
      await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(handleReadFile(tmpDir, 'outside-link/secret.txt'))
        .rejects.toMatchObject({ code: 'path_outside_workspace' });
    });

    it('fails closed when a checked parent is swapped for an escaping symlink before read', async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-outside-'));
      extraTmpDirs.push(outside);
      await fs.writeFile(path.join(outside, 'note.txt'), 'outside');

      const swapDir = path.join(tmpDir, 'swap');
      const target = path.join(swapDir, 'note.txt');
      await fs.mkdir(swapDir);
      await fs.writeFile(target, 'inside');

      let swapped = false;
      setWorkspaceFilesystemOperationHookForTest(async (operation) => {
        if (operation === 'readFile' && !swapped) {
          swapped = true;
          await fs.rename(swapDir, path.join(tmpDir, 'swap-before-link'));
          await fs.symlink(outside, swapDir, process.platform === 'win32' ? 'junction' : 'dir');
        }
      });

      await expect(handleReadFile(tmpDir, 'swap/note.txt'))
        .rejects.toMatchObject({ code: 'path_outside_workspace' });
      expect(swapped).toBe(true);
    });

    it('rejects files over 1MB', async () => {
      const _largeFile = path.join(tmpDir, 'large.txt');
      // Mock stat for this file to avoid actually creating a 1MB+ file
      const originalStat = fs.stat;
      vi.spyOn(fs, 'stat').mockImplementation(async (p: import('node:fs').PathLike) => {
        if (p.toString().endsWith('large.txt')) {
          return { size: 2 * 1024 * 1024 } as unknown as import('node:fs').Stats;
        }
        return originalStat(p);
      });

      await expect(handleReadFile(tmpDir, 'large.txt')).rejects.toThrow('File too large (exceeds 1MB limit)');
    });

    it.each(['.env', '.env.production', '.ssh/id_ed25519', '.aws/credentials', 'service-account.json'])('denies sensitive read path %s', async (relativePath) => {
        const target = path.join(tmpDir, ...relativePath.split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, 'secret', 'utf8');
        await expect(handleReadFile(tmpDir, relativePath)).rejects.toMatchObject({ code: 'path_outside_workspace' });
      });
  });

  describe('handleWriteFile', () => {
    it('denies capability-enabled writes without authorization', async () => {
      await expect(handleWriteFile(tmpDir, 'README.md', '# Unauthorized', {
        authorizationRequired: true,
      })).rejects.toMatchObject({ code: 'write_not_approved' });
      expect(await fs.readFile(path.join(tmpDir, 'README.md'), 'utf8')).toBe('# Hello');
    });

    it('rejects a denied authorizer without mutating the target', async () => {
      const authorize = vi.fn(() => false);
      await expect(handleWriteFile(tmpDir, 'README.md', '# Denied', {
        authorizationRequired: true,
        authorize,
      })).rejects.toMatchObject({ code: 'write_not_approved' });
      expect(authorize).toHaveBeenCalledWith({
        operation: 'workspace.write',
        workspaceRelativePath: 'README.md',
        contentSha256: createHash('sha256').update('# Denied').digest('hex'),
        contentSize: Buffer.byteLength('# Denied'),
        expectedSha256: undefined,
        expectedModified: undefined,
      });
      expect(await fs.readFile(path.join(tmpDir, 'README.md'), 'utf8')).toBe('# Hello');
    });

    it('passes non-secret write metadata to a granted authorizer and preserves conflict safety', async () => {
      const previous = createHash('sha256').update('# Hello').digest('hex');
      const authorize = vi.fn(({ workspaceRelativePath, contentSha256, contentSize, expectedSha256, expectedModified }) => {
        expect(workspaceRelativePath).toBe('README.md');
        expect(contentSha256).toBe(createHash('sha256').update('# Authorized').digest('hex'));
        expect(contentSize).toBe(Buffer.byteLength('# Authorized'));
        expect(expectedSha256).toBe(previous);
        expect(expectedModified).toBeUndefined();
        return true;
      });
      const result = await handleWriteFile(tmpDir, 'README.md', '# Authorized', {
        authorizationRequired: true,
        authorize,
        expectedSha256: previous,
      });
      expect(result.success).toBe(true);
      expect(await fs.readFile(path.join(tmpDir, 'README.md'), 'utf8')).toBe('# Authorized');
    });

    it('creates parent directories and writes file', async () => {
      const result = await handleWriteFile(tmpDir, 'nested/dir/new.js', 'const x = 1;');
      expect(result.success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'nested/dir/new.js'), 'utf8');
      expect(content).toBe('const x = 1;');
    });

    it('blocks writes outside workspace', async () => {
      await expect(handleWriteFile(tmpDir, '../../system.txt', 'hack')).rejects.toThrow();
    });

    it('rejects stale writes using the expected sha256', async () => {
      await expect(handleWriteFile(tmpDir, 'README.md', '# Changed', {
        expectedSha256: '0'.repeat(64),
      })).rejects.toMatchObject({ code: 'write_conflict' });
      expect(await fs.readFile(path.join(tmpDir, 'README.md'), 'utf8')).toBe('# Hello');
    });

    it('returns the new hash and writes by atomic replacement', async () => {
      const previous = createHash('sha256').update('# Hello').digest('hex');
      const result = await handleWriteFile(tmpDir, 'README.md', '# Updated', {
        expectedSha256: previous,
      });
      expect(result).toEqual({
        success: true,
        sha256: createHash('sha256').update('# Updated').digest('hex'),
        size: Buffer.byteLength('# Updated'),
        modified: expect.any(String),
      });
      expect(await fs.readFile(path.join(tmpDir, 'README.md'), 'utf8')).toBe('# Updated');
    });

    it('rejects writes over the bounded write limit', async () => {
      await expect(handleWriteFile(tmpDir, 'large.txt', 'x'.repeat(1024 * 1024 + 1)))
        .rejects.toMatchObject({ code: 'file_too_large' });
    });

    it('denies writes to sensitive paths, including files that do not exist yet', async () => {
      await expect(handleWriteFile(tmpDir, '.env.local', 'TOKEN=secret'))
        .rejects.toMatchObject({ code: 'path_outside_workspace' });
      await expect(fs.access(path.join(tmpDir, '.env.local'))).rejects.toThrow();
    });
  });

  describe('handleStat', () => {
    it('returns correct metadata', async () => {
      const stat = await handleStat(tmpDir, 'src/index.ts');
      expect(stat.isFile).toBe(true);
      expect(stat.isDir).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
      expect(stat.modified).toBeDefined();
    });

    it('denies stat of sensitive paths without revealing whether they exist', async () => {
      await fs.writeFile(path.join(tmpDir, '.npmrc'), '//registry.example/:_authToken=secret', 'utf8');
      await expect(handleStat(tmpDir, '.npmrc')).rejects.toMatchObject({ code: 'path_outside_workspace' });
    });
  });

  describe('handleSearch', () => {
    it('returns matches using ripgrep', async () => {
      const mockExeca = vi.mocked(execa).mockResolvedValue({
        stdout: `{"type":"match","data":{"path":{"text":"src/index.ts"},"line_number":1,"submatches":[{"match":{"text":"hello"},"start":13,"end":18}],"lines":{"text":"console.log(\\"hello\\");\\n"}}}`,
      } as never);

      const matches = await handleSearch(tmpDir, 'hello');
      
      expect(mockExeca).toHaveBeenCalled();
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        file: 'src/index.ts',
        line: 1,
        column: 13,
        text: 'console.log("hello");',
        matchText: 'hello',
      });
    });

    it('filters sensitive search results even when ripgrep returns them', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: [
          JSON.stringify({ type: 'match', data: { path: { text: '.env' }, line_number: 1, submatches: [{ match: { text: 'TOKEN' }, start: 0 }], lines: { text: 'TOKEN=secret\n' } } }),
          JSON.stringify({ type: 'match', data: { path: { text: 'src/index.ts' }, line_number: 1, submatches: [{ match: { text: 'hello' }, start: 13 }], lines: { text: 'hello\n' } } }),
        ].join('\n'),
      } as never);

      const matches = await handleSearch(tmpDir, 'hello');
      expect(matches.map((match) => match.file)).toEqual(['src/index.ts']);
      const args = vi.mocked(execa).mock.calls.at(-1)?.[1] as string[];
      expect(args).toContain('--glob');
      expect(args).toContain('!**/.env');
    });
  });

  describe('handleGitStatus', () => {
    it('parses porcelain output correctly', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: ` M src/index.ts\n?? new-file.txt\nD  deleted.js`,
      } as never);

      const status = await handleGitStatus(tmpDir);
      expect(status).toHaveLength(3);
      expect(status[0]).toEqual({ path: 'src/index.ts', status: 'M' });
      expect(status[1]).toEqual({ path: 'new-file.txt', status: '?' });
      expect(status[2]).toEqual({ path: 'deleted.js', status: 'D' });
    });

    it('does not expose sensitive paths in Git status', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: ` M .env\n M src/index.ts\n?? credentials.json`,
      } as never);

      const status = await handleGitStatus(tmpDir);
      expect(status).toEqual([{ path: 'src/index.ts', status: 'M' }]);
    });
  });
});
