/** Private, launcher-owned recent-workspace registry. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REGISTRY_VERSION = 1;

function defaultRegistryPath() {
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd())
    : (process.env.XDG_STATE_HOME || path.join(process.env.HOME || process.cwd(), '.local', 'state'));
  return path.join(base, 'NanoForge', 'workspace-registry.json');
}

function defaultValidatePath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('workspace path is required');
  const resolved = path.resolve(input.trim());
  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) throw new Error('workspace is not a directory');
  if (path.parse(resolved).root === resolved) throw new Error('workspace root is too broad');
  return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
}

function opaqueId() {
  return typeof crypto.randomUUID === 'function'
    ? `ws_${crypto.randomUUID()}`
    : `ws_${crypto.randomBytes(16).toString('hex')}`;
}

function createWorkspaceRegistry(options = {}) {
  const registryPath = path.resolve(options.registryPath || defaultRegistryPath());
  const validatePath = options.validatePath || defaultValidatePath;
  const platform = options.platform || process.platform;
  const now = options.now || (() => new Date().toISOString());
  const normalize = (workspacePath) => platform === 'win32' ? workspacePath.toLowerCase() : workspacePath;
  let state = loadState();

  function emptyState() { return { version: REGISTRY_VERSION, workspaces: [] }; }

  function loadState() {
    if (!fs.existsSync(registryPath)) return emptyState();
    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      if (!parsed || parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.workspaces)) throw new Error('unsupported registry schema');
      return {
        version: REGISTRY_VERSION,
        workspaces: parsed.workspaces.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.path === 'string' && typeof entry.lastOpened === 'string')
          .map((entry) => ({ id: entry.id, path: entry.path, lastOpened: entry.lastOpened, pinned: entry.pinned === true })),
      };
    } catch {
      quarantineCorruptFile();
      return emptyState();
    }
  }

  function quarantineCorruptFile() {
    const quarantinePath = `${registryPath}.corrupt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    try { fs.renameSync(registryPath, quarantinePath); } catch { /* unavailable or raced; retain no sensitive output */ }
  }

  function persist() {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const temporaryPath = `${registryPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, registryPath);
    } finally {
      // Leave a failed temporary file for diagnostics rather than risking deletion of another writer's data.
    }
  }

  function list() {
    return state.workspaces.slice().sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.lastOpened.localeCompare(left.lastOpened);
    }).map((entry) => ({ ...entry }));
  }

  function open(input) {
    const canonicalPath = validatePath(input);
    if (typeof canonicalPath !== 'string' || !canonicalPath) throw new Error('workspace path validation returned no canonical path');
    const match = state.workspaces.find((entry) => normalize(entry.path) === normalize(canonicalPath));
    const timestamp = now();
    if (match) {
      match.path = canonicalPath;
      match.lastOpened = timestamp;
      persist();
      return { ...match };
    }
    const entry = { id: opaqueId(), path: canonicalPath, lastOpened: timestamp, pinned: false };
    state.workspaces.push(entry);
    persist();
    return { ...entry };
  }

  function pin(id, pinned) {
    const entry = state.workspaces.find((candidate) => candidate.id === id);
    if (!entry) return null;
    entry.pinned = pinned === true;
    persist();
    return { ...entry };
  }

  /**
   * Resolve an opaque workspace identity back to a freshly validated private
   * canonical path.  This value is launcher-internal and must never cross the
   * browser control-plane boundary.
   */
  function resolve(id) {
    const entry = state.workspaces.find((candidate) => candidate.id === id);
    if (!entry) return null;
    const canonicalPath = validatePath(entry.path);
    if (canonicalPath !== entry.path) {
      entry.path = canonicalPath;
      persist();
    }
    return { ...entry };
  }

  function remove(id) {
    const initialLength = state.workspaces.length;
    state.workspaces = state.workspaces.filter((entry) => entry.id !== id);
    if (state.workspaces.length === initialLength) return false;
    persist();
    return true;
  }

  return { list, open, resolve, pin, remove, registryPath };
}

module.exports = { createWorkspaceRegistry, defaultRegistryPath, defaultValidatePath, REGISTRY_VERSION };
