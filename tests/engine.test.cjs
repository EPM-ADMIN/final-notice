'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Engine = require('../src/engine.js');
const snake = [0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14, 19, 18, 17, 16, 15];
const playing = options => { const engine = new Engine({ seed: 321, ...options }); engine.start(); return engine; };

test('a seed reproduces cards; restarting resets progression', () => {
  const a = playing({ seed: 'same' });
  const b = playing({ seed: 'same' });
  assert.deepEqual(a.state.cells, b.state.cells);
  a.reveal(0); a.reveal(1); a.cashOut();
  a.restart();
  assert.equal(a.state.phase, 'menu');
  assert.deepEqual(a.state.cells, b.state.cells);
  assert.equal(a.state.bank, 0);
  assert.equal(a.state.stats.revealed, 0);
});

test('only orthogonal unrevealed squares may extend a route, without row wrap', () => {
  const game = playing();
  assert.equal(game.reveal(-1).ok, false);
  assert.equal(game.reveal(20).ok, false);
  assert.equal(game.reveal(1.1).ok, false);
  assert.equal(game.reveal(4).ok, true);
  assert.equal(game.reveal(5).ok, false);
  assert.equal(game.reveal(4).ok, false);
  assert.equal(game.reveal(8).ok, false);
  assert.deepEqual(game.legalMoves().sort((a,b)=>a-b), [3, 9]);
  assert.equal(game.reveal(9).ok, true);
  assert.deepEqual(game.state.path, [4, 9]);
});

test('multiplier, route milestones, bank, card identity, and event types stay consistent', () => {
  const game = playing();
  let earned = 0;
  let bonus = 0;
  for (const index of snake) {
    game.selectLane(index % 2);
    const result = game.reveal(index);
    assert.equal(result.ok, true);
    assert.ok(result.value > 0);
    earned += result.value + result.bonus;
    bonus += result.bonus;
  }
  assert.equal(bonus, 190);
  assert.equal(game.state.pot, earned);
  assert.equal(game.state.stats.bestCombo, 20);
  const cardId = game.state.cardId;
  assert.equal(game.cashOut().amount, earned);
  assert.equal(game.state.bank, earned);
  assert.equal(game.state.pot, 0);
  assert.equal(game.state.multiplier, 1);
  assert.equal(game.state.cardId, cardId + 1);
  assert.equal(game.cashOut().ok, false);
  assert.equal(game.state.stats.cards, 1);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === 'reveal').length, 20);
  assert.equal(events.find(event => event.type === 'reveal').symbolType, 'money');
  assert.deepEqual(game.drainEvents(), []);
});

test('decoy sacrifices the whole pending ticket and does not spend banked money', () => {
  const game = playing();
  game.state.bank = 45;
  game.state.lanes[1].threat = 80;
  game.reveal(0);
  assert.equal(game.decoy(1).ok, false);
  game.reveal(1);
  const pot = game.state.pot;
  assert.equal(game.decoy(2).ok, false);
  const result = game.decoy(1);
  assert.equal(result.ok, true);
  assert.equal(result.spent, pot);
  assert.equal(game.state.bank, 45);
  assert.equal(game.state.pot, 0);
  assert.equal(game.state.lanes[1].threat, 45);
  assert.equal(game.state.stats.decoys, 1);
});

test('quiet disables scratching and reduces pressure but cannot reverse threat', () => {
  const normal = playing();
  const quiet = playing();
  normal.state.noise = quiet.state.noise = 60;
  quiet.setQuiet(true);
  assert.equal(quiet.reveal(0).ok, false);
  normal.tick(10); quiet.tick(10);
  assert.ok(quiet.state.lanes[0].threat > 10);
  assert.ok(quiet.state.lanes[0].threat < normal.state.lanes[0].threat);
  assert.ok(quiet.state.noise < normal.state.noise);
  quiet.setQuiet(false);
  assert.equal(quiet.reveal(0).ok, true);
});

test('pause blocks actions and time; malformed time cannot corrupt state', () => {
  const game = playing();
  game.reveal(0); game.reveal(1);
  game.pause(true);
  const before = JSON.stringify(game.state);
  game.tick(50); game.tick(NaN); game.tick(Infinity); game.tick(-1);
  assert.equal(game.reveal(2).ok, false);
  assert.equal(game.cashOut().ok, false);
  assert.equal(game.decoy().ok, false);
  assert.equal(game.selectLane(1).ok, false);
  assert.equal(JSON.stringify(game.state), before);
  game.pause(false); game.tick(1);
  assert.ok(Math.abs(game.state.timeLeft - 89) < 0.00001);
});

test('a collector reaching the counter causes an immediate loss', () => {
  const game = playing();
  game.state.lanes[0].threat = 99;
  game.reveal(0);
  assert.equal(game.state.phase, 'lost');
  assert.equal(game.state.lanes[0].threat, 100);
  assert.match(game.state.reason, /Bailiff/);
  assert.equal(game.drainEvents().at(-1).cause, 'collector');
  assert.equal(game.reveal(1).ok, false);
});

test('unbanked money cannot pay bills; deadline deducts a paid bill only once', () => {
  const failed = playing();
  failed.state.bank = 170;
  failed.state.pot = 100;
  failed.setQuiet(true); failed.tick(90);
  assert.equal(failed.state.phase, 'lost');
  assert.match(failed.state.reason, /short by \$70/);
  const paid = playing();
  paid.state.bank = 260;
  paid.setQuiet(true); paid.tick(90);
  assert.equal(paid.state.phase, 'upgrade');
  assert.equal(paid.state.bank, 20);
  assert.equal(paid.state.stats.billsPaid, 1);
  paid.tick(900);
  assert.equal(paid.state.bank, 20);
  assert.deepEqual(paid.state.availableUpgrades.map(upgrade => upgrade.id), ['silent', 'yield', 'lure']);
});

test('three paid shifts and two valid upgrades reach the final win', () => {
  const game = playing();
  assert.equal(game.chooseUpgrade('yield').ok, false);
  game.state.bank = 2360;
  game.setQuiet(true); game.tick(90);
  assert.equal(game.chooseUpgrade('insurance').ok, false);
  assert.equal(game.chooseUpgrade('yield').ok, true);
  assert.equal(game.state.shift, 2);
  assert.equal(game.state.bill, 700);
  assert.equal(game.state.duration, 90);
  assert.equal(game.chooseUpgrade('lure').ok, false);
  game.setQuiet(true); game.tick(90);
  assert.deepEqual(game.state.availableUpgrades.map(upgrade => upgrade.id), ['capacitor', 'overtime', 'insurance']);
  assert.equal(game.chooseUpgrade('overtime').ok, true);
  assert.equal(game.state.duration, 110);
  game.setQuiet(true); game.tick(110);
  assert.equal(game.state.phase, 'won');
  assert.equal(game.state.bank, 20);
  assert.equal(game.state.stats.billsPaid, 3);
  assert.equal(game.state.upgrades.length, 2);
});

test('upgrade effects alter their corresponding action', () => {
  const normal = playing();
  const better = playing();
  better.state.upgrades = ['yield', 'silent', 'lure', 'capacitor'];
  const base = normal.reveal(0);
  const improved = better.reveal(0);
  assert.ok(improved.value > base.value);
  assert.ok(better.state.lanes[0].threat < normal.state.lanes[0].threat);
  assert.ok(better.state.noise < normal.state.noise);
  normal.reveal(1); better.reveal(1);
  assert.equal(normal.state.multiplier, 1.25);
  assert.equal(better.state.multiplier, 1.5);
  better.state.lanes[1].threat = 80;
  better.decoy(1);
  assert.equal(better.state.lanes[1].threat, 30);
});

test('relaxed shifts are longer with slower threats; tick partitioning agrees', () => {
  const normal = playing();
  const relaxed = playing({ mode: 'relaxed' });
  assert.equal(relaxed.state.duration, 120);
  normal.tick(10); relaxed.tick(10);
  assert.ok(relaxed.state.lanes[0].threat < normal.state.lanes[0].threat);
  const a = playing(); const b = playing();
  a.state.noise = b.state.noise = 60;
  a.tick(10);
  for (let i = 0; i < 100; i++) b.tick(0.1);
  assert.ok(Math.abs(a.state.lanes[0].threat - b.state.lanes[0].threat) < 0.00001);
  assert.ok(Math.abs(a.state.timeLeft - b.state.timeLeft) < 0.00001);
});

function simulate(seed, { mode = 'normal', naive = false, combo = 12, limit = 65 } = {}) {
  const game = playing({ seed, mode });
  let actions = 0;
  while (['playing', 'upgrade'].includes(game.state.phase) && actions++ < 1500) {
    const s = game.state;
    if (s.phase === 'upgrade') {
      game.chooseUpgrade(s.shift === 1 ? 'yield' : 'insurance');
      continue;
    }
    const loudest = s.lanes[0].threat > s.lanes[1].threat ? 0 : 1;
    const high = s.lanes[loudest].threat;
    // Human-paced decisions. Switch only when the difference is visible, with a reaction delay.
    if (s.lanes[s.selectedLane].threat > s.lanes[1 - s.selectedLane].threat + 15) {
      game.selectLane(1 - s.selectedLane); game.tick(0.3);
      if (s.phase !== 'playing') continue;
    }
    if (s.bank >= s.bill && high < limit) {
      game.setQuiet(true); game.tick(1); continue;
    }
    game.setQuiet(false);
    if (!naive && s.pot >= 12 && high >= limit) {
      // Bank valuable tickets while there is still time, then scratch a cheap decoy.
      if (s.pot > 70 && high < 85) game.cashOut();
      else game.decoy(loudest);
      game.tick(1); continue;
    }
    if (s.path.length >= combo || (s.timeLeft < 1.6 && s.pot > 0)) {
      game.cashOut(); game.tick(1); continue;
    }
    if (s.path.length >= 8 && s.bank + s.pot >= s.bill) {
      game.cashOut(); game.tick(1); continue;
    }
    const result = game.reveal(snake[s.path.length]);
    if (!result.ok) throw new Error(result.message);
    game.tick(0.65);
  }
  return { seed, mode, phase: game.state.phase, earned: game.state.stats.earned, decoys: game.state.stats.decoys, cards: game.state.stats.cards, revealed: game.state.stats.revealed, reason: game.state.reason };
}

test('meeting the current bill early does not skip the survival portion', () => {
  const game = playing();
  game.state.bank = 10000;
  game.tick(1);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.shift, 1);
});

test('normal difficulty is winnable with observable decisions but still rewards route mastery', () => {
  const cautious = Array.from({ length: 100 }, (_, i) => simulate(i + 1));
  const expert = Array.from({ length: 100 }, (_, i) => simulate(i + 1, { combo: 20, limit: 70 }));
  const cautiousWins = cautious.filter(run => run.phase === 'won').length;
  const expertWins = expert.filter(run => run.phase === 'won').length;
  assert.ok(cautiousWins >= 75 && cautiousWins <= 95, `Cautious strategy won ${cautiousWins}/100 seeds.`);
  assert.ok(expertWins >= cautiousWins, 'Long routes should reward successful risk management.');
  const average = (runs, key) => Math.round(runs.reduce((sum, run) => sum + run[key], 0)) / runs.length;
  console.log('Balance sample:', JSON.stringify({ seeds: 100, cautiousWins, expertWins, expertAverageCards: average(expert, 'cards'), expertAverageDecoys: average(expert, 'decoys'), expertAverageEarned: average(expert, 'earned') }));
});

test('ignoring decoys is not a winning strategy; relaxed mode offers meaningful breathing room', () => {
  const naive = Array.from({ length: 25 }, (_, i) => simulate(i + 1, { combo: 20, limit: 70, naive: true }));
  assert.equal(naive.filter(run => run.phase === 'won').length, 0);
  const relaxed = Array.from({ length: 25 }, (_, i) => simulate(i + 1, { mode: 'relaxed' }));
  assert.ok(relaxed.filter(run => run.phase === 'won').length >= 24);
});
test('a delayed scratch from a previous card cannot reveal the new ticket', () => {
  const game = playing();
  const oldCard = game.state.cardId;
  game.reveal(0, oldCard); game.cashOut();
  assert.equal(game.reveal(1, oldCard).ok, false);
  assert.equal(game.state.path.length, 0);
  assert.equal(game.reveal(1, game.state.cardId).ok, true);
});