/**
 * NanoForge Windows Executable Builder (scripts/build-exe.js)
 *
 * Uses Node.js Single Executable Application (SEA) to compile
 * nanoforge-launcher.cjs into a standalone NanoForge.exe.
 *
 * Steps:
 * 1. Generate SEA config (sea-config.json)
 * 2. Generate SEA blob from the launcher script
 * 3. Copy node.exe -> NanoForge.exe
 * 4. Inject SEA blob into the copied executable
 * 5. Remove signature (Windows) and re-sign if needed
 *
 * Usage: node scripts/build-exe.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

const LAUNCHER_SRC = path.join(SCRIPTS_DIR, 'nanoforge-launcher.cjs');
const SEA_CONFIG = path.join(RELEASE_DIR, 'sea-config.json');
const SEA_BLOB = path.join(RELEASE_DIR, 'nanoforge.blob');
const OUTPUT_EXE = path.join(RELEASE_DIR, 'NanoForge.exe');

function log(msg) {
  console.log(`[build-exe] ${msg}`);
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', ...opts });
  } catch (err) {
    console.error(`[build-exe] Command failed: ${cmd}`);
    throw err;
  }
}

async function buildExe() {
  console.log('===================================================');
  console.log('  NanoForge Windows Executable Builder (Node SEA)   ');
  console.log('===================================================');
  console.log(`  Node Version: ${process.version}`);
  console.log(`  Platform: ${process.platform} ${process.arch}`);
  console.log('');

  // Ensure release dir exists
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  // Verify the launcher script exists
  if (!fs.existsSync(LAUNCHER_SRC)) {
    throw new Error(`Launcher script not found: ${LAUNCHER_SRC}`);
  }
  log(`Launcher source: ${LAUNCHER_SRC} (${(fs.statSync(LAUNCHER_SRC).size / 1024).toFixed(1)} KB)`);

  // Step 1: Generate SEA config
  log('Step 1: Generating SEA configuration...');
  const seaConfig = {
    main: LAUNCHER_SRC,
    output: SEA_BLOB,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
  };
  fs.writeFileSync(SEA_CONFIG, JSON.stringify(seaConfig, null, 2), 'utf8');
  log(`Generated ${SEA_CONFIG}`);

  // Step 2: Generate SEA blob
  log('Step 2: Generating SEA preparation blob...');
  run(`node --experimental-sea-config "${SEA_CONFIG}"`);

  if (!fs.existsSync(SEA_BLOB)) {
    throw new Error(`SEA blob was not generated at ${SEA_BLOB}`);
  }
  log(`SEA blob: ${SEA_BLOB} (${(fs.statSync(SEA_BLOB).size / 1024 / 1024).toFixed(2)} MB)`);

  // Step 3: Copy node.exe -> NanoForge.exe
  log('Step 3: Copying node.exe to NanoForge.exe...');
  const nodeExePath = process.execPath;
  log(`Source node.exe: ${nodeExePath}`);

  // Remove existing output if present
  if (fs.existsSync(OUTPUT_EXE)) {
    try {
      fs.unlinkSync(OUTPUT_EXE);
    } catch {
      log('Warning: Could not delete existing NanoForge.exe, overwriting...');
    }
  }
  fs.copyFileSync(nodeExePath, OUTPUT_EXE);
  log(`Copied to ${OUTPUT_EXE} (${(fs.statSync(OUTPUT_EXE).size / 1024 / 1024).toFixed(2)} MB)`);

  // Step 4: Remove signature (Windows only, required before injection)
  log('Step 4: Removing existing signature from copied executable...');
  try {
    // signtool is typically in Windows SDK, but we can use postject directly
    // which handles unsigned binaries fine. Try removing signature if possible.
    run(`powershell -Command "try { & signtool remove /s '${OUTPUT_EXE}' } catch { Write-Host 'Signtool not available - proceeding without signature removal' }"`, { stdio: 'pipe' });
  } catch {
    log('Signature removal skipped (signtool not available — this is fine for unsigned builds)');
  }

  // Step 5: Inject SEA blob into executable
  log('Step 5: Injecting SEA blob into NanoForge.exe...');
  try {
    run(`npx --yes postject "${OUTPUT_EXE}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);
  } catch (err) {
    // If npx postject fails, try with global install
    log('Retrying postject with explicit install...');
    run(`npm install -g postject`);
    run(`postject "${OUTPUT_EXE}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);
  }

  // Verify the output
  const finalSize = fs.statSync(OUTPUT_EXE).size;
  log('');
  console.log('===================================================');
  console.log('  NanoForge.exe Built Successfully!                 ');
  console.log('===================================================');
  console.log(`  Output: ${OUTPUT_EXE}`);
  console.log(`  Size:   ${(finalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Node:   ${process.version} (${process.arch})`);
  console.log('===================================================');

  // Cleanup temp files
  try {
    fs.unlinkSync(SEA_CONFIG);
    fs.unlinkSync(SEA_BLOB);
    log('Cleaned up temp files (sea-config.json, nanoforge.blob)');
  } catch { /* ignore */ }

  return { success: true, path: OUTPUT_EXE, size: finalSize };
}

buildExe().catch((err) => {
  console.error('[build-exe] Build failed:', err.message);
  process.exit(1);
});
