/**
 * NanoForge Dual Launcher (scripts/nanoforge-launcher.cjs)
 *
 * Coordinates standalone execution:
 * 1. Starts the Fastify Agent Host daemon (port 4174 by default).
 * 2. Serves the Vite production `dist/` web UI (port 4173 by default) with MIME type handling and SPA routing fallback.
 * 3. Generates a secure session authentication token.
 * 4. Automatically opens the default browser to `http://127.0.0.1:4173/?hostPort=4174&token=...`.
 * 5. Handles graceful process shutdown (SIGINT/SIGTERM) for both servers.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, exec } = require('node:child_process');

function isSeaRuntime() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

function resolveLauncherSidecar(name, options = {}) {
  const isSea = options.isSea ?? isSeaRuntime();
  const executablePath = options.execPath || process.execPath;
  // SEA embeds this launcher, but the native picker and registry deliberately
  // remain bundle sidecars. Resolve them from the executable at runtime rather
  // than from SEA's virtual source directory.
  return path.join(isSea ? path.dirname(executablePath) : __dirname, name);
}

// `require` in a SEA entry script only resolves built-in modules. Recreate a
// file-backed loader from the executable path before loading the packaged
// sidecars. In normal Node development, retain the ordinary module loader.
const sidecarRequire = isSeaRuntime()
  ? require('node:module').createRequire(__filename)
  : require;
const { createWindowsFolderPicker } = sidecarRequire(resolveLauncherSidecar('workspace-picker.cjs'));
const { createWorkspaceRegistry } = sidecarRequire(resolveLauncherSidecar('workspace-registry.cjs'));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

const MINIMAL_CHILD_ENVIRONMENT_KEYS = process.platform === 'win32'
  ? ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP']
  : ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'];

function buildChildEnvironment(overrides = {}) {
  const environment = {};
  const hostKeys = Object.keys(process.env);
  for (const requestedKey of MINIMAL_CHILD_ENVIRONMENT_KEYS) {
    const actualKey = process.platform === 'win32'
      ? hostKeys.find((key) => key.toLowerCase() === requestedKey.toLowerCase())
      : requestedKey;
    const value = actualKey ? process.env[actualKey] : undefined;
    if (value !== undefined) environment[actualKey || requestedKey] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) environment[key] = String(value);
  }
  return environment;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    uiPort: Number(process.env.NANOFORGE_PORT || process.env.NANOFORGE_UI_PORT || 4173),
    hostPort: Number(process.env.NANOFORGE_HOST_PORT || process.env.HOST_PORT || 4174),
    token: process.env.NANOFORGE_TOKEN || process.env.TOKEN || '',
    noOpen: process.env.NANOFORGE_NO_OPEN === '1' || process.env.NANOFORGE_NO_OPEN === 'true' || Boolean(process.env.CI),
    dryRun: false,
    distRoot: '',
    workspaceRoot: process.env.NANOFORGE_WORKSPACE || '',
    allowWorkspaceWrites: process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES === '1',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p' || arg === '--ui-port') {
      args.uiPort = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      args.uiPort = Number(arg.split('=')[1]);
    } else if (arg === '--host-port' || arg === '--hostPort') {
      args.hostPort = Number(argv[++i]);
    } else if (arg.startsWith('--host-port=')) {
      args.hostPort = Number(arg.split('=')[1]);
    } else if (arg === '--token' || arg === '-t') {
      args.token = argv[++i];
    } else if (arg.startsWith('--token=')) {
      args.token = arg.split('=')[1];
    } else if (arg === '--allow-workspace-writes' || arg === '--allow-writes') {
      args.allowWorkspaceWrites = true;
    } else if (arg === '--no-open' || arg === '--headless') {
      args.noOpen = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.noOpen = true;
    } else if (arg === '--root' || arg === '--dist') {
      args.distRoot = argv[++i];
    } else if (arg === '--workspace') {
      args.workspaceRoot = argv[++i];
    } else if (arg.startsWith('--workspace=')) {
      args.workspaceRoot = arg.slice('--workspace='.length);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  if (!args.token) {
    args.token = generateToken();
  }

  return args;
}

function resolveDistRoot(customRoot) {
  if (customRoot && fs.existsSync(customRoot)) {
    return path.resolve(customRoot);
  }

  // When running as a SEA binary, __dirname points to the original source location
  // at build time, which won't exist on the target machine. Use process.execPath instead.
  const exeDir = path.dirname(process.execPath);

  const candidates = [
    // 1. Adjacent to executable (standalone / SEA / pkg distribution)
    path.join(exeDir, 'dist'),
    // 2. Local sibling dist directory (dev mode — scripts/dist)
    path.join(__dirname, 'dist'),
    // 3. Local parent dist directory (release/bundle/dist or root dist)
    path.join(__dirname, '..', 'dist'),
    // 4. Release dist directory
    path.join(__dirname, '..', 'release', 'dist'),
    // 5. Release bundle dist directory
    path.join(__dirname, '..', 'release', 'bundle', 'dist'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return path.resolve(candidate);
    }
  }

  // Fallback to closest dist candidate even if index.html is missing
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return path.resolve(path.join(__dirname, '..', 'dist'));
}

function resolveHostEntry() {
  // When running as a SEA binary, prioritize files adjacent to the executable
  const exeDir = path.dirname(process.execPath);

  const candidates = [
    // 1. Adjacent to executable (standalone / SEA / pkg distribution)
    path.join(exeDir, 'server.mjs'),
    path.join(exeDir, 'agent-host.mjs'),
    path.join(exeDir, 'agent-host.cjs'),
    path.join(exeDir, 'server.cjs'),
    // 2. Packaged bundle host script (dev mode — scripts/)
    path.join(__dirname, 'agent-host.cjs'),
    path.join(__dirname, 'server.cjs'),
    path.join(__dirname, 'server.mjs'),
    // 3. Apps agent-host compiled dist
    path.join(__dirname, '..', 'apps', 'agent-host', 'dist', 'server.mjs'),
    path.join(__dirname, '..', 'apps', 'agent-host', 'dist', 'server.cjs'),
    path.join(__dirname, '..', 'release', 'bundle', 'agent-host.cjs'),
    // 4. TypeScript source (development / monorepo mode)
    path.join(__dirname, '..', 'apps', 'agent-host', 'src', 'server.ts'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function resolveNodeExecutable() {
  // Electron can run a child entry point in Node mode when the child receives
  // ELECTRON_RUN_AS_NODE=1. Keep the desktop shell out of the browser-launch
  // path while reusing this audited host bootstrap.
  if (process.versions && process.versions.electron) return process.execPath;
  const isSEA = require('node:module').isBuiltin && process.execPath.toLowerCase().includes('nanoforge');
  if (!isSEA && !process.pkg) return process.execPath;
  try {
    return require('node:child_process').execFileSync('where', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] || process.execPath;
  } catch {
    const candidates = [
      'C:\\Program Files\\nodejs\\node.exe',
      path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'fnm_multishells', 'node.exe'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || process.execPath;
  }
}

function defaultWorkspaceCapabilities(allowWorkspaceWrites) {
  return {
    read: true,
    stat: true,
    watch: true,
    search: true,
    git: true,
    terminal: false,
    subagents: true,
    memory: true,
    reviewedWrite: allowWorkspaceWrites === true || allowWorkspaceWrites === '1',
  };
}

function workspaceLabel(entry) {
  const label = path.basename(entry.path || '').trim();
  return label || 'Workspace';
}

function brokerError(requestId, code, message, recoverable = true) {
  return {
    type: 'workspace.broker.error',
    ...(requestId ? { requestId } : {}),
    code,
    message,
    recoverable,
  };
}

function isOpaqueWorkspaceId(value) {
  return typeof value === 'string' && /^ws_[A-Za-z0-9-]+$/.test(value);
}

function isSafeWorkspaceRelativePath(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('\0')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (/^[A-Za-z]:|^[\\/]{1,2}/.test(value)) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes(':'));
}

/**
 * Owns the browser-safe workspace control-plane state. Registry entries retain
 * canonical paths, while this broker deliberately returns opaque descriptors.
 */
function createWorkspaceBroker(options = {}) {
  const registry = options.registry;
  const picker = options.picker;
  const capabilities = options.capabilities || defaultWorkspaceCapabilities(options.allowWorkspaceWrites);
  const hostPort = Number(options.hostPort || 4174);
  const token = options.token || '';
  const activateWorkspace = options.activateWorkspace;
  const revealWorkspace = options.revealWorkspace;
  let generation = Number(options.generation || 1);
  let activeEntry = options.activeEntry || null;
  let switchState = activeEntry ? 'active' : 'idle';
  let switchMessage;
  const completed = new Map();
  const inFlight = new Map();

  const descriptor = (entry, descriptorGeneration = generation) => ({
    workspaceId: entry.id,
    label: workspaceLabel(entry),
    generation: Math.max(1, descriptorGeneration),
    capabilities: { ...capabilities },
  });
  const connection = () => ({
    websocketUrl: `ws://127.0.0.1:${hostPort}/agent?token=${encodeURIComponent(token)}`,
    port: hostPort,
    token,
    generation,
  });
  const fail = (requestId, error, fallbackCode = 'invalid_request') => {
    switchState = 'failed';
    switchMessage = fallbackCode === 'host_start_failed' ? 'Unable to start the selected workspace.' : 'Workspace request could not be completed.';
    const message = fallbackCode === 'host_start_failed' ? switchMessage : 'Workspace request could not be completed.';
    return brokerError(requestId, fallbackCode, message, true);
  };
  const validateRequest = (request, expectedType, requestId) => {
    if (!request || request.type !== expectedType || typeof request.requestId !== 'string' || request.requestId !== requestId || !requestId || requestId.length > 128) {
      return brokerError(requestId, 'invalid_request', 'The workspace request is invalid.', true);
    }
    return null;
  };
  const execute = async (request, requestId) => {
    const expectedByType = {
      'workspace.choose': 'workspace.choose',
      'workspace.activate': 'workspace.activate',
      'workspace.recent.remove': 'workspace.recent.remove',
      'workspace.recent.pin': 'workspace.recent.pin',
      'workspace.reveal': 'workspace.reveal',
    };
    const invalid = validateRequest(request, expectedByType[request && request.type], requestId);
    if (invalid) return { status: 400, payload: invalid };
    const idempotencyKey = request.idempotencyKey;
    if (idempotencyKey && completed.has(`${request.type}:${idempotencyKey}`)) return completed.get(`${request.type}:${idempotencyKey}`);
    let payload;
    try {
      if (request.type === 'workspace.choose') {
        switchState = 'choosing';
        const selected = await picker.pick();
        if (!selected || selected.status === 'cancelled') {
          switchState = 'idle';
          payload = brokerError(requestId, 'picker_cancelled', 'No workspace was selected.', true);
          return { status: 409, payload };
        }
        if (selected.status !== 'selected' || typeof selected.path !== 'string') return { status: 503, payload: fail(requestId, null) };
        switchState = 'validating';
        const entry = registry.open(selected.path);
        switchState = 'idle';
        payload = { type: 'workspace.choose.result', requestId, workspace: descriptor(entry) };
      } else if (request.type === 'workspace.activate') {
        if (!isOpaqueWorkspaceId(request.workspaceId) || typeof idempotencyKey !== 'string' || !idempotencyKey) return { status: 400, payload: brokerError(requestId, 'invalid_request', 'The workspace request is invalid.', true) };
        switchState = 'validating';
        const entry = registry.resolve(request.workspaceId);
        if (!entry) {
          switchState = 'idle';
          return { status: 404, payload: brokerError(requestId, 'unknown_workspace', 'The selected workspace is no longer available.', true) };
        }
        switchState = 'activating';
        if (typeof activateWorkspace !== 'function') return { status: 503, payload: fail(requestId, null, 'host_start_failed') };
        const nextGeneration = generation + 1;
        await activateWorkspace(entry.path, nextGeneration);
        generation = nextGeneration;
        activeEntry = entry;
        switchState = 'active';
        switchMessage = undefined;
        payload = { type: 'workspace.activate.result', requestId, workspace: descriptor(entry), connection: connection() };
      } else if (request.type === 'workspace.recent.remove') {
        if (!isOpaqueWorkspaceId(request.workspaceId) || typeof idempotencyKey !== 'string' || !idempotencyKey) return { status: 400, payload: brokerError(requestId, 'invalid_request', 'The workspace request is invalid.', true) };
        if (!registry.remove(request.workspaceId)) return { status: 404, payload: brokerError(requestId, 'unknown_workspace', 'The selected workspace is no longer available.', true) };
        if (activeEntry && activeEntry.id === request.workspaceId) activeEntry = null;
        payload = { type: 'workspace.recent.remove.result', requestId, workspaceId: request.workspaceId, removed: true };
      } else if (request.type === 'workspace.recent.pin') {
        if (!isOpaqueWorkspaceId(request.workspaceId) || typeof request.pinned !== 'boolean' || typeof idempotencyKey !== 'string' || !idempotencyKey) return { status: 400, payload: brokerError(requestId, 'invalid_request', 'The workspace request is invalid.', true) };
        const entry = registry.pin(request.workspaceId, request.pinned);
        if (!entry) return { status: 404, payload: brokerError(requestId, 'unknown_workspace', 'The selected workspace is no longer available.', true) };
        payload = { type: 'workspace.recent.pin.result', requestId, workspace: descriptor(entry), pinned: entry.pinned === true };
      } else if (request.type === 'workspace.reveal') {
        if (!isOpaqueWorkspaceId(request.workspaceId) || !isSafeWorkspaceRelativePath(request.relativePath)) return { status: 400, payload: brokerError(requestId, 'invalid_request', 'The workspace request is invalid.', true) };
        const entry = registry.resolve(request.workspaceId);
        if (!entry) return { status: 404, payload: brokerError(requestId, 'unknown_workspace', 'The selected workspace is no longer available.', true) };
        const target = path.resolve(entry.path, request.relativePath);
        if (!isPathWithinRoot(target, entry.path)) return { status: 400, payload: brokerError(requestId, 'invalid_request', 'The requested item is outside the workspace.', true) };
        if (typeof revealWorkspace !== 'function') return { status: 503, payload: brokerError(requestId, 'invalid_request', 'Workspace reveal is unavailable.', true) };
        await revealWorkspace(target);
        payload = { type: 'workspace.reveal.result', requestId, revealed: true };
      }
    } catch (error) {
      return { status: 503, payload: fail(requestId, error, request.type === 'workspace.activate' ? 'host_start_failed' : 'workspace_missing') };
    }
    const result = { status: 200, payload };
    if (idempotencyKey) completed.set(`${request.type}:${idempotencyKey}`, result);
    return result;
  };
  const complete = (request, requestId) => {
    const idempotencyKey = request && request.idempotencyKey;
    const operationKey = request && request.type && typeof idempotencyKey === 'string' && idempotencyKey
      ? `${request.type}:${idempotencyKey}`
      : null;
    if (operationKey && completed.has(operationKey)) return Promise.resolve(completed.get(operationKey));
    if (operationKey && inFlight.has(operationKey)) return inFlight.get(operationKey);
    const operation = execute(request, requestId);
    if (!operationKey) return operation;
    const shared = operation.finally(() => inFlight.delete(operationKey));
    inFlight.set(operationKey, shared);
    return shared;
  };
  const query = (type, requestId) => {
    if (!requestId || requestId.length > 128) return { status: 400, payload: brokerError(requestId, 'invalid_request', 'The workspace request is invalid.', true) };
    if (type === 'workspace.current') return { status: 200, payload: { type: 'workspace.current.result', requestId, ...(activeEntry ? { workspace: descriptor(activeEntry), connection: connection() } : {}) } };
    if (type === 'workspace.recent.list') return { status: 200, payload: { type: 'workspace.recent.list.result', requestId, workspaces: registry.list().map((entry) => descriptor(entry)) } };
    return { status: 200, payload: { type: 'workspace.switch.status.result', requestId, state: switchState, ...(activeEntry ? { workspace: descriptor(activeEntry) } : {}), ...(switchMessage ? { message: switchMessage } : {}) } };
  };
  return { complete, query, setActiveEntry: (entry) => { activeEntry = entry; switchState = entry ? 'active' : 'idle'; } };
}

function createStaticServer(distRoot, api = {}) {
  const resolvedDistRoot = path.resolve(distRoot);
  const legacyRecentDescriptor = (entry) => ({
    workspaceId: entry.id,
    label: workspaceLabel(entry),
    generation: 1,
    capabilities: defaultWorkspaceCapabilities(false),
  });
  return http.createServer((req, res) => {
    const requestPath = (req.url || '/').split('?')[0];
    const authorization = req.headers.authorization || '';
    const isAuthorized = () => !api.token || authorization === `Bearer ${api.token}`;
    const rejectUnauthorized = () => {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    };
    const respondJson = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    const readJsonBody = (callback) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16 * 1024) req.destroy();
      });
      req.on('end', () => {
        try { callback(JSON.parse(body || '{}')); } catch { respondJson(400, { error: 'invalid JSON body' }); }
      });
    };
    const brokerPostPaths = {
      '/workspace/choose': 'workspace.choose',
      '/workspace/activate': 'workspace.activate',
      '/workspace/recent/remove': 'workspace.recent.remove',
      '/workspace/recent/pin': 'workspace.recent.pin',
      '/workspace/reveal': 'workspace.reveal',
    };
    const brokerGetPaths = {
      '/workspace/current': 'workspace.current',
      '/workspace/recent': 'workspace.recent.list',
      '/workspace/switch/status': 'workspace.switch.status',
    };
    if (api.workspaceBroker && brokerPostPaths[requestPath] && req.method === 'POST') {
      if (!isAuthorized()) { rejectUnauthorized(); return; }
      const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : '';
      readJsonBody(async (payload) => {
        const result = await api.workspaceBroker.complete(payload, requestId);
        respondJson(result.status, result.payload);
      });
      return;
    }
    if (api.workspaceBroker && brokerGetPaths[requestPath] && req.method === 'GET') {
      if (!isAuthorized()) { rejectUnauthorized(); return; }
      const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : '';
      const result = api.workspaceBroker.query(brokerGetPaths[requestPath], requestId);
      respondJson(result.status, result.payload);
      return;
    }
    const recentMatch = /^\/api\/workspace\/recent\/([^/]+)$/.exec(requestPath);
    if (api.workspacePicker && requestPath === '/api/workspace/pick' && req.method === 'POST') {
      if (!isAuthorized()) { rejectUnauthorized(); return; }
      Promise.resolve(api.workspacePicker.pick()).then((result) => respondJson(200, result), () => respondJson(503, { error: 'workspace picker unavailable' }));
      return;
    }
    if (api.workspaceRegistry && requestPath === '/api/workspace/recent' && req.method === 'GET') {
      if (!isAuthorized()) { rejectUnauthorized(); return; }
      // Keep the legacy route available while ensuring it cannot disclose the
      // registry's private canonical paths.
      respondJson(200, { workspaces: api.workspaceRegistry.list().map(legacyRecentDescriptor) });
      return;
    }
    if (api.workspaceRegistry && recentMatch && req.method === 'PATCH') {
      if (!isAuthorized()) { rejectUnauthorized(); return; }
      readJsonBody((payload) => {
        if (!payload || typeof payload.pinned !== 'boolean') { respondJson(400, { error: 'pinned must be boolean' }); return; }
        const workspace = api.workspaceRegistry.pin(recentMatch[1], payload.pinned);
        if (!workspace) { respondJson(404, { error: 'workspace not found' }); return; }
        respondJson(200, workspace);
      });
      return;
    }
    if (api.workspaceRegistry && recentMatch && req.method === 'DELETE') {
      if (!isAuthorized()) { rejectUnauthorized(); return; }
      if (!api.workspaceRegistry.remove(recentMatch[1])) { respondJson(404, { error: 'workspace not found' }); return; }
      respondJson(200, { removed: true });
      return;
    }
    if (req.method === 'POST' && requestPath === '/api/workspace' && typeof api.onWorkspaceOpen === 'function') {
      if (!isAuthorized()) {
        rejectUnauthorized();
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16 * 1024) req.destroy();
      });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (typeof payload.path !== 'string' || !payload.path.trim()) throw new Error('workspace path is required');
          const result = await api.onWorkspaceOpen(payload.path.trim());
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      return;
    }
    // Decode once, then reject malformed or NUL-containing request paths.
    const rawUrl = req.url || '/';
    const rawPath = rawUrl.split(/[?#]/)[0] || '/';
    let cleanPath;
    try {
      cleanPath = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }
    if (rawUrl.includes('\0') || cleanPath.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    // Treat both URL separators as path separators before resolving. This
    // protects POSIX test/dev hosts from Windows-style traversal probes too.
    const normalizedInput = cleanPath.replace(/[\\/]+/g, path.sep);
    let relativeTarget = normalizedInput;
    while (relativeTarget.startsWith(path.sep)) relativeTarget = relativeTarget.slice(path.sep.length);
    if (!relativeTarget) relativeTarget = 'index.html';
    const candidateFile = path.resolve(resolvedDistRoot, relativeTarget);

    if (!isPathWithinRoot(candidateFile, resolvedDistRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(candidateFile, (err, stats) => {
      if (!err && stats.isFile()) {
        const stream = fs.createReadStream(candidateFile);
        res.writeHead(200, {
          'Content-Type': getMimeType(candidateFile),
          'Content-Length': stats.size,
          'X-Content-Type-Options': 'nosniff',
        });
        stream.pipe(res);
        return;
      }

      // SPA fallback to index.html for client-side routing
      const indexFile = path.join(resolvedDistRoot, 'index.html');
      fs.stat(indexFile, (indexErr, indexStats) => {
        if (!indexErr && indexStats.isFile()) {
          const indexStream = fs.createReadStream(indexFile);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': indexStats.size,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          });
          indexStream.pipe(res);
          return;
        }

        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>NanoForge - Build Required</title></head>
            <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem;">
              <h1 style="color: #f59e0b;">NanoForge Production Build Not Found</h1>
              <p>The web UI assets were not found at <code>${distRoot}</code>.</p>
              <p>Please compile the frontend using: <code>npm run build</code></p>
            </body>
          </html>
        `);
      });
    });
  });
}

function isPathWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function openBrowser(url) {
  const platform = process.platform;
  let command = '';

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.warn(`[launcher] Note: Could not auto-launch browser automatically: ${err.message}`);
      console.log(`[launcher] Please navigate manually to: ${url}`);
    }
  });
}

async function startLauncher(options = {}) {
  const config = Object.assign({}, parseArgs(), options);
  const childEnvironment = config.childEnvironment || {};

  if (config.help) {
    console.log(`
NanoForge Standalone Dual Launcher
Usage: node nanoforge-launcher.cjs [options]

Options:
  --port, -p, --ui-port <port>    Web UI static server port (default: 4173)
  --host-port <port>              Agent host daemon port (default: 4174)
  --token, -t <token>             Authentication session token (default: generated)
  --allow-workspace-writes        Permit reviewed file writes to the local workspace root (default: disabled)
  --root <path>                   Custom static dist root directory
  --workspace <path>              Canonical local workspace for host startup
  --no-open, --headless           Do not automatically open default browser
  --dry-run                       Validate configuration and exit cleanly
  --help, -h                      Show this help message
`);
    return { status: 'help' };
  }

  const allowWorkspaceWrites = (Boolean(config.allowWorkspaceWrites) || process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES === '1') ? '1' : '0';
  const distRoot = resolveDistRoot(config.distRoot);
  const hostEntry = resolveHostEntry();
  // Normal launcher runs own real local services. Tests may still inject
  // isolated implementations through the existing option hooks.
  const workspacePicker = config.workspacePicker || createWindowsFolderPicker();
  const workspaceRegistry = config.workspaceRegistry || createWorkspaceRegistry();
  let initialWorkspaceEntry = null;
  if (config.workspaceRoot) {
    const workspaceRoot = path.resolve(config.workspaceRoot);
    let workspaceStat;
    try {
      workspaceStat = fs.statSync(workspaceRoot);
    } catch {
      throw new Error(`Workspace does not exist: ${workspaceRoot}`);
    }
    if (!workspaceStat.isDirectory()) {
      throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
    }
    config.workspaceRoot = workspaceRoot;
    initialWorkspaceEntry = workspaceRegistry.open(workspaceRoot);
  }

  console.log('===================================================');
  console.log('       NanoForge Phase 6 - Platform Launcher       ');
  console.log('===================================================');
  console.log(`[launcher] UI Root:     ${distRoot}`);
  console.log(`[launcher] Host Entry:  ${hostEntry || 'None found (will start UI only)'}`);
  console.log(`[launcher] Host Port:   ${config.hostPort}`);
  console.log(`[launcher] UI Port:     ${config.uiPort}`);
  console.log(`[launcher] Workspace:   ${config.workspaceRoot ? 'configured (private)' : 'not configured'}`);
  console.log(`[launcher] Writes:      ${allowWorkspaceWrites === '1' ? 'ENABLED (opt-in)' : 'DISABLED (default)'}`);
  console.log(`[launcher] Auth Token:  ${config.token.slice(0, 8)}... (redacted)`);

  let hostProcess = null;

  // 1. Start Fastify Agent Host daemon if host entry exists
  if (hostEntry && !config.dryRun) {
    const isTypeScript = hostEntry.endsWith('.ts');
    const isWindows = process.platform === 'win32';

    const env = buildChildEnvironment({
      PORT: String(config.hostPort),
      TOKEN: config.token,
      HOST: '127.0.0.1',
      NANOFORGE_ALLOWED_ORIGINS: `http://127.0.0.1:${config.uiPort}`,
      NANOFORGE_WORKSPACE: config.workspaceRoot || process.cwd(),
      NANOFORGE_ALLOW_WORKSPACE_WRITES: allowWorkspaceWrites,
      NANOFORGE_WORKSPACE_GENERATION: '1',
      ...childEnvironment,
    });

    if (isTypeScript) {
      const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', isWindows ? 'tsx.cmd' : 'tsx');
      const cmd = fs.existsSync(tsxBin) ? tsxBin : (isWindows ? 'npx.cmd' : 'npx');
      const args = fs.existsSync(tsxBin) ? [hostEntry] : ['tsx', hostEntry];

      hostProcess = spawn(cmd, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows,
        windowsHide: true,
      });
    } else {
      // When running as a Node SEA binary, process.execPath points to NanoForge.exe,
      // NOT to node.exe. We must find the real node.exe to spawn subprocesses.
      hostProcess = spawn(resolveNodeExecutable(), [hostEntry], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    }

    if (hostProcess) {
      hostProcess.stdout?.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[agent-host] ${text}`);
      });

      hostProcess.stderr?.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[agent-host] ${text}`);
      });

      hostProcess.on('error', (err) => {
        console.error(`[launcher] Failed to spawn agent host: ${err.message}`);
      });

      hostProcess.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.warn(`[launcher] Agent host process exited with code ${code} (${signal || 'none'})`);
        }
      });
    }
  }

  const spawnReplacementHost = (workspaceRoot, workspaceGeneration = 1) => {
    if (!hostEntry) throw new Error('Agent host entry is unavailable');
    const env = buildChildEnvironment({
      PORT: String(config.hostPort),
      TOKEN: config.token,
      HOST: '127.0.0.1',
      NANOFORGE_ALLOWED_ORIGINS: `http://127.0.0.1:${config.uiPort}`,
      NANOFORGE_WORKSPACE: workspaceRoot,
      NANOFORGE_ALLOW_WORKSPACE_WRITES: allowWorkspaceWrites,
      NANOFORGE_WORKSPACE_GENERATION: String(workspaceGeneration),
      ...childEnvironment,
    });
    const isTypeScript = hostEntry.endsWith('.ts');
    const isWindows = process.platform === 'win32';
    if (isTypeScript) {
      const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', isWindows ? 'tsx.cmd' : 'tsx');
      const cmd = fs.existsSync(tsxBin) ? tsxBin : (isWindows ? 'npx.cmd' : 'npx');
      const args = fs.existsSync(tsxBin) ? [hostEntry] : ['tsx', hostEntry];
      return spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows, windowsHide: true });
    }
    return spawn(resolveNodeExecutable(), [hostEntry], { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  };

  const restartHostForWorkspace = async (requestedRoot, workspaceGeneration = 1) => {
    const workspaceRoot = path.resolve(requestedRoot);
    const stats = fs.statSync(workspaceRoot);
    if (!stats.isDirectory()) throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
    if (hostProcess && !hostProcess.killed) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        hostProcess.once('exit', finish);
        if (process.platform === 'win32' && hostProcess.pid) exec(`taskkill /pid ${hostProcess.pid} /T /F`, finish);
        else hostProcess.kill('SIGTERM');
        setTimeout(finish, 5000);
      });
    }
    config.workspaceRoot = workspaceRoot;
    hostProcess = spawnReplacementHost(workspaceRoot, workspaceGeneration);
    hostProcess.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) console.log(`[agent-host] ${text}`);
    });
    hostProcess.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) console.error(`[agent-host] ${text}`);
    });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const probe = () => {
        const request = http.get(`http://127.0.0.1:${config.hostPort}/health`, (response) => {
          response.resume();
          if (response.statusCode === 200) { resolve(); return; }
          retry();
        });
        request.on('error', retry);
        request.setTimeout(500, () => { request.destroy(); retry(); });
      };
      const retry = () => {
        if (Date.now() >= deadline) { reject(new Error('The replacement agent host did not become ready')); return; }
        setTimeout(probe, 100);
      };
      probe();
    });
    return { activated: true };
  };

  const revealWorkspace = async (targetPath) => {
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [targetPath], { shell: false, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
  };
  const workspaceBroker = config.workspaceBroker || createWorkspaceBroker({
    picker: workspacePicker,
    registry: workspaceRegistry,
    activateWorkspace: restartHostForWorkspace,
    revealWorkspace,
    hostPort: config.hostPort,
    token: config.token,
    activeEntry: initialWorkspaceEntry,
    allowWorkspaceWrites,
  });

  // 2. Start Web UI Static Server
  const uiServer = createStaticServer(distRoot, {
    token: config.token,
    onWorkspaceOpen: restartHostForWorkspace,
    workspacePicker,
    workspaceRegistry,
    workspaceBroker,
  });

  const serverPromise = new Promise((resolve, reject) => {
    uiServer.once('error', (err) => {
      console.error(`[launcher] UI Server Error: ${err.message}`);
      reject(err);
    });

    uiServer.listen(config.uiPort, '127.0.0.1', () => {
      const launchUrl = `http://127.0.0.1:${config.uiPort}/?hostPort=${config.hostPort}&token=${encodeURIComponent(config.token)}`;
      console.log(`[launcher] Web UI ready at:   http://127.0.0.1:${config.uiPort}`);
      console.log(`[launcher] Agent Host URL:   ws://127.0.0.1:${config.hostPort}/agent?token=${config.token.slice(0, 8)}...`);
      console.log(`[launcher] Browser URL:      http://127.0.0.1:${config.uiPort} (session parameters redacted)`);
      console.log('===================================================');

      if (!config.noOpen && !config.dryRun) {
        openBrowser(launchUrl);
      }

      resolve({
        uiServer,
        hostProcess,
        launchUrl,
        config,
        distRoot,
      });
    });
  });

  const handle = await serverPromise;

  const shutdown = async () => {
    console.log('\n[launcher] Shutting down NanoForge services...');
    if (hostProcess && !hostProcess.killed) {
      try {
        if (process.platform === 'win32' && hostProcess.pid) {
          exec(`taskkill /pid ${hostProcess.pid} /T /F`, () => {});
        } else {
          hostProcess.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
    }

    if (uiServer) {
      await new Promise((res) => uiServer.close(res));
    }
    console.log('[launcher] NanoForge stopped cleanly.');
  };

  process.once('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  if (config.dryRun) {
    console.log('[launcher] Dry run completed successfully.');
    await shutdown();
  }

  return {
    ...handle,
    shutdown,
  };
}

// Direct CLI invocation check
if (require.main === module) {
  startLauncher().catch((err) => {
    console.error(`[launcher] Fatal initialization error:`, err);
    process.exit(1);
  });
}

module.exports = {
  startLauncher,
  resolveDistRoot,
  resolveHostEntry,
  getMimeType,
  generateToken,
  parseArgs,
  createStaticServer,
  createWorkspaceBroker,
  resolveLauncherSidecar,
  isOpaqueWorkspaceId,
  isSafeWorkspaceRelativePath,
  isPathWithinRoot,
  buildChildEnvironment,
  MIME_TYPES,
};
