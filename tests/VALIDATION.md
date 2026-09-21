# v0.1.0 validation

- 15 engine checks passed, including routes, decoys, payment failure, collector failure, pause, upgrades, three-shift completion, and deterministic state.
- 18 browser checks passed in Edge, covering mouse rubbing, keyboard, touch, banking, decoys, pause, both failures, restart, standalone file loading, and 1440x900 / 1366x768 / 390x844 layouts.
- Final versioned HTML completed a legal three-shift browser run: 319 UI inputs, 143 revealed seals, 15 decoys, all three bills paid, $2,383 earned, $43 surplus, and zero browser errors. Only the clock was accelerated.
- Portable Windows EXE passed controls, Escape, native F11, isolated sandboxed renderer, denied external navigation/popups, and real high-score persistence after close/reopen.
- All 76 Windows package manifest entries matched; packaged HTML and launcher matched current source.
- Balance simulation across 100 seeds: cautious policy won 89%, expert policy won 100%; a cash-only policy lost the sampled runs. These are automated policies, not human playtest results.

This is the first playable prototype. Human feedback is still needed to tune difficulty, pacing, and replay appeal.
