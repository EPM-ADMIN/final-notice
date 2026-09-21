require('node:fs').mkdirSync(require('node:path').join(__dirname,'artifacts'),{recursive:true});
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const snake = [0,1,2,3,4,9,8,7,6,5,10,11,12,13,14,19,18,17,16,15];
const output = path.join(__dirname, 'artifacts/browser-run-test.json');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const report = { url: (process.env.GAME_URL || 'http://127.0.0.1:4173'), startedAt: new Date().toISOString(), mode: 'normal', inputCount: 0, keyboardInputs: 0, buttonClicks: 0, acceleratedSeconds: 0, transitions: [], errors };
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
  let cursor = 0, cardId = -1, spaceDown = false;
  const rendered = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = () => page.evaluate(() => window.finalNoticeSnapshot());
  async function press(key) { await page.keyboard.press(key); report.keyboardInputs++; report.inputCount++; await rendered(); }
  async function click(selector) { await page.click(selector); report.buttonClicks++; report.inputCount++; await rendered(); }
  async function quiet(value) {
    if (value === spaceDown) return;
    if (value) await page.keyboard.down('Space'); else await page.keyboard.up('Space');
    spaceDown = value; report.keyboardInputs++; report.inputCount++; await rendered();
  }
  async function advance(seconds) {
    await page.evaluate(dt => window.finalNotice.tick(dt), seconds);
    report.acceleratedSeconds += seconds;
    await rendered();
  }
  async function moveTo(index) {
    while (cursor % 5 > index % 5) { await press('ArrowLeft'); cursor--; }
    while (cursor % 5 < index % 5) { await press('ArrowRight'); cursor++; }
    while (Math.floor(cursor / 5) > Math.floor(index / 5)) { await press('ArrowUp'); cursor -= 5; }
    while (Math.floor(cursor / 5) < Math.floor(index / 5)) { await press('ArrowDown'); cursor += 5; }
  }
  try {
    await page.goto(report.url, { waitUntil: 'networkidle' });
    await click('#startBtn');
    let s = await snapshot();
    assert.equal(s.phase, 'playing');
    assert.equal(s.bill, 240);
    report.seed = await page.evaluate(() => window.finalNotice.options.seed);
    report.transitions.push({ phase: s.phase, shift: s.shift, bank: s.bank });
    for (let actions = 0; actions < 1800; actions++) {
      s = await snapshot();
      if (s.phase === 'won' || s.phase === 'lost') break;
      if (s.phase === 'upgrade') {
        await quiet(false);
        report.transitions.push({ phase: s.phase, shift: s.shift, bank: s.bank, stats: s.stats });
        const id = s.shift === 1 ? 'yield' : 'insurance';
        await click(`[data-upgrade="${id}"]`);
        s = await snapshot();
        assert.equal(s.phase, 'playing');
        assert.ok(s.upgrades.includes(id));
        report.transitions.push({ phase: s.phase, shift: s.shift, bank: s.bank, upgrade: id });
        // Normal documented keyboard interaction also re-establishes board focus.
        await press('ArrowLeft');
        cursor = 0; cardId = s.cardId;
        continue;
      }
      assert.equal(s.paused, false, 'The browser unexpectedly paused during play.');
      if (s.cardId !== cardId) { cursor = 0; cardId = s.cardId; }
      const loudest = s.lanes[0].threat > s.lanes[1].threat ? 0 : 1;
      const high = s.lanes[loudest].threat;
      if (s.lanes[s.selectedLane].threat > s.lanes[1 - s.selectedLane].threat + 15) {
        await press(s.selectedLane === 0 ? 'KeyD' : 'KeyA');
        await advance(0.3);
        continue;
      }
      if (s.bank >= s.bill && high < 70) {
        await quiet(true);
        await advance(Math.min(4, s.timeLeft));
        continue;
      }
      await quiet(false);
      if (s.pot >= 12 && high >= 70) {
        if (s.pot > 70 && high < 85) await press('KeyF');
        else await press(loudest === 0 ? 'KeyQ' : 'KeyE');
        await advance(1);
        continue;
      }
      if (s.path.length >= 20 || (s.timeLeft < 1.6 && s.pot > 0) || (s.path.length >= 8 && s.bank + s.pot >= s.bill)) {
        await press('KeyF'); await advance(1); continue;
      }
      const beforeLength = s.path.length;
      await moveTo(snake[beforeLength]);
      await press('Enter');
      const revealed = await snapshot();
      assert.equal(revealed.path.length, beforeLength + 1, `Enter did not reveal expected cell ${snake[beforeLength]}.`);
      assert.equal(revealed.path.at(-1), snake[beforeLength]);
      await advance(0.65);
    }
    await quiet(false);
    await rendered();
    s = await snapshot();
    report.final = { phase: s.phase, shift: s.shift, bank: s.bank, bill: s.bill, reason: s.reason, stats: s.stats, upgrades: s.upgrades, timeLeft: s.timeLeft };
    report.transitions.push({ phase: s.phase, shift: s.shift, bank: s.bank });
    report.endVisible = await page.locator('#endPanel').isVisible();
    report.endTitle = await page.locator('#endTitle').innerText();
    report.earnedDisplay = await page.locator('#endEarned').innerText();
    await page.screenshot({ path: path.join(__dirname, 'artifacts/browser-run-test-ending.png'), fullPage: true });
    assert.equal(s.phase, 'won', s.reason);
    assert.equal(s.stats.billsPaid, 3);
    assert.equal(report.endVisible, true);
    assert.ok(report.endTitle.includes('NOTHING'));
    assert.equal(report.earnedDisplay, '$' + s.stats.earned.toLocaleString('en-US'));
    assert.equal(errors.length, 0, 'Unexpected browser errors were observed.');
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = { message: error.message, stack: error.stack };
    try { report.failureState = await snapshot(); await page.screenshot({ path: path.join(__dirname, 'artifacts/browser-run-test-failure.png'), fullPage: true }); } catch (_) {}
    process.exitCode = 1;
  } finally {
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
  }
})();