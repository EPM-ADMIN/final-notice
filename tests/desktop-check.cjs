require('node:fs').mkdirSync(require('node:path').join(__dirname,'artifacts'),{recursive:true});
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const executable = process.env.FINAL_NOTICE_EXE || path.join(root, 'artifacts', 'Final-Notice-'+require('../package.json').version+'-Windows-x64', 'Final Notice.exe');
const profile = path.join(__dirname, `artifacts/desktop-qa-profile-${Date.now()}`);
const reportPath = path.join(__dirname, 'artifacts/desktop-check.json');
const report = { startedAt: new Date().toISOString(), executable, profile, errors: [], checks: [] };
let application;
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function launch() {
  application = await _electron.launch({
    executablePath: executable,
    env: { ...process.env, FINAL_NOTICE_DESKTOP_TEST: '1', FINAL_NOTICE_TEST_USER_DATA: profile },
    timeout: 45000
  });
  const page = await application.firstWindow();
  page.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
  await page.waitForFunction(() => typeof window.finalNoticeSnapshot === 'function');
  await render(page);
  return page;
}
async function eventually(check, message) {
  for (let i = 0; i < 30; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}
(async () => {
  try {
    let page = await launch();
    assert.match(await page.title(), /FINAL NOTICE/i);
    assert.equal(page.url(), 'finalnotice://game/index.html');
    const prefs = await application.evaluate(({ BrowserWindow, app }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const prefs = window.webContents.getLastWebPreferences();
      return { nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, webSecurity: prefs.webSecurity, webviewTag: prefs.webviewTag, fullscreen: window.isFullScreen(), size: window.getSize(), userData: app.getPath('userData') };
    });
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.webSecurity, true);
    assert.equal(prefs.webviewTag, false);
    assert.equal(prefs.fullscreen, false);
    assert.equal(path.resolve(prefs.userData), path.resolve(profile));
    assert.deepEqual(await page.evaluate(() => ({ require: typeof require, process: typeof process })), { require: 'undefined', process: 'undefined' });
    report.security = prefs;
    report.checks.push('Sandboxed isolated renderer, stable custom origin, windowed startup, isolated QA profile.');
    await page.click('#startBtn');
    await render(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    let state = await page.evaluate(() => window.finalNoticeSnapshot());
    assert.deepEqual(state.path, [0, 1]);
    assert.equal(state.pot, 20);
    await page.keyboard.press('KeyF');
    await render(page);
    state = await page.evaluate(() => window.finalNoticeSnapshot());
    assert.equal(state.bank, 20);
    assert.equal(state.stats.cards, 1);
    report.checks.push('Real Enter/arrow/F keyboard inputs revealed two connected cells and banked $20.');
    await page.keyboard.press('Escape');
    await render(page);
    assert.equal((await page.evaluate(() => window.finalNoticeSnapshot())).paused, true);
    await page.keyboard.press('Escape');
    await render(page);
    assert.equal((await page.evaluate(() => window.finalNoticeSnapshot())).paused, false);
    report.checks.push('Escape pauses and resumes.');
    // CDP keyboard input bypasses Electron's before-input-event; use its native input route.
    await application.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents; contents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' }); });
    await eventually(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), 'F11 did not enter fullscreen.');
    // CDP keyboard input bypasses Electron's before-input-event; use its native input route.
    await application.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents; contents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' }); });
    await eventually(async () => !await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), 'F11 did not leave fullscreen.');
    report.checks.push('F11 enters and exits fullscreen.');
    // Fullscreen changes can blur the hidden test window; honor the game's automatic pause.
    if ((await page.evaluate(() => window.finalNoticeSnapshot())).paused) { await page.keyboard.press('Escape'); await render(page); }
    // Exercise the game's real end-of-run save path, without fabricating earnings or threat.
    await page.evaluate(() => window.finalNotice.tick(window.finalNotice.state.timeLeft));
    await page.waitForSelector('#endPanel:not(.hidden)');
    await render(page);
    state = await page.evaluate(() => window.finalNoticeSnapshot());
    assert.equal(state.phase, 'lost');
    assert.equal(state.stats.earned, 20);
    const beforeClose = await page.evaluate(() => JSON.parse(localStorage.getItem('final-notice-v1')));
    assert.equal(beforeClose.bestEarned, 20);
    report.savedBeforeClose = beforeClose;
    await page.screenshot({ path: path.join(__dirname, 'desktop-ending.png') });
    await application.close(); application = null;
    page = await launch();
    const reopened = await page.evaluate(() => JSON.parse(localStorage.getItem('final-notice-v1')));
    assert.deepEqual(reopened, beforeClose);
    assert.match(await page.locator('#best').innerText(), /\$20/);
    report.savedAfterReopen = reopened;
    report.checks.push('The actual game high score survives closing and reopening the packaged EXE.');
    await page.screenshot({ path: path.join(__dirname, 'desktop-reopened.png') });
    const opened = await page.evaluate(() => window.open('https://example.com/') === null);
    assert.equal(opened, true);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    await page.evaluate(() => { window.location.href = 'https://example.com/'; });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(page.url(), 'finalnotice://game/index.html');
    report.checks.push('Popups and external navigation are denied.');
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = { message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    if (application) await application.close().catch(() => {});
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();