const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function loadStartupHelpers() {
  const filename = path.join(__dirname, 'main.cjs');
  const source = fs.readFileSync(filename, 'utf8');
  const fakeApp = {
    setName() {},
    whenReady() { return { then() { return { catch() {} }; } }; },
    on() {},
    quit() {},
    exit() {},
  };
  const fakeElectron = {
    app: fakeApp,
    BrowserWindow: class {},
    dialog: { showErrorBox() {}, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  };
  const module = { exports: {} };
  const localRequire = (request) => request === 'electron' ? fakeElectron : require(request);
  const sandbox = {
    __dirname,
    console,
    module,
    exports: module.exports,
    require: localRequire,
    process,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, sandbox, { filename });
  return module.exports;
}

test('startup failure screen offers retry and redacted diagnostics', () => {
  const { startupPage, sanitizeDiagnosticText } = loadStartupHelpers();
  const message = sanitizeDiagnosticText('host failed?token=secret-value Bearer abc.def.ghi');
  const diagnostic = { error: message, attempt: 2, hostPort: 4217 };
  const html = startupPage({ phase: 'startup failed', message, diagnostic, canRetry: true });

  assert.match(html, /Retry startup/);
  assert.match(html, /Copy diagnostics/);
  assert.match(html, /startup failed/);
  assert.doesNotMatch(html, /secret-value/);
  assert.doesNotMatch(html, /abc\.def\.ghi/);
  assert.match(html, /navigator\.clipboard\.writeText/);
});

test('startup status screen escapes renderer-visible error text', () => {
  const { startupPage } = loadStartupHelpers();
  const html = startupPage({ phase: 'starting', message: '<script>alert(1)</script>' });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<p[^>]*><script>/);
});
