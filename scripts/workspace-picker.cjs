/**
 * Dependency-free boundary for the Windows native folder chooser.
 * The PowerShell program is fixed; selected paths only travel back on stdout.
 */
const childProcess = require('node:child_process');

const PICK_FOLDER_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = "Select a workspace folder for NanoForge"',
  '$dialog.ShowNewFolderButton = $false',
  'try { if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } } finally { $dialog.Dispose() }',
].join('; ');

function createWindowsFolderPicker(options = {}) {
  const platform = options.platform || process.platform;
  const execFile = options.execFile || childProcess.execFile;
  const executable = options.executable || 'powershell.exe';
  let activePick = null;

  return {
    pick() {
      if (platform !== 'win32') return Promise.resolve({ status: 'error', code: 'unsupported_platform' });
      if (activePick) return activePick;

      let settle;
      activePick = new Promise((resolve) => {
        settle = resolve;
      });
      // Defer invocation until activePick is assigned. This also makes the
      // lifecycle correct for test doubles and native callbacks that complete
      // synchronously.
      Promise.resolve().then(() => {
        // Never enable a shell and never append user supplied values to args.
        execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-STA', '-Command', PICK_FOLDER_SCRIPT], {
          // CREATE_NO_WINDOW hides WinForms dialogs as well as the console on
          // some Windows hosts. Let PowerShell hide only its console window.
          windowsHide: false,
          maxBuffer: 16 * 1024,
        }, (error, stdout) => {
          activePick = null;
          if (error) {
            settle({ status: 'error', code: 'picker_unavailable' });
            return;
          }
          const selectedPath = String(stdout || '').trim();
          settle(selectedPath ? { status: 'selected', path: selectedPath } : { status: 'cancelled' });
        });
      });
      return activePick;
    },
  };
}

module.exports = { createWindowsFolderPicker, PICK_FOLDER_SCRIPT };
