(function (root, factory) {
  const Engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = Engine;
  if (root) root.FinalNoticeEngine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BILLS = [240, 700, 1400];
  const UPGRADE_CATALOG = {
    silent: { id: 'silent', name: 'Velvet glove', description: 'Scratching creates 30% less threat and noise.', icon: 'hand' },
    yield: { id: 'yield', name: 'Loaded ink', description: 'Every scratched symbol pays 25% more.', icon: 'coin' },
    lure: { id: 'lure', name: 'False address', description: 'Decoys push a collector back 50 points instead of 35.', icon: 'arrow' },
    capacitor: { id: 'capacitor', name: 'Lucky filament', description: 'Spark symbols add ×0.5 instead of ×0.25.', icon: 'spark' },
    overtime: { id: 'overtime', name: 'Borrowed minute', description: 'The final shift lasts 20 seconds longer.', icon: 'clock' },
    insurance: { id: 'insurance', name: 'Door chain', description: 'Both collectors start the final shift 12 points farther away.', icon: 'shield' }
  };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const rounded = n => Math.round(n * 100) / 100;

  class Engine {
    constructor(options = {}) {
      this.options = { seed: options.seed == null ? Date.now() : options.seed, mode: options.mode === 'relaxed' ? 'relaxed' : 'normal' };
      this.restart();
    }

    _seed(seed) {
      const str = String(seed);
      let value = 2166136261;
      for (let i = 0; i < str.length; i++) value = Math.imul(value ^ str.charCodeAt(i), 16777619);
      this._rng = value >>> 0 || 1;
    }

    _random() {
      let t = this._rng += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    _event(type, message, extra = {}) { this._events.push({ ...extra, type, message }); }
    _fail(message) { return { ok: false, message }; }
    _active() { return this.state.phase === 'playing' && !this.state.paused; }
    _has(id) { return this.state.upgrades.includes(id); }

    restart() {
      this._seed(this.options.seed);
      this._events = [];
      this.state = {
        phase: 'menu', mode: this.options.mode, paused: false,
        shift: 1, bill: BILLS[0], bills: BILLS.slice(), timeLeft: 0, duration: 0,
        bank: 0, pot: 0, multiplier: 1, cells: [], path: [],
        lanes: [{ name: 'The Bailiff', threat: 10 }, { name: 'The Auditor', threat: 6 }],
        selectedLane: 0, quiet: false, noise: 0,
        stats: { earned: 0, cards: 0, decoys: 0, bestCombo: 0, revealed: 0, billsPaid: 0 },
        upgrades: [], availableUpgrades: [], reason: '', lastPayout: 0, cardId: 0,
        totalTime: 0
      };
      this._newCard();
      return { ok: true };
    }

    start() {
      if (this.state.phase !== 'menu') return this._fail('This shift has already started.');
      this.state.phase = 'playing';
      this._beginShift();
      this._event('start', 'Shift one. Pay $' + this.state.bill + ' before the bell.');
      return { ok: true };
    }

    _beginShift() {
      const s = this.state;
      s.duration = (s.mode === 'relaxed' ? 120 : 90) + (s.shift === 3 && this._has('overtime') ? 20 : 0);
      s.timeLeft = s.duration;
      s.bill = BILLS[s.shift - 1];
      s.paused = false;
      s.quiet = false;
      s.noise = 0;
      s.reason = '';
      const startingThreat = s.shift === 1 ? 10 : 14 + (s.shift - 2) * 4;
      s.lanes[0].threat = Math.max(0, startingThreat - (this._has('insurance') ? 12 : 0));
      s.lanes[1].threat = Math.max(0, startingThreat - 4 - (this._has('insurance') ? 12 : 0));
      s.availableUpgrades = [];
      if (s.shift > 1) this._newCard();
    }

    _newCard() {
      const s = this.state;
      s.cells = Array.from({ length: 20 }, () => {
        const roll = this._random();
        const type = roll < 0.65 ? 'money' : roll < 0.82 ? 'spark' : roll < 0.92 ? 'eye' : 'ward';
        return { type, value: 6 + Math.floor(this._random() * 9), revealed: false };
      });
      // A readable first card teaches the special symbols without a punishing opening.
      if (s.cardId === 0) {
        s.cells[0] = { type: 'money', value: 10, revealed: false };
        s.cells[1] = { type: 'spark', value: 8, revealed: false };
        s.cells[2] = { type: 'money', value: 12, revealed: false };
        s.cells[3] = { type: 'ward', value: 9, revealed: false };
        s.cells[4] = { type: 'money', value: 10, revealed: false };
      }
      s.path = [];
      s.pot = 0;
      s.multiplier = 1;
      s.cardId++;
    }

    legalMoves() {
      if (!this._active() || this.state.quiet) return [];
      const s = this.state;
      if (!s.path.length) return s.cells.map((_, index) => index);
      const last = s.path[s.path.length - 1];
      return s.cells.map((cell, index) => !cell.revealed && this._adjacent(last, index) ? index : -1).filter(index => index >= 0);
    }

    _adjacent(a, b) { return Math.abs(a % 5 - b % 5) + Math.abs(Math.floor(a / 5) - Math.floor(b / 5)) === 1; }

    reveal(index, expectedCardId = this.state.cardId) {
      const s = this.state;
      if (!this._active()) return this._fail(s.paused ? 'The game is paused.' : 'Start a shift to scratch a ticket.');
      if (s.quiet) return this._fail('Release HUSH to scratch again.');
      if (expectedCardId !== s.cardId) return this._fail('That ticket has already left the counter.');
      if (!Number.isInteger(index) || index < 0 || index >= 20) return this._fail('Choose a square on the ticket.');
      const cell = s.cells[index];
      if (cell.revealed) return this._fail('That square has already been scratched.');
      if (s.path.length && !this._adjacent(s.path[s.path.length - 1], index)) return this._fail('Continue from the last square: up, down, left or right.');
      cell.revealed = true;
      s.path.push(index);
      const protection = (this._has('silent') ? 0.7 : 1) * (s.mode === 'relaxed' ? 0.75 : 1);
      if (cell.type === 'spark') s.multiplier = rounded(s.multiplier + (this._has('capacitor') ? 0.5 : 0.25));
      const value = Math.round(cell.value * s.multiplier * (this._has('yield') ? 1.25 : 1));
      let bonus = 0;
      if (s.path.length === 8) bonus = 20;
      if (s.path.length === 12) bonus = 30;
      if (s.path.length === 16) bonus = 40;
      if (s.path.length === 20) bonus = 100;
      s.pot += value + bonus;
      s.noise = clamp(s.noise + (cell.type === 'eye' ? 12 : cell.type === 'ward' ? 2 : 5) * protection, 0, 100);
      s.lanes[s.selectedLane].threat += (cell.type === 'eye' ? 5 : 2.8) * protection;
      if (cell.type === 'ward') s.lanes[s.selectedLane].threat = Math.max(0, s.lanes[s.selectedLane].threat - 9);
      s.stats.revealed++;
      s.stats.bestCombo = Math.max(s.stats.bestCombo, s.path.length);
      const message = bonus ? (s.path.length === 20 ? `BLACKOUT! +$${bonus} jackpot.` : `${s.path.length}-link route! +$${bonus}.`) : cell.type === 'spark' ? `Spark! Multiplier ×${s.multiplier}.` : cell.type === 'eye' ? 'Marked ink. It heard that.' : cell.type === 'ward' ? 'A ward pushes the collector back.' : `+$${value} on the ticket.`;
      const result = { ok: true, type: cell.type, value, bonus, message, index, combo: s.path.length, cardId: s.cardId };
      this._event('reveal', message, { ...result, symbolType: cell.type });
      this._checkThreat();
      return result;
    }

    cashOut() {
      const s = this.state;
      if (!this._active()) return this._fail(s.paused ? 'The game is paused.' : 'There is no active shift.');
      if (!s.path.length || s.pot <= 0) return this._fail('Scratch a route before you bank it.');
      const amount = s.pot;
      s.bank += amount;
      s.stats.earned += amount;
      s.stats.cards++;
      s.lastPayout = amount;
      const threat = Math.min(14, 3 + amount * 0.035) * (s.mode === 'relaxed' ? 0.75 : 1);
      s.lanes[s.selectedLane].threat += threat;
      s.noise = clamp(s.noise + 8, 0, 100);
      this._newCard();
      const message = `$${amount} banked. The counter bell draws attention.`;
      this._event('cashout', message, { amount, lane: s.selectedLane });
      this._checkThreat();
      return { ok: true, amount, value: amount, message };
    }

    decoy(lane = this.state.selectedLane) {
      const s = this.state;
      if (!this._active()) return this._fail(s.paused ? 'The game is paused.' : 'There is no active shift.');
      if (!Number.isInteger(lane) || lane < 0 || lane > 1) return this._fail('Choose a collector.');
      if (s.pot < 12) return this._fail('A decoy needs at least $12 on the ticket.');
      const spent = s.pot;
      const retreat = this._has('lure') ? 50 : 35;
      s.lanes[lane].threat = Math.max(0, s.lanes[lane].threat - retreat);
      s.noise = Math.max(0, s.noise - 18);
      s.stats.decoys++;
      this._newCard();
      const message = `$${spent} sacrificed. ${s.lanes[lane].name} follows your false trail.`;
      this._event('decoy', message, { spent, retreat, lane });
      return { ok: true, spent, retreat, lane, message };
    }

    selectLane(index) {
      if (!Number.isInteger(index) || index < 0 || index > 1) return this._fail('Choose a collector.');
      if (!this._active()) return this._fail('There is no active shift.');
      this.state.selectedLane = index;
      return { ok: true, lane: index };
    }

    setQuiet(value) {
      if (!this._active()) return this._fail('There is no active shift.');
      this.state.quiet = Boolean(value);
      return { ok: true, quiet: this.state.quiet };
    }

    pause(value = true) {
      if (this.state.phase !== 'playing') return this._fail('There is no active shift.');
      this.state.paused = Boolean(value);
      if (this.state.paused) this.state.quiet = false;
      return { ok: true, paused: this.state.paused };
    }

    tick(dt) {
      if (!this._active() || !Number.isFinite(dt) || dt <= 0) return;
      const s = this.state;
      // Small steps make a large tick agree with many animation frames and preserve event order.
      let remaining = Math.min(dt, s.timeLeft);
      while (remaining > 1e-8 && s.phase === 'playing') {
        const step = Math.min(remaining, 0.1);
        const noiseBefore = s.noise;
        s.noise = Math.max(0, s.noise - step * (s.quiet ? 10 : 4));
        const meanNoise = (noiseBefore + s.noise) / 2;
        const modeScale = s.mode === 'relaxed' ? 0.65 : 1;
        const grace = s.duration - s.timeLeft < 8 ? 0.3 : 1;
        const base = (0.45 + 0.2 * (s.shift - 1)) * (s.quiet ? 0.7 : 1) * grace;
        s.lanes.forEach(lane => { lane.threat += step * modeScale * (base + meanNoise * (s.quiet ? 0.002 : 0.009)); });
        s.timeLeft = Math.max(0, s.timeLeft - step);
        s.totalTime += step;
        remaining -= step;
        this._checkThreat();
      }
      if (s.phase === 'playing' && s.timeLeft < 1e-7) { s.timeLeft = 0; this._endShift(); }
    }

    _checkThreat() {
      const s = this.state;
      if (s.phase !== 'playing') return;
      const caught = s.lanes.find(lane => lane.threat >= 100);
      if (caught) {
        caught.threat = 100;
        this._lose(`${caught.name} reached the counter. Watch both doors and sacrifice a ticket before a collector reaches 100%.`, 'collector');
      }
    }

    _lose(reason, cause) {
      this.state.phase = 'lost';
      this.state.reason = reason;
      this.state.quiet = false;
      this.state.paused = false;
      this._event('lost', reason, { cause });
    }

    _endShift() {
      const s = this.state;
      if (s.bank < s.bill) {
        this._lose(`The bell rang with $${s.bank} banked. Your $${s.bill} bill was short by $${s.bill - s.bank}. Unbanked ticket money does not count.`, 'bill');
        return;
      }
      const paid = s.bill;
      s.bank -= paid;
      s.stats.billsPaid++;
      s.quiet = false;
      s.pot = 0;
      if (s.shift === 3) {
        s.phase = 'won';
        s.reason = `All three notices paid. You walk out with $${s.bank}.`;
        this._event('won', s.reason, { paid, remaining: s.bank });
      } else {
        s.phase = 'upgrade';
        s.availableUpgrades = (s.shift === 1 ? ['silent', 'yield', 'lure'] : ['capacitor', 'overtime', 'insurance']).map(id => ({ ...UPGRADE_CATALOG[id] }));
        this._event('shiftEnd', `$${paid} bill paid. Choose one keepsake for the next shift.`, { paid, nextShift: s.shift + 1 });
      }
    }

    chooseUpgrade(id) {
      const s = this.state;
      if (s.phase !== 'upgrade') return this._fail('No upgrade is available right now.');
      if (!s.availableUpgrades.some(upgrade => upgrade.id === id)) return this._fail('Choose one of the three offered upgrades.');
      s.upgrades.push(id);
      s.shift++;
      s.phase = 'playing';
      this._beginShift();
      this._event('upgrade', `${UPGRADE_CATALOG[id].name} equipped. Shift ${s.shift}: pay $${s.bill}.`, { id, shift: s.shift });
      return { ok: true, upgrade: { ...UPGRADE_CATALOG[id] } };
    }

    drainEvents() { const events = this._events; this._events = []; return events; }
  }

  Engine.UPGRADES = UPGRADE_CATALOG;
  Engine.BILLS = BILLS.slice();
  return Engine;
});
