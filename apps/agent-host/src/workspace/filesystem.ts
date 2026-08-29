import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execa } from 'execa';
import { isWithinWorkspace, resolveWithinWorkspace } from '../policy/policy.js';
import type { DirEntry, FileStat, SearchMatch, GitFileStatus } from '../protocol.js';
import { isSensitiveWorkspacePath, SENSITIVE_WORKSPACE_GLOB_PATTERNS } from './sensitivePath.js';

const EXT_LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact',
  '.json': 'json', '.md': 'markdown', '.css': 'css', '.html': 'html',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.sh': 'shellscript', '.bash': 'shellscript', '.ps1': 'powershell',
  '.sql': 'sql', '.graphql': 'graphql', '.proto': 'protobuf',
  '.xml': 'xml', '.svg': 'xml', '.gitignore': 'ignore',
};

export const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;

export class WorkspaceFileError extends Error {
  constructor(
    readonly code:
      | 'path_outside_workspace'
      | 'file_too_large'
      | 'binary_file'
      | 'write_conflict'
      | 'write_not_approved'
      | 'invalid_search'
      | 'io_error',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceFileError';
  }
}

const sha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex');

type WorkspaceFilesystemOperation =
  | 'readDir'
  | 'realpath'
  | 'stat'
  | 'readFile'
  | 'mkdir'
  | 'writeFile'
  | 'rename'
  | 'unlink'
  | 'search'
  | 'gitStatus';

let beforeWorkspaceFilesystemOperationForTest:
  | ((operation: WorkspaceFilesystemOperation, fullPath: string) => void | Promise<void>)
  | undefined;

/** Deterministic operation-boundary seam for confinement regression tests. */
export function setWorkspaceFilesystemOperationHookForTest(
  hook?: (operation: WorkspaceFilesystemOperation, fullPath: string) => void | Promise<void>,
): void {
  beforeWorkspaceFilesystemOperationForTest = hook;
}

const beforeWorkspaceFilesystemOperation = async (
  operation: WorkspaceFilesystemOperation,
  fullPath: string,
): Promise<void> => {
  await beforeWorkspaceFilesystemOperationForTest?.(operation, fullPath);
};

const confinedPath = (workspaceRoot: string, relativePath: string): string => {
  const fullPath = resolveWithinWorkspace(workspaceRoot, relativePath);
  if (!fullPath) {
    throw new WorkspaceFileError('path_outside_workspace', 'Path is outside workspace');
  }
  if (isSensitiveWorkspacePath(path.relative(path.resolve(workspaceRoot), fullPath))) {
    throw new WorkspaceFileError('path_outside_workspace', 'Path is not available');
  }
  return fullPath;
};

const revalidateConfinedPath = async (
  workspaceRoot: string,
  fullPath: string,
  operation: WorkspaceFilesystemOperation,
): Promise<void> => {
  await beforeWorkspaceFilesystemOperation(operation, fullPath);
  if (!isWithinWorkspace(fullPath, workspaceRoot)) {
    throw new WorkspaceFileError('path_outside_workspace', 'Path is outside workspace');
  }
};

export async function handleReadDir(workspaceRoot: string, relativePath: string): Promise<DirEntry[]> {
  const fullPath = confinedPath(workspaceRoot, relativePath);
  await revalidateConfinedPath(workspaceRoot, fullPath, 'readDir');
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  
  const result: DirEntry[] = [];
  for (const entry of entries) {
    // Basic ignore filtering
    if (['node_modules', '.git', 'dist'].includes(entry.name)) {
      continue;
    }

    const entryPath = path.join(fullPath, entry.name);
    let inspectedPath = entryPath;
    try {
      await revalidateConfinedPath(workspaceRoot, entryPath, 'realpath');
      inspectedPath = await fs.realpath(entryPath);
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      // A concurrently removed entry is still filtered by its lexical path.
    }
    if (isSensitiveWorkspacePath(path.relative(path.resolve(workspaceRoot), inspectedPath))) {
      continue;
    }
    let size: number | undefined;
    let modified: string | undefined;

    try {
      await revalidateConfinedPath(workspaceRoot, entryPath, 'stat');
      const stat = await fs.stat(entryPath);
      if (entry.isFile()) {
        size = stat.size;
      }
      modified = stat.mtime.toISOString();
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      // Ignore stat errors for unreadable files
    }

    result.push({
      name: entry.name,
      isDir: entry.isDirectory(),
      size,
      modified,
    });
  }

  return result.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function handleReadFile(workspaceRoot: string, relativePath: string): Promise<{ content: string; language: string; size: number; modified: string; sha256: string }> {
  const fullPath = confinedPath(workspaceRoot, relativePath);
  await revalidateConfinedPath(workspaceRoot, fullPath, 'stat');
  const stat = await fs.stat(fullPath);
  
  if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
    throw new WorkspaceFileError('file_too_large', 'File too large (exceeds 1MB limit)');
  }
  if (typeof stat.isFile === 'function' && !stat.isFile()) {
    throw new WorkspaceFileError('io_error', 'Path is not a file');
  }

  await revalidateConfinedPath(workspaceRoot, fullPath, 'readFile');
  const content = await fs.readFile(fullPath, 'utf8');
  const ext = path.extname(fullPath).toLowerCase();
  const language = EXT_LANG_MAP[ext] || 'plaintext';

  // Basic binary check
  if (content.includes('\u0000')) {
    throw new WorkspaceFileError('binary_file', 'Binary files cannot be read as text');
  }

  return {
    content,
    language,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    sha256: sha256(content),
  };
}

export interface ReviewedWriteOptions {
  expectedSha256?: string;
  expectedModified?: string;
  maxBytes?: number;
  /** Require a host-owned capability decision before writing. */
  authorizationRequired?: boolean;
  /** Receives only non-secret, workspace-relative write metadata. */
  authorize?: ReviewedWriteAuthorizer;
}

export interface ReviewedWriteAuthorizationContext {
  operation: 'workspace.write';
  workspaceRelativePath: string;
  contentSha256: string;
  contentSize: number;
  expectedSha256?: string;
  expectedModified?: string;
}

export type ReviewedWriteAuthorizer = (
  context: ReviewedWriteAuthorizationContext,
) => boolean | Promise<boolean>;

export async function handleWriteFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
  options: ReviewedWriteOptions = {},
): Promise<{ success: true; sha256: string; size: number; modified: string }> {
  const fullPath = confinedPath(workspaceRoot, relativePath);
  const byteSize = Buffer.byteLength(content, 'utf8');
  if (byteSize > (options.maxBytes ?? MAX_WORKSPACE_FILE_BYTES)) {
    throw new WorkspaceFileError('file_too_large', 'File too large (exceeds 1MB write limit)');
  }

  if (options.authorizationRequired && !options.authorize) {
    throw new WorkspaceFileError('write_not_approved', 'Write authorization is required');
  }
  if (options.authorize) {
    const workspaceRelativePath = path
      .relative(path.resolve(workspaceRoot), fullPath)
      .split(path.sep)
      .join('/');
    let authorized = false;
    try {
      authorized = await options.authorize({
        operation: 'workspace.write',
        workspaceRelativePath,
        contentSha256: sha256(content),
        contentSize: byteSize,
        expectedSha256: options.expectedSha256,
        expectedModified: options.expectedModified,
      });
    } catch {
      authorized = false;
    }
    if (!authorized) {
      throw new WorkspaceFileError('write_not_approved', 'Write authorization denied');
    }
  }

  let existing: { content: Buffer; modified: string; mode: number } | undefined;
  try {
    await revalidateConfinedPath(workspaceRoot, fullPath, 'stat');
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) throw new WorkspaceFileError('io_error', 'Write target is not a file');
    await revalidateConfinedPath(workspaceRoot, fullPath, 'readFile');
    existing = {
      content: await fs.readFile(fullPath),
      modified: stat.mtime.toISOString(),
      mode: stat.mode,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (options.expectedSha256 !== undefined) {
    const currentHash = existing ? sha256(existing.content) : undefined;
    if (currentHash?.toLowerCase() !== options.expectedSha256.toLowerCase()) {
      throw new WorkspaceFileError('write_conflict', 'File content changed since review');
    }
  }
  if (options.expectedModified !== undefined) {
    if (!existing || existing.modified !== options.expectedModified) {
      throw new WorkspaceFileError('write_conflict', 'File modification time changed since review');
    }
  }

  const parentPath = path.dirname(fullPath);
  await revalidateConfinedPath(workspaceRoot, parentPath, 'mkdir');
  await fs.mkdir(parentPath, { recursive: true });
  const tempPath = path.join(parentPath, `.${path.basename(fullPath)}.${randomUUID()}.tmp`);
  try {
    await revalidateConfinedPath(workspaceRoot, tempPath, 'writeFile');
    await fs.writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: existing?.mode });
    await revalidateConfinedPath(workspaceRoot, tempPath, 'rename');
    await revalidateConfinedPath(workspaceRoot, fullPath, 'rename');
    await fs.rename(tempPath, fullPath);
  } catch (error) {
    try {
      await revalidateConfinedPath(workspaceRoot, tempPath, 'unlink');
      await fs.unlink(tempPath);
    } catch {
      // A concurrently swapped path is never cleaned up outside the workspace.
    }
    if (error instanceof WorkspaceFileError) throw error;
    throw new WorkspaceFileError('io_error', error instanceof Error ? error.message : String(error));
  }
  await revalidateConfinedPath(workspaceRoot, fullPath, 'stat');
  const stat = await fs.stat(fullPath);
  return {
    success: true,
    sha256: sha256(content),
    size: byteSize,
    modified: stat.mtime.toISOString(),
  };
}

export async function handleStat(workspaceRoot: string, relativePath: string): Promise<FileStat> {
  const fullPath = confinedPath(workspaceRoot, relativePath);
  await revalidateConfinedPath(workspaceRoot, fullPath, 'stat');
  const stat = await fs.stat(fullPath);
  return {
    size: stat.size,
    modified: stat.mtime.toISOString(),
    isDir: stat.isDirectory(),
    isFile: stat.isFile(),
  };
}

export interface SearchOptions {
  caseSensitive?: boolean;
  includes?: string[];
  maxResults?: number;
}

export async function handleSearch(workspaceRoot: string, query: string, options?: SearchOptions): Promise<SearchMatch[]> {
  if (typeof query !== "string") {
    throw new WorkspaceFileError("io_error", "search query must be a string");
  }
  const maxResults = Math.min(Math.max(1, Number(options?.maxResults) || 100), 500);

  const includes = options?.includes ?? [];
  for (const pattern of includes) {
    if (typeof pattern !== "string" || !pattern.trim() || pattern.includes("\0")) {
      throw new WorkspaceFileError("io_error", `Invalid include glob pattern: ${pattern}`);
    }
  }

  const args = ["--json", "--max-count", maxResults.toString()];
  if (options?.caseSensitive) {
    args.push("--case-sensitive");
  } else {
    args.push("--ignore-case");
  }
  args.push("--glob-case-insensitive");

  for (const pattern of includes) {
    args.push("--glob", pattern);
  }

  for (const pattern of SENSITIVE_WORKSPACE_GLOB_PATTERNS) {
    args.push("--glob", `!${pattern}`);
  }

  // Use '--' before positional query so `--help` or options are not parsed as flags
  args.push("--", query, workspaceRoot);

  let result;
  try {
    await revalidateConfinedPath(workspaceRoot, workspaceRoot, 'search');
    result = await execa("rg", args, { reject: false });
  } catch (err) {
    if (err instanceof WorkspaceFileError) throw err;
    throw new WorkspaceFileError("io_error", `Search failed to execute: ${err instanceof Error ? err.message : String(err)}`);
  }

  // In ripgrep: exit code 0 = matches found, 1 = no matches, 2 = error
  if (result.exitCode !== undefined && result.exitCode > 1) {
    throw new WorkspaceFileError("io_error", `Search tool error (exit code ${result.exitCode}): ${result.stderr || "ripgrep error"}`);
  }

  if (!result.stdout) return [];

  const matches: SearchMatch[] = [];
  const lines = result.stdout.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "match") {
        const rawPath = parsed.data.path.text;
        const file = path.isAbsolute(rawPath) ? path.relative(workspaceRoot, rawPath) : rawPath;
        if (isSensitiveWorkspacePath(file)) continue;
        const lineNum = parsed.data.line_number;
        const matchText = parsed.data.submatches[0]?.match?.text || query;
        const column = parsed.data.submatches[0]?.start || 0;
        const text = parsed.data.lines.text.replace(/\r?\n$/, "");

        matches.push({
          file,
          line: lineNum,
          column,
          text,
          matchText,
        });

        if (matches.length >= maxResults) {
          break;
        }
      }
    } catch {
      // Ignore JSON parse errors for non-match lines
    }
  }
  return matches;
}

export async function handleGitStatus(workspaceRoot: string): Promise<GitFileStatus[]> {
  try {
    await revalidateConfinedPath(workspaceRoot, workspaceRoot, 'gitStatus');
    const { stdout } = await execa('git', ['-C', workspaceRoot, 'status', '--porcelain'], { reject: false });
    if (!stdout) return [];

    const statuses: GitFileStatus[] = [];
    const lines = stdout.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const statusCode = line.substring(0, 2);
      const filePath = line.substring(3).trim();
      
      let status: GitFileStatus['status'] = '?';
      if (statusCode.includes('M')) status = 'M';
      else if (statusCode.includes('A')) status = 'A';
      else if (statusCode.includes('D')) status = 'D';
      else if (statusCode.includes('R')) status = 'R';
      else if (statusCode.includes('!')) status = '!';
      else if (statusCode.includes('?')) status = '?';

      if (!isSensitiveWorkspacePath(filePath)) statuses.push({ path: filePath, status });
    }

    return statuses;
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    return [];
  }
}
