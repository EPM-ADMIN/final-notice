'use strict';
const { app, BrowserWindow, Menu, protocol, screen, session } = require('electron');
const { mkdirSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const GAME_URL = 'finalnotice://game/index.html';
const testMode = process.env.FINAL_NOTICE_DESKTOP_TEST === '1';
const profile = testMode && process.env.FINAL_NOTICE_TEST_USER_DATA
  ? path.resolve(process.env.FINAL_NOTICE_TEST_USER_DATA)
  : path.join(app.getPath('appData'), 'FinalNotice');
mkdirSync(profile, { recursive: true });
app.setName('Final Notice');
app.setPath('userData', profile);
app.setAppUserModelId('media.endlesspixel.finalnotice');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'finalnotice', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);

let window = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }
  });

  app.whenReady().then(async () => {
    const html = await fs.readFile(path.join(app.getAppPath(), 'dist', 'index.html'));
    protocol.handle('finalnotice', request => {
      if (request.method !== 'GET' || request.url !== GAME_URL) return new Response('', { status: 404 });
      return new Response(html, { headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff'
      } });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url === GAME_URL || details.url.startsWith('data:') || details.url.startsWith('blob:');
      callback({ cancel: !allowed });
    });
    session.defaultSession.on('will-download', event => event.preventDefault());
    Menu.setApplicationMenu(null);
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    window = new BrowserWindow({
      title: 'Final Notice',
      width: Math.min(1280, width), height: Math.min(900, height),
      minWidth: Math.min(720, width), minHeight: Math.min(600, height),
      backgroundColor: '#0c0f0d', autoHideMenuBar: true, show: false,
      webPreferences: {
        nodeIntegration: false, nodeIntegrationInWorker: false,
        contextIsolation: true, sandbox: true, webSecurity: true,
        webviewTag: false, allowRunningInsecureContent: false,
        spellcheck: false, devTools: testMode,
        backgroundThrottling: !testMode
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-frame-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F11') {
        event.preventDefault();
        if (input.type === 'keyDown' && !input.isAutoRepeat) window.setFullScreen(!window.isFullScreen());
      }
    });
    window.on('closed', () => { window = null; });
    window.once('ready-to-show', () => { if (!testMode) { window.show(); window.focus(); } });
    await window.loadURL(GAME_URL);
  }).catch(error => {
    console.error('Final Notice could not start:', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}