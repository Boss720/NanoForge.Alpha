const { app, BrowserWindow, dialog } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { startLauncher } = require('../scripts/nanoforge-launcher.cjs');

app.setName('NanoForge');

let mainWindow = null;
let launcher = null;
let isQuitting = false;
let startupBusy = false;
let startupAttempt = 0;
let startupSecret = '';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeDiagnosticText(value) {
  let text = String(value || 'Unknown startup error');
  for (const secret of [startupSecret]) {
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/([?&](?:token|bootstrapToken)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(?:bearer|x-api-key|api-key)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted credential]');
}

function startupDiagnostic(error, phase, ports) {
  return {
    app: 'NanoForge',
    phase,
    attempt: startupAttempt,
    platform: process.platform,
    electron: process.versions.electron || 'unknown',
    node: process.versions.node || 'unknown',
    uiPort: ports?.uiPort || null,
    hostPort: ports?.hostPort || null,
    error: sanitizeDiagnosticText(error?.message || error),
    time: new Date().toISOString(),
  };
}

function startupPage({ phase = 'starting', message, diagnostic, canRetry = false }) {
  const safeMessage = escapeHtml(message || 'Starting local services…');
  const details = diagnostic ? escapeHtml(JSON.stringify(diagnostic, null, 2)) : '';
  const retry = canRetry
    ? '<a class="button primary" href="#retry">Retry startup</a>'
    : '<span class="progress" aria-label="Startup in progress">Working…</span>';
  const copy = diagnostic
    ? '<button class="button" id="copy" type="button">Copy diagnostics</button><span id="copied" role="status"></span>'
    : '';
  const escapedJson = diagnostic
    ? JSON.stringify(diagnostic).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NanoForge startup</title>
<style>
  :root { font-family: Segoe UI, system-ui, sans-serif; color: #e8edf7; background: #101522; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  main { width: min(680px, calc(100vw - 64px)); padding: 36px; border: 1px solid #2b3952; border-radius: 16px; background: #171f2f; box-shadow: 0 20px 70px #05081099; }
  h1 { margin: 0 0 10px; font-size: 26px; } p { color: #aebbd0; line-height: 1.5; }
  .phase { color: #79a9ff; font-size: 13px; text-transform: uppercase; letter-spacing: .09em; }
  .error { color: #ffb4ab; } .actions { display: flex; gap: 10px; align-items: center; margin-top: 24px; }
  .button { display: inline-block; padding: 10px 15px; border: 1px solid #42516d; border-radius: 8px; color: #e8edf7; background: #222d42; text-decoration: none; cursor: pointer; font: inherit; }
  .button.primary { color: #07101f; background: #8ab4ff; border-color: #8ab4ff; font-weight: 600; } .progress { color: #aebbd0; }
  pre { max-height: 180px; overflow: auto; padding: 13px; border-radius: 8px; background: #0e1420; color: #aebbd0; font: 12px ui-monospace, monospace; white-space: pre-wrap; }
  #copied { color: #86efac; font-size: 12px; }
</style></head><body><main>
  <div class="phase">NanoForge · ${escapeHtml(phase)}</div>
  <h1>${canRetry ? 'NanoForge needs attention' : 'Starting NanoForge'}</h1>
  <p class="${canRetry ? 'error' : ''}">${safeMessage}</p>
  ${details ? `<details><summary>Technical details</summary><pre>${details}</pre></details>` : ''}
  <div class="actions">${retry}${copy}</div>
</main>
<script>
  const diagnostic = ${escapedJson || 'null'};
  document.getElementById('copy')?.addEventListener('click', async () => {
    const text = JSON.stringify(diagnostic, null, 2);
    try { await navigator.clipboard.writeText(text); }
    catch { const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
    document.getElementById('copied').textContent = 'Copied';
  });
</script></body></html>`;
}

function showStartupScreen(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  return mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage(state))}`)
    .catch(() => undefined);
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForHost(port, timeoutMs = 8000, onProgress) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    onProgress?.('Waiting for the local agent host…');
    const probe = () => {
      const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.once('error', retry);
      request.setTimeout(500, () => { request.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() >= deadline) return reject(new Error('NanoForge local host did not start.'));
      setTimeout(probe, 100);
    };
    probe();
  });
}

function createDesktopFolderPicker() {
  return {
    async pick() {
      const selection = await dialog.showOpenDialog(mainWindow || undefined, {
        title: 'Open a local folder',
        buttonLabel: 'Open folder',
        properties: ['openDirectory', 'dontAddToRecent'],
      });
      if (selection.canceled || !selection.filePaths[0]) return { status: 'cancelled' };
      return { status: 'selected', path: selection.filePaths[0] };
    },
  };
}

function configureMainWindow() {
  if (mainWindow) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'NanoForge',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    if (url.endsWith('#retry') && !startupBusy) void startServices();
  });
  return mainWindow;
}

async function shutdownLauncher() {
  if (!launcher) return;
  const activeLauncher = launcher;
  launcher = null;
  try { await activeLauncher.shutdown(); } catch { /* best effort cleanup after a failed start */ }
}

async function startServices() {
  if (startupBusy || isQuitting) return;
  startupBusy = true;
  startupAttempt += 1;
  configureMainWindow();
  await showStartupScreen({ phase: 'preparing', message: 'Preparing secure local services…' });
  let ports = null;
  try {
    ports = {
      uiPort: await reserveLoopbackPort(),
      hostPort: await reserveLoopbackPort(),
    };
    startupSecret = crypto.randomBytes(24).toString('base64url');
    await showStartupScreen({ phase: 'starting host', message: 'Starting the local agent host…' });
    launcher = await startLauncher({
      uiPort: ports.uiPort,
      hostPort: ports.hostPort,
      token: startupSecret,
      noOpen: true,
      // The renderer still needs a host-issued, single-use capability grant for
      // every write. This only enables the desktop host to present that gate.
      allowWorkspaceWrites: true,
      workspacePicker: createDesktopFolderPicker(),
      childEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
    });
    await waitForHost(ports.hostPort, 8000, (message) => { void showStartupScreen({ phase: 'connecting', message }); });
    await showStartupScreen({ phase: 'ready', message: 'Local services are ready. Loading NanoForge…' });
    await mainWindow.loadURL(launcher.launchUrl);
  } catch (error) {
    await shutdownLauncher();
    const diagnostic = startupDiagnostic(error, 'startup', ports);
    showStartupScreen({
      phase: 'startup failed',
      message: `${diagnostic.error} Retry startup or copy diagnostics for support.`,
      diagnostic,
      canRetry: true,
    });
  } finally {
    startupBusy = false;
  }
}

app.whenReady()
  .then(() => startServices())
  .catch((error) => {
    const diagnostic = startupDiagnostic(error, 'application', null);
    dialog.showErrorBox('NanoForge could not start', `${diagnostic.error}\n\nYou can restart NanoForge and try again.`);
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (isQuitting || !launcher) return;
  event.preventDefault();
  isQuitting = true;
  launcher.shutdown().finally(() => app.quit());
});

// Kept exportable so the startup surface can be checked without launching the
// Electron process (the desktop smoke test loads these helpers in isolation).
module.exports = {
  escapeHtml,
  sanitizeDiagnosticText,
  startupDiagnostic,
  startupPage,
  waitForHost,
};
