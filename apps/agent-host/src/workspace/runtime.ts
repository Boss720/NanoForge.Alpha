import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceDescriptor, WorkspaceErrorCode } from '@protocol/workspace';

export class WorkspaceRootError extends Error {
  constructor(readonly code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceRootError';
  }
}

const comparable = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

const isBroadRoot = (candidate: string): boolean => {
  const normalized = comparable(path.resolve(candidate));
  const filesystemRoot = comparable(path.parse(candidate).root);
  const home = comparable(path.resolve(os.homedir()));
  return normalized === filesystemRoot || normalized === home;
};

export interface ValidatedWorkspace {
  canonicalRoot: string;
  descriptor: WorkspaceDescriptor;
}

export async function validateWorkspaceRoot(
  candidate: string,
  generation = 1,
): Promise<ValidatedWorkspace> {
  if (!candidate || candidate.includes('\0')) {
    throw new WorkspaceRootError('invalid_path', 'Workspace path is invalid');
  }
  const resolved = path.resolve(candidate);
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.realpath(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new WorkspaceRootError('not_found', 'Workspace folder does not exist');
    if (code === 'EACCES' || code === 'EPERM') throw new WorkspaceRootError('permission_denied', 'Workspace folder is not accessible');
    throw new WorkspaceRootError('io_error', error instanceof Error ? error.message : String(error));
  }
  const stat = await fs.stat(canonicalRoot).catch((error: unknown) => {
    throw new WorkspaceRootError('io_error', error instanceof Error ? error.message : String(error));
  });
  if (!stat.isDirectory()) throw new WorkspaceRootError('not_directory', 'Workspace path is not a directory');
  if (isBroadRoot(canonicalRoot)) {
    throw new WorkspaceRootError('root_too_broad', 'Drive, filesystem, and home-directory roots are not allowed');
  }
  await fs.access(canonicalRoot, fs.constants.R_OK);
  const identityInput = process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot;
  return {
    canonicalRoot,
    descriptor: {
      id: `workspace-${createHash('sha256').update(identityInput).digest('hex').slice(0, 24)}`,
      name: path.basename(canonicalRoot),
      displayPath: canonicalRoot,
      generation,
      capabilities: {
        read: true,
        stat: true,
        watch: true,
        search: true,
        git: true,
        terminal: true,
        subagents: true,
        memory: true,
        reviewedWrite: true,
      },
    },
  };
}

export function assertWorkspaceGeneration(provided: number | undefined, current: number): void {
  if (provided !== undefined && provided !== current) {
    throw new WorkspaceRootError(
      'stale_generation',
      `Workspace generation ${provided} is stale; current generation is ${current}`,
    );
  }
}
