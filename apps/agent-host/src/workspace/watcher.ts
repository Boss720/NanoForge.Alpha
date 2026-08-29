import chokidar from 'chokidar';
import path from 'node:path';
import { isSensitiveWorkspacePath, SENSITIVE_WORKSPACE_GLOB_PATTERNS } from './sensitivePath.js';

export interface WatcherOptions {
  workspaceRoot: string;
  ignored?: string[];  // default: ['**/node_modules/**', '**/.git/**', '**/dist/**']
  debounceMs?: number; // default: 300
}

export type FileChangeEvent = {
  path: string;  // workspace-relative
  changeType: 'created' | 'modified' | 'deleted';
};

export type WatcherCallback = (event: FileChangeEvent) => void;

export function createWorkspaceWatcher(options: WatcherOptions, callback: WatcherCallback): { close: () => Promise<void> } {
  const ignored = [
    ...(options.ignored ?? [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/.nanoforge/runs/**',
    ]),
    ...SENSITIVE_WORKSPACE_GLOB_PATTERNS,
  ];
  const debounceMs = options.debounceMs ?? 300;

  const watcher = chokidar.watch(options.workspaceRoot, {
    ignored,
    ignoreInitial: true,
    persistent: true,
  });

  const timers = new Map<string, NodeJS.Timeout>();

  const handleChange = (absolutePath: string, changeType: FileChangeEvent['changeType']) => {
    const relativePath = path.relative(options.workspaceRoot, absolutePath);
    // Use forward slashes for cross-platform consistency if needed, but relativePath usually uses path.sep
    const normalizedPath = relativePath.split(path.sep).join('/');
    if (!normalizedPath || isSensitiveWorkspacePath(normalizedPath)) return;

    const eventKey = `${changeType}:${normalizedPath}`;

    if (timers.has(eventKey)) {
      clearTimeout(timers.get(eventKey)!);
    }

    const timer = setTimeout(() => {
      timers.delete(eventKey);
      callback({
        path: normalizedPath,
        changeType,
      });
    }, debounceMs);

    timers.set(eventKey, timer);
  };

  watcher
    .on('add', (path) => handleChange(path, 'created'))
    .on('change', (path) => handleChange(path, 'modified'))
    .on('unlink', (path) => handleChange(path, 'deleted'))
    .on('addDir', (path) => handleChange(path, 'created'))
    .on('unlinkDir', (path) => handleChange(path, 'deleted'));

  return {
    close: async () => {
      // Clear any pending debounced events
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      await watcher.close();
    },
  };
}
