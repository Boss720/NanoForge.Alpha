/**
 * NanoForge Automated Release Packager (scripts/package-release.js)
 *
 * Responsibilities:
 * 1. Verifies/compiles Vite frontend production build in `dist/`.
 * 2. Compiles/bundles Fastify Agent Host backend using esbuild in `apps/agent-host/dist/` and `release/bundle/`.
 * 3. Assembles clean distribution structure in `release/bundle/` containing:
 *    - launcher (`launcher.cjs`, `nanoforge-launcher.cjs`)
 *    - backend daemon (`agent-host.mjs`, `server.mjs`)
 *    - frontend web UI assets (`dist/`)
 *    - Windows installers (`install-nanoforge.ps1`, `install-nanoforge.bat`, `uninstall-nanoforge.ps1`)
 *    - Standalone batch launcher (`NanoForge.bat`)
 *    - Standalone Windows executable (`NanoForge.exe`)
 *    - Release metadata (`package.json`, `README.txt`)
 * 4. Compresses release package into `release/NanoForge-v0.6.0-windows-x64.zip`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');
export const HOST_SRC = path.join(ROOT_DIR, 'apps', 'agent-host', 'src', 'server.ts');
export const HOST_DIST_DIR = path.join(ROOT_DIR, 'apps', 'agent-host', 'dist');
export const RELEASE_DIR = path.join(ROOT_DIR, 'release');
export const BUNDLE_DIR = path.join(RELEASE_DIR, 'bundle');
export const PROTOCOL_SRC = path.join(ROOT_DIR, 'packages', 'protocol', 'src');

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    skipBuild: false,
    dryRun: false,
    version: '0.6.0',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = argv[++i] || options.version;
    } else if (arg.startsWith('--version=')) {
      options.version = arg.split('=')[1] || options.version;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

export function copyDirectorySync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectorySync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function ensureDirectoryClean(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (err) {
      // On Windows, EPERM can occur if files are locked; try emptying contents instead
      console.warn(`[packager] Warning: Could not remove ${dirPath} (${err.code}). Attempting to clean contents...`);
      try {
        const entries = fs.readdirSync(dirPath);
        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry);
          try {
            fs.rmSync(entryPath, { recursive: true, force: true });
          } catch { /* skip locked entries */ }
        }
      } catch { /* proceed with directory as-is */ }
    }
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

export async function buildBackendHost(outDir = HOST_DIST_DIR) {
  console.log('[packager] Bundling Agent Host backend via esbuild...');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'server.mjs');

  await esbuild.build({
    entryPoints: [HOST_SRC],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    alias: {
      '@protocol': PROTOCOL_SRC,
    },
    external: [
      'fsevents',
      'playwright-core',
    ],
    sourcemap: true,
    minify: false,
  });

  console.log(`[packager] Backend bundle generated: ${outFile}`);
  return outFile;
}

export function generateBatchLauncher(destPath) {
  const content = `@echo off
setlocal
title NanoForge Platform
cd /d "%~dp0"

echo ===================================================
echo   NanoForge Standalone Runner
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in system PATH.
    echo Please install Node.js 20+ from https://nodejs.org
    pause
    exit /b 1
)

node "%~dp0nanoforge-launcher.cjs" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo NanoForge exited with status %ERRORLEVEL%.
    pause
)
`;
  fs.writeFileSync(destPath, content, 'utf8');
}

export function generateReleaseReadme(destPath, version = '0.6.0') {
  const content = `===================================================
 NanoForge v${version} - Autonomous Swarm Platform
===================================================

Quick Start:
1. Double-click 'NanoForge.exe' (or 'NanoForge.bat' / 'install-nanoforge.bat').
2. The launcher will start the Fastify Agent Host daemon (port 4174)
   and serve the production Web UI (port 4173).
3. Your default browser will open to:
   http://127.0.0.1:4173/?hostPort=4174&token=...

Included Files:
- NanoForge.exe: Compiled standalone launcher executable
- NanoForge.bat: Zero-dependency Windows script launcher
- install-nanoforge.ps1: PowerShell installer (creates Start/Desktop shortcuts)
- install-nanoforge.bat: One-click batch installer
- uninstall-nanoforge.ps1: PowerShell clean uninstaller
- dist/: Production React 19 + Vite visual control plane
- server.mjs / agent-host.mjs: Fastify Agent Host daemon
- nanoforge-launcher.cjs: Standalone dual-launch coordinator

System Requirements:
- Windows 10/11 x64
- Node.js 20+ (optional when running packaged binary)
`;
  fs.writeFileSync(destPath, content, 'utf8');
}

export function createZipArchive(sourceDir, zipPath) {
  console.log(`[packager] Archiving release to ${zipPath}...`);
  if (fs.existsSync(zipPath)) {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      // Ignore if locked; Compress-Archive -Force handles overwrite
    }
  }

  const isWindows = process.platform === 'win32';
  if (isWindows) {
    // Use PowerShell Compress-Archive for reliable native Windows zip generation
    const cleanSource = path.resolve(sourceDir).replace(/\\/g, '/');
    const cleanZip = path.resolve(zipPath).replace(/\\/g, '/');
    const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '${cleanSource}/*' -DestinationPath '${cleanZip}' -Force"`;
    try {
      execSync(psCmd, { stdio: 'inherit' });
      return true;
    } catch (err) {
      console.warn(`[packager] PowerShell zip compression failed: ${err.message}`);
      return false;
    }
  } else {
    try {
      execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
      return true;
    } catch (err) {
      console.warn(`[packager] Unix zip compression failed: ${err.message}`);
      return false;
    }
  }
}

export async function packageRelease(cliOptions = {}) {
  const options = Object.assign({}, parseCliArgs(), cliOptions);

  if (options.help) {
    console.log(`
NanoForge Release Packager
Usage: node package-release.js [options]

Options:
  --version, -v <version>    Release version tag (default: 0.6.0)
  --skip-build               Skip frontend and backend build steps
  --dry-run                  Prepare release manifests without generating full archive
  --help, -h                 Display help information
`);
    return { success: true };
  }

  console.log('===================================================');
  console.log(`  NanoForge Release Packaging Pipeline (v${options.version})  `);
  console.log('===================================================');

  // Step 1: Verify & Build Frontend Web UI
  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (!options.skipBuild) {
    if (!fs.existsSync(indexHtml)) {
      console.log('[packager] Building Vite frontend into dist/...');
      execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    } else {
      console.log('[packager] Verified frontend build in dist/.');
    }
  }

  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Frontend build missing at ${indexHtml}. Run 'npm run build' first.`);
  }

  // Step 2: Build Backend Host
  if (!options.skipBuild) {
    await buildBackendHost(HOST_DIST_DIR);
  }

  // Step 3: Prepare Release Bundle Directory
  console.log(`[packager] Preparing clean release directory at ${BUNDLE_DIR}...`);
  ensureDirectoryClean(BUNDLE_DIR);
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  // Step 4: Copy Web UI Dist
  console.log('[packager] Copying frontend static assets to release bundle...');
  const bundleDistDir = path.join(BUNDLE_DIR, 'dist');
  copyDirectorySync(DIST_DIR, bundleDistDir);

  const releaseDistDir = path.join(RELEASE_DIR, 'dist');
  copyDirectorySync(DIST_DIR, releaseDistDir);

  // Step 5: Copy Backend Daemon & Launcher
  console.log('[packager] Copying backend daemon and launcher scripts...');
  const launcherSrc = path.join(ROOT_DIR, 'scripts', 'nanoforge-launcher.cjs');
  const bundleLauncherDest = path.join(BUNDLE_DIR, 'nanoforge-launcher.cjs');
  const bundleLauncherAlias = path.join(BUNDLE_DIR, 'launcher.cjs');
  fs.copyFileSync(launcherSrc, bundleLauncherDest);
  fs.copyFileSync(launcherSrc, bundleLauncherAlias);
  // The launcher deliberately keeps native picker and private registry logic
  // as sidecars so a packaged normal run has the same broker capabilities.
  for (const sidecar of ['workspace-picker.cjs', 'workspace-registry.cjs']) {
    fs.copyFileSync(path.join(ROOT_DIR, 'scripts', sidecar), path.join(BUNDLE_DIR, sidecar));
  }

  const hostBundleFile = path.join(HOST_DIST_DIR, 'server.mjs');
  if (fs.existsSync(hostBundleFile)) {
    fs.copyFileSync(hostBundleFile, path.join(BUNDLE_DIR, 'server.mjs'));
    fs.copyFileSync(hostBundleFile, path.join(BUNDLE_DIR, 'agent-host.mjs'));
  }

  // Copy default-policy.json alongside server.mjs — policy.ts resolves it via
  // import.meta.url at runtime, so it must be adjacent to the bundle file.
  const defaultPolicySrc = path.join(ROOT_DIR, 'apps', 'agent-host', 'src', 'policy', 'default-policy.json');
  if (fs.existsSync(defaultPolicySrc)) {
    fs.copyFileSync(defaultPolicySrc, path.join(BUNDLE_DIR, 'default-policy.json'));
    console.log('[packager] Bundled default-policy.json');
  }

  // Step 6: Generate Batch Runner and Documentation
  generateBatchLauncher(path.join(BUNDLE_DIR, 'NanoForge.bat'));
  generateBatchLauncher(path.join(RELEASE_DIR, 'NanoForge.bat'));
  generateReleaseReadme(path.join(BUNDLE_DIR, 'README.txt'), options.version);
  generateReleaseReadme(path.join(RELEASE_DIR, 'README.txt'), options.version);

  // Step 7: Copy & Sync Windows Executable
  const sourceExe = path.join(RELEASE_DIR, 'NanoForge.exe');
  const bundleExe = path.join(BUNDLE_DIR, 'NanoForge.exe');
  if (fs.existsSync(sourceExe)) {
    console.log(`[packager] Syncing NanoForge.exe into bundle (${(fs.statSync(sourceExe).size / (1024 * 1024)).toFixed(2)} MB)...`);
    fs.copyFileSync(sourceExe, bundleExe);
  } else {
    console.warn('[packager] NanoForge.exe not found in release/; creating batch runner fallback.');
  }

  // Step 8: Copy Installer & Uninstaller Scripts
  const installerScripts = [
    'install-nanoforge.ps1',
    'install-nanoforge.bat',
    'uninstall-nanoforge.ps1',
  ];

  for (const script of installerScripts) {
    const src = path.join(RELEASE_DIR, script);
    const dest = path.join(BUNDLE_DIR, script);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[packager] Bundled ${script}`);
    }
  }

  // Step 9: Generate Bundle package.json Manifest
  const bundleManifest = {
    name: 'nanoforge-distribution',
    version: options.version,
    description: 'NanoForge Autonomous Swarm Development Platform',
    main: 'nanoforge-launcher.cjs',
    scripts: {
      start: 'node nanoforge-launcher.cjs',
    },
  };
  fs.writeFileSync(
    path.join(BUNDLE_DIR, 'package.json'),
    JSON.stringify(bundleManifest, null, 2),
    'utf8',
  );

  // Step 10: Create Zip Archive
  const zipFileName = `NanoForge-v${options.version}-windows-x64.zip`;
  const zipFilePath = path.join(RELEASE_DIR, zipFileName);

  if (!options.dryRun) {
    createZipArchive(BUNDLE_DIR, zipFilePath);
  } else {
    console.log(`[packager] Dry run mode enabled — skipped creating ${zipFileName}.`);
  }

  console.log('===================================================');
  console.log('   Release Packaging Finished Successfully!        ');
  console.log('===================================================');
  console.log(`  Bundle Directory:  ${BUNDLE_DIR}`);
  if (fs.existsSync(zipFilePath)) {
    const zipSizeMb = (fs.statSync(zipFilePath).size / (1024 * 1024)).toFixed(2);
    console.log(`  Release Zip:       ${zipFilePath} (${zipSizeMb} MB)`);
  }
  console.log('===================================================');

  return {
    success: true,
    bundleDir: BUNDLE_DIR,
    zipPath: zipFilePath,
    version: options.version,
  };
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  packageRelease().catch((err) => {
    console.error('[packager] Packaging failed:', err);
    process.exit(1);
  });
}
