'use strict';
// Build a portable Windows x64 release with a pinned, verified Electron runtime.
// Optional: ELECTRON_ARCHIVE=/path/to/runtime.zip, OUTPUT_DIR=/path/to/releases.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_VERSION = '44.2.0';
const RUNTIME_NAME = `electron-v${RUNTIME_VERSION}-win32-x64.zip`;
const RUNTIME_SHA256 = '4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da';
const RUNTIME_URL = `https://github.com/electron/electron/releases/download/v${RUNTIME_VERSION}/${RUNTIME_NAME}`;
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const quotePS = value => "'" + String(value).replace(/'/g, "''") + "'";
function powershell(code) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + code], { stdio: 'inherit', windowsHide: true });
}
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const target = path.join(directory, item.name);
    return item.isDirectory() ? filesBelow(target) : [target];
  }).sort((a, b) => a.localeCompare(b, 'en'));
}
function removeOwnStaging(directory) {
  const resolved = path.resolve(directory);
  const parent = path.resolve(RUNTIME_DIR);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('package-windows-')) {
    throw new Error('Refusing to remove a path outside this build staging area.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
async function runtimeArchive() {
  const archive = process.env.ELECTRON_ARCHIVE
    ? path.resolve(process.env.ELECTRON_ARCHIVE)
    : path.join(RUNTIME_DIR, RUNTIME_NAME);
  if (!fs.existsSync(archive)) {
    if (process.env.ELECTRON_ARCHIVE) throw new Error('ELECTRON_ARCHIVE does not exist.');
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const temporary = archive + `.download-${process.pid}`;
    console.log(`Downloading the official Electron ${RUNTIME_VERSION} Windows runtime...`);
    const response = await fetch(RUNTIME_URL);
    if (!response.ok || !response.body) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    try {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: 'wx' }));
      if (await sha256(temporary) !== RUNTIME_SHA256) throw new Error('Downloaded runtime SHA-256 did not match the pinned official archive.');
      fs.renameSync(temporary, archive);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  const actual = await sha256(archive);
  if (actual !== RUNTIME_SHA256) throw new Error(`Runtime SHA-256 mismatch. Expected ${RUNTIME_SHA256}, received ${actual}.`);
  console.log(`Verified Electron runtime: ${actual}`);
  return archive;
}

(async () => {
  if (process.platform !== 'win32') throw new Error('This portable packager uses Windows PowerShell. Run it on Windows x64.');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(meta.version)) throw new Error('package.json needs a valid release version.');
  const html = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(html)) throw new Error('dist/index.html is missing. Run npm run build first.');
  const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(ROOT, 'artifacts'));
  const name = `Final-Notice-${meta.version}-Windows-x64`;
  const finalDir = path.join(outputDir, name);
  const zip = path.join(outputDir, `${name}.zip`);
  if (fs.existsSync(finalDir) || fs.existsSync(zip)) throw new Error(`${name} already exists. Choose a different OUTPUT_DIR or remove that previous build explicitly.`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const archive = await runtimeArchive();
  const staging = path.join(RUNTIME_DIR, `package-windows-${process.pid}-${Date.now()}`);
  const runtime = path.join(staging, name);
  fs.mkdirSync(staging, { recursive: true });
  try {
    console.log('Extracting the verified runtime...');
    powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quotePS(archive)}, ${quotePS(runtime)})`);
    fs.renameSync(path.join(runtime, 'electron.exe'), path.join(runtime, 'Final Notice.exe'));
    const defaultApp = path.join(runtime, 'resources', 'default_app.asar');
    if (fs.existsSync(defaultApp)) fs.unlinkSync(defaultApp);
    const appDir = path.join(runtime, 'resources', 'app');
    fs.mkdirSync(path.join(appDir, 'desktop'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'desktop', 'main.cjs'), path.join(appDir, 'desktop', 'main.cjs'));
    fs.copyFileSync(html, path.join(appDir, 'dist', 'index.html'));
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'final-notice', productName: 'Final Notice', version: meta.version, private: true, main: 'desktop/main.cjs', description: 'An original scratch-and-survive horror game.' }, null, 2) + '\n');
    const license = path.join(ROOT, 'LICENSE');
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(runtime, 'GAME-LICENSE.txt'));
    fs.writeFileSync(path.join(runtime, 'START HERE.txt'), [
      `FINAL NOTICE ${meta.version} — WINDOWS x64`, '',
      'Extract the entire ZIP, then open Final Notice.exe.',
      'Keep the executable alongside the supplied files and folders.',
      'No installation, account, or internet connection is required.', '',
      'F11 toggles fullscreen. Escape pauses the game.',
      'High scores are saved in %APPDATA%\\FinalNotice and survive app updates.',
      'Update by extracting a newer release into a new folder.', '',
      'This independent portable build is unsigned. Windows may show an unknown-publisher prompt.',
      `Electron runtime ${RUNTIME_VERSION}. Third-party notices are included.`, ''
    ].join('\r\n'));
    const fileManifest = [];
    for (const file of filesBelow(runtime)) fileManifest.push(`${await sha256(file)}  ${path.relative(runtime, file).split(path.sep).join('/')}`);
    fs.writeFileSync(path.join(runtime, 'SHA256SUMS.txt'), fileManifest.join('\n') + '\n');
    fs.renameSync(runtime, finalDir);
    console.log('Creating portable release ZIP...');
    powershell(`Compress-Archive -LiteralPath ${quotePS(finalDir)} -DestinationPath ${quotePS(zip)} -CompressionLevel Optimal`);
    const zipHash = await sha256(zip);
    fs.writeFileSync(path.join(outputDir, `${name}.sha256.txt`), `${zipHash}  ${path.basename(zip)}\n`);
    console.log(JSON.stringify({ version: meta.version, directory: finalDir, zip, zipBytes: fs.statSync(zip).size, sha256: zipHash, runtimeSha256: RUNTIME_SHA256 }, null, 2));
  } finally { removeOwnStaging(staging); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });