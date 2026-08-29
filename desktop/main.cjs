const { app, BrowserWindow, dialog } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { startLauncher } = require('../scripts/nanoforge-launcher.cjs');

app.setName('NanoForge');

let mainWindow = null;
let launcher = null;
let isQuitting = false;

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

function waitForHost(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
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

async function createMainWindow() {
  const [uiPort, hostPort] = await Promise.all([reserveLoopbackPort(), reserveLoopbackPort()]);
  const token = crypto.randomBytes(24).toString('base64url');

  launcher = await startLauncher({
    uiPort,
    hostPort,
    token,
    noOpen: true,
    // The renderer still needs a host-issued, single-use capability grant for
    // every write. This only enables the desktop host to present that gate.
    allowWorkspaceWrites: true,
    workspacePicker: createDesktopFolderPicker(),
    childEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
  });
  await waitForHost(hostPort);

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
  await mainWindow.loadURL(launcher.launchUrl);
}

app.whenReady()
  .then(createMainWindow)
  .catch((error) => {
    dialog.showErrorBox('NanoForge could not start', error.message);
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (isQuitting || !launcher) return;
  event.preventDefault();
  isQuitting = true;
  launcher.shutdown().finally(() => app.quit());
});
