// brain.js — Autonomous adaptive learning engine
// Tracks every indicator feature that fires on each signal, then auto-checks
// outcomes after signal generation to build weighted knowledge about what works.
//
// Architecture:
//   • Feature weights (0.3–2.0) — per-indicator win-rate multipliers (w/ 14-day decay)
//   • Symbol weights            — per-symbol blend, data-driven (more trades → more weight)
//   • Combo stats               — pairs of indicators that win together (pruned at 500)
//   • Confluence stats          — bonus/penalty for N-way agreement
//   • Fingerprint stats         — 3-bar candle sequence with wick flag (9-char code)
//   • Session stats             — win-rates by market session (Asia / London / NY)
//   • Confidence calibration    — outcomes bucketed by confidence tier (50-60 / 60-70 …)
//   • TP2 tracking              — distinguishes WIN (TP1) from WIN_FULL (TP2 hit)
//   • Pending checks            — timeframe-aware outcome checks scheduled after generation

class Brain {
  constructor() {
    // ── All trackable feature names (must match what generateSignal reports) ─
    this.FEATURES = [
      // EMA stack
      'ema_stack_full_bull', 'ema_stack_full_bear',
      'ema_stack_partial_bull', 'ema_stack_partial_bear',
      'ema_9_21_bull', 'ema_9_21_bear',
      'ema200_above', 'ema200_below',
      // RSI
      'rsi_oversold', 'rsi_overbought',
      'rsi_bullzone', 'rsi_bearzone',
      // MACD
      'macd_expand_bull', 'macd_expand_bear',
      'macd_pos', 'macd_neg',
      // Bollinger
      'bb_at_lower', 'bb_at_upper',
      'bb_above_mid', 'bb_below_mid',
      // Stochastic
      'stoch_oversold', 'stoch_overbought',
      // Volume
      'volume_high',
      // Key levels
      'near_support', 'near_resistance',
      // HTF alignment
      'htf_bull', 'htf_bear',
      // Reversal patterns
      'engulfing_bull', 'engulfing_bear',
      'pin_bar_bull', 'pin_bar_bear',
      'rsi_div_bull', 'rsi_div_bear',
      'double_bottom', 'double_top',
      'doji_at_bb_lower', 'doji_at_bb_upper',
      'bb_squeeze',
      // 1m momentum
      'momentum_1m_bull', 'momentum_1m_bear',
      // TJR / Smart Money Concepts
      'tjr_ob_bull', 'tjr_ob_bear',
      'tjr_fvg_bull', 'tjr_fvg_bear',
      'tjr_sweep_bull', 'tjr_sweep_bear',
      'tjr_choch_bull', 'tjr_choch_bear',
      'tjr_bos_bull', 'tjr_bos_bear',
      'tjr_discount', 'tjr_premium',
      // ICT Kill Zone
      'kill_zone',
      // VWAP
      'vwap_above', 'vwap_below',
      // Fibonacci OTE
      'fib_ote_bull', 'fib_ote_bear',
      // ICT Power of 3
      'po3_bull', 'po3_bear',
      // Crypto Funding Rate
      'funding_bull', 'funding_bear',
      // Currency Strength
      'strength_bull', 'strength_bear',
      // Aletheia institutional data
      'aletheia_short_squeeze', 'aletheia_short_crowd',
      'aletheia_insider', 'aletheia_institution', 'aletheia_high_beta',
      'aletheia_golden_cross', 'aletheia_death_cross',
      'aletheia_52wk_low', 'aletheia_52wk_high',
      'aletheia_crypto_52wk_low', 'aletheia_crypto_52wk_high',
      // Williams %R (oscillator confirmation)
      'willr_oversold', 'willr_overbought',
      // ADX — trend strength and direction
      'adx_trend_bull', 'adx_trend_bear',
      // Supertrend — dynamic trailing S/R
      'supertrend_bull', 'supertrend_bear',
      // Pivot Points — institutional daily levels
      'pivot_support', 'pivot_resistance',
      // OBV divergence — smart money volume analysis
      'obv_div_bull', 'obv_div_bear',
      // Ichimoku Cloud — macro bias + TK cross timing
      'ichimoku_cloud_bull', 'ichimoku_cloud_bear',
      'ichimoku_tk_bull', 'ichimoku_tk_bear',
      // Crypto sentiment (free APIs, no key required)
      'fear_greed_fear', 'fear_greed_greed',
      'oi_rising_bull', 'oi_rising_bear',
      'ls_ratio_bull', 'ls_ratio_bear',
    ];

    // Lazy weight-recalc flag (improvement #10)
    this._weightsDirty = false;

    const saved = this._load();
    this.state = saved || this._freshState();

    // Self-correct any missing fields from older saves
    if (!this.state.featureStats)       this.state.featureStats       = {};
    if (!this.state.comboStats)         this.state.comboStats         = {};
    if (!this.state.confluenceStats)    this.state.confluenceStats    = {};
    if (!this.state.fingerprintStats)   this.state.fingerprintStats   = {};
    if (!this.state.symbolFeatureStats) this.state.symbolFeatureStats = {};
    if (!this.state.pendingChecks)      this.state.pendingChecks      = [];
    if (!this.state.weights)            this.state.weights            = {};
    if (!this.state.symbolWeights)      this.state.symbolWeights      = {};
    if (!this.state.totalLearned)       this.state.totalLearned       = 0;
    if (!this.state.totalWins)          this.state.totalWins          = 0;
    if (!this.state.totalLosses)        this.state.totalLosses        = 0;
    // New fields (improvements #4, #5, #6)
    if (!this.state.sessionStats)       this.state.sessionStats       = {};
    if (!this.state.confidenceStats)    this.state.confidenceStats    = {};
    if (!this.state.totalWinsFull)      this.state.totalWinsFull      = 0;
  }

  _freshState() {
    return {
      weights:            {},  // feature -> learned weight multiplier
      symbolWeights:      {},  // symbol -> { feature -> weight }
      featureStats:       {},  // feature -> { wins, losses, lastTs }
      comboStats:         {},  // 'feat1:feat2' -> { wins, losses }
      confluenceStats:    {},  // String(n) -> { wins, losses }
      fingerprintStats:   {},  // '9-char-code' -> { wins, losses }
      symbolFeatureStats: {},  // symbol -> { feature -> { wins, losses, lastTs } }
      sessionStats:       {},  // session -> { wins, losses, winsFull }
      confidenceStats:    {},  // '50-60' -> { wins, losses, winsFull }
      pendingChecks:      [],  // { signal, checkAt }
      totalLearned:       0,
      totalWins:          0,
      totalLosses:        0,
      totalWinsFull:      0,   // TP2 hits
    };
  }

  // ── Feature weight getter ──────────────────────────────────────────────────
  // Improvement #10: lazy recalc — weights only recomputed when marked dirty.
  // Returns a multiplier in [0.3, 2.0]. Defaults to 1.0 when no data yet.
  getWeight(feature) {
    if (this._weightsDirty) {
      this._recalcWeights();
      this._weightsDirty = false;
    }
    const w = this.state.weights[feature];
    return (w !== undefined) ? Math.max(0.3, Math.min(2.0, w)) : 1.0;
  }

  // ── Per-symbol weight getter ───────────────────────────────────────────────
  // Improvement #1: data-driven blend — the more symbol-specific data we have,
  // the more we trust the symbol weight over the global weight.
  //   0 trades  → 100% global
  //  10 trades  → 50% global / 50% symbol
  //  30 trades  → ~25% global / 75% symbol
  //  50+ trades → ~17% global / ~83% symbol  (capped at 80% symbol)
  getSymbolWeight(symbol, feature) {
    const symStats = this.state.symbolFeatureStats?.[symbol]?.[feature];
    const glbW     = this.getWeight(feature);
    if (!symStats) return glbW;

    const symW = this.state.symbolWeights?.[symbol]?.[feature];
    if (symW === undefined) return glbW;

    const symCount = symStats.wins + symStats.losses;
    const symBlend = Math.min(0.80, symCount / (symCount + 10));
    return parseFloat((glbW * (1 - symBlend) + symW * symBlend).toFixed(3));
  }

  // ── Confluence bonus: N indicators firing together ─────────────────────────
  getConfluenceBonus(features) {
    const n   = features.length;
    const key = String(n);
    const stat = this.state.confluenceStats[key];

    if (!stat || (stat.wins + stat.losses) < 5) {
      if (n >= 8) return 14;
      if (n >= 6) return 10;
      if (n >= 4) return  6;
      if (n >= 3) return  3;
      return 0;
    }
    const wr = stat.wins / (stat.wins + stat.losses);
    return Math.round((wr - 0.5) * 50);
  }

  // ── Combo bonus: known-good pairs of indicators ────────────────────────────
  getComboBonus(features) {
    let bonus = 0;
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const key  = features[i] + ':' + features[j];
        const key2 = features[j] + ':' + features[i];
        const stat = this.state.comboStats[key] || this.state.comboStats[key2];
        if (stat && (stat.wins + stat.losses) >= 5) {
          const wr = stat.wins / (stat.wins + stat.losses);
          if (wr > 0.65)      bonus += 4;
          else if (wr > 0.55) bonus += 2;
          else if (wr < 0.35) bonus -= 3;
          else if (wr < 0.45) bonus -= 1;
        }
      }
    }
    return Math.max(-15, Math.min(20, bonus));
  }

  // ── Fingerprint bonus: 3-bar candle sequence memory ───────────────────────
  // Improvement #9: wick flag added (U/L/N) — 3 chars per candle → 9-char code.
  // Example: "RlLFsNRmU" → large bull bar w/ lower-wick, small doji, medium bull w/ upper-wick
  getFingerprintBonus(candles, atr) {
    const fp   = this._fingerprint(candles, atr);
    const stat = this.state.fingerprintStats[fp];
    let bonus  = 0;
    if (stat && (stat.wins + stat.losses) >= 3) {
      const wr = stat.wins / (stat.wins + stat.losses);
      bonus = Math.round((wr - 0.5) * 20);  // max ±10 pts
    }
    return { bonus, fp };
  }

  // ── Session bonus: optional per-session feature boost ─────────────────────
  // Returns a small pts adjustment (-8 to +8) based on session win-rate for
  // this feature. Only kicks in after 5+ session samples.
  getSessionBonus(session, features) {
    const stat = this.state.sessionStats[session];
    if (!stat || (stat.wins + stat.losses) < 5) return 0;
    const wr = stat.wins / (stat.wins + stat.losses);
    return Math.round((wr - 0.5) * 16);   // ±8 pts max
  }

  // ── Schedule an autonomous outcome check ───────────────────────────────────
  // Improvement #2: timeframe-aware delay.
  //   1m signals → 18 min  (TP1 reachable in that window)
  //   5m signals → 45 min  (TP1 usually takes 20-40 min)
  //   1H signals → 90 min  (TP1 takes hours, check at reasonable interval)
  scheduleOutcomeCheck(signal, delayMs) {
    if (!signal || !signal.features || signal.features.length === 0) return;

    // Auto-select delay from timeframe if not explicitly provided
    if (delayMs === undefined) {
      const tf = signal.timeframe || '1m';
      if      (tf === '5m') delayMs = 45 * 60 * 1000;
      else if (tf === '1H') delayMs = 90 * 60 * 1000;
      else                  delayMs = 18 * 60 * 1000;
    }

    // Tag the signal with its session at generation time so _applyOutcome can use it
    if (!signal.session) signal.session = this._detectSession(Date.now());

    const check = { signal, checkAt: Date.now() + delayMs };
    this.state.pendingChecks.push(check);
    this._save();
    setTimeout(() => this._runOutcomeCheck(check), delayMs);
    console.log(`Brain: outcome check scheduled for ${signal.symbol} ${signal.direction} [${signal.timeframe || '1m'}] in ${Math.round(delayMs / 60000)} min`);
  }

  async _runOutcomeCheck(check) {
    try {
      const { signal } = check;
      if (!signal || !signal.tp1 || !signal.sl) return;

      // Fetch recent 1m candles
      const candles = await window.marketData.getCandles(signal.symbol, '1m', 100);
      if (!candles || candles.length < 5) return;

      // Only consider candles that occurred AFTER signal generation
      const signalTime = new Date(signal.timestamp).getTime();
      const after = candles.filter(c => c.time > signalTime);
      if (after.length < 2) {
        console.log(`Brain: not enough post-signal candles for ${signal.symbol} — skipping`);
        return;
      }

      const maxHigh = Math.max(...after.map(c => c.high));
      const minLow  = Math.min(...after.map(c => c.low));

      // Improvement #5: distinguish TP2 hits (WIN_FULL) from TP1 hits (WIN)
      let result;
      if (signal.direction === 'BUY') {
        if      (minLow  <= signal.sl)  result = 'LOSS';
        else if (signal.tp2 && maxHigh >= signal.tp2) result = 'WIN_FULL';
        else if (maxHigh >= signal.tp1) result = 'WIN';
        else result = null;   // not yet resolved — skip
      } else {
        if      (maxHigh >= signal.sl)  result = 'LOSS';
        else if (signal.tp2 && minLow <= signal.tp2) result = 'WIN_FULL';
        else if (minLow  <= signal.tp1) result = 'WIN';
        else result = null;
      }

      if (result) {
        this._applyOutcome(check, result);
        const isFullWin = result === 'WIN_FULL';
        const label     = isFullWin ? 'WIN_FULL' : result;
        const msg = `Auto [${label}] ${signal.symbol} ${signal.direction} | ${(signal.features || []).length} features | conf ${signal.confidence}%`;
        console.log('Brain', msg);

        if (typeof window._brainLog === 'function') {
          window._brainLog(msg, result === 'LOSS' ? 'loss' : 'win');
        }

        // Desktop notification
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          if (isFullWin) {
            new Notification(`🏆 TP2 Hit — ${signal.symbol} ${signal.direction}`, {
              body: `Full runner — TP2 reached at ${signal.tp2?.toFixed ? signal.tp2.toFixed(4) : signal.tp2}. Outstanding!`,
              silent: false,
            });
            if (typeof window._brainLog === 'function') {
              window._brainLog(`🏆 ${signal.symbol}: TP2 hit — full move captured!`, 'win');
            }
          } else if (result === 'WIN') {
            const tp2Str = signal.tp2 ? ` → trail to TP2 ${signal.tp2.toFixed ? signal.tp2.toFixed(4) : signal.tp2}` : '';
            new Notification(`✅ TP1 Hit — ${signal.symbol} ${signal.direction}`, {
              body: `Move SL to breakeven (${signal.entry?.toFixed ? signal.entry.toFixed(4) : signal.entry})${tp2Str}`,
              silent: false,
            });
            if (typeof window._brainLog === 'function') {
              window._brainLog(`💹 ${signal.symbol}: TP1 hit — move SL to breakeven, trail toward TP2`, 'win');
            }
          } else {
            new Notification(`❌ SL Hit — ${signal.symbol} ${signal.direction}`, {
              body: `Stop loss triggered. Brain weight updated.`,
              silent: true,
            });
          }
        }
      }

      // Remove from pending regardless
      this.state.pendingChecks = this.state.pendingChecks.filter(c => c !== check);
      this._save();
    } catch (e) {
      console.warn('Brain outcome check error:', e.message);
    }
  }

  // ── Manual learning (from WIN/LOSS buttons) ────────────────────────────────
  manualOutcome(signal, result) {
    if (!signal || !result) return;
    if (!signal.session) signal.session = this._detectSession(
      signal.timestamp ? new Date(signal.timestamp).getTime() : Date.now()
    );
    const check = { signal };
    this._applyOutcome(check, result);
  }

  // ── Apply a confirmed outcome to all learned structures ───────────────────
  _applyOutcome(check, result) {
    const { signal } = check;
    const features   = signal.features || [];
    const fp         = signal.fingerprint || '?';
    const win        = result === 'WIN' || result === 'WIN_FULL';
    const winFull    = result === 'WIN_FULL';
    const n          = features.length;
    const now        = Date.now();

    // Improvement #4: session detection
    const session = signal.session || this._detectSession(
      signal.timestamp ? new Date(signal.timestamp).getTime() : now
    );

    // Improvement #6: confidence tier
    const conf = signal.confidence || 0;
    const tier = conf < 60 ? '50-60' : conf < 70 ? '60-70' : conf < 80 ? '70-80' : conf < 90 ? '80-90' : '90-100';

    // ── Feature stats (individual indicator win-rates + recency timestamp) ──
    for (const feat of features) {
      if (!this.state.featureStats[feat]) this.state.featureStats[feat] = { wins: 0, losses: 0 };
      if (win) this.state.featureStats[feat].wins++;
      else     this.state.featureStats[feat].losses++;
      this.state.featureStats[feat].lastTs = now;
    }

    // ── Per-symbol feature stats (improvement #3: add lastTs for decay) ─────
    const sym = signal.symbol;
    if (sym) {
      if (!this.state.symbolFeatureStats[sym]) this.state.symbolFeatureStats[sym] = {};
      for (const feat of features) {
        if (!this.state.symbolFeatureStats[sym][feat])
          this.state.symbolFeatureStats[sym][feat] = { wins: 0, losses: 0 };
        if (win) this.state.symbolFeatureStats[sym][feat].wins++;
        else     this.state.symbolFeatureStats[sym][feat].losses++;
        this.state.symbolFeatureStats[sym][feat].lastTs = now;  // was missing before
      }
    }

    // ── Combo stats (pairwise) ───────────────────────────────────────────────
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const key = features[i] + ':' + features[j];
        if (!this.state.comboStats[key]) this.state.comboStats[key] = { wins: 0, losses: 0 };
        if (win) this.state.comboStats[key].wins++;
        else     this.state.comboStats[key].losses++;
      }
    }

    // ── Confluence stats (N-way) ─────────────────────────────────────────────
    if (n > 0) {
      const nKey = String(n);
      if (!this.state.confluenceStats[nKey]) this.state.confluenceStats[nKey] = { wins: 0, losses: 0 };
      if (win) this.state.confluenceStats[nKey].wins++;
      else     this.state.confluenceStats[nKey].losses++;
    }

    // ── Fingerprint stats ────────────────────────────────────────────────────
    if (fp !== '?') {
      if (!this.state.fingerprintStats[fp]) this.state.fingerprintStats[fp] = { wins: 0, losses: 0 };
      if (win) this.state.fingerprintStats[fp].wins++;
      else     this.state.fingerprintStats[fp].losses++;
    }

    // ── Session stats (improvement #4) ──────────────────────────────────────
    if (!this.state.sessionStats[session]) this.state.sessionStats[session] = { wins: 0, losses: 0, winsFull: 0 };
    if (win)     this.state.sessionStats[session].wins++;
    else         this.state.sessionStats[session].losses++;
    if (winFull) this.state.sessionStats[session].winsFull = (this.state.sessionStats[session].winsFull || 0) + 1;

    // ── Confidence tier stats (improvement #6) ───────────────────────────────
    if (!this.state.confidenceStats[tier]) this.state.confidenceStats[tier] = { wins: 0, losses: 0, winsFull: 0 };
    if (win)     this.state.confidenceStats[tier].wins++;
    else         this.state.confidenceStats[tier].losses++;
    if (winFull) this.state.confidenceStats[tier].winsFull = (this.state.confidenceStats[tier].winsFull || 0) + 1;

    // ── Totals (improvement #5: track TP2 hits separately) ──────────────────
    this.state.totalLearned++;
    if (win)     this.state.totalWins++;
    else         this.state.totalLosses++;
    if (winFull) this.state.totalWinsFull = (this.state.totalWinsFull || 0) + 1;

    // Improvement #10: mark dirty instead of recalculating immediately
    this._weightsDirty = true;
    // Improvement #8: prune combo stats to prevent localStorage bloat
    this._pruneComboStats();
    this._save();
  }

  // ── Recalculate feature weights from observed win-rates ───────────────────
  // Improvement #3: symbol weights now also apply 14-day half-life time decay.
  // Half-life of 14 days — a feature with no activity for 14 days retains 50% of its edge.
  _recalcWeights() {
    const now        = Date.now();
    const halfLifeMs = 14 * 24 * 60 * 60 * 1000;

    // ── Global weights (all symbols combined) ──────────────────────────────
    for (const [feat, stat] of Object.entries(this.state.featureStats)) {
      const total = stat.wins + stat.losses;
      if (total < 3) continue;
      const wr        = stat.wins / total;
      const rawWeight = 0.3 + wr * 1.7;   // 0% WR→0.3, 50%→1.0, 100%→2.0
      const decay     = stat.lastTs ? Math.pow(0.5, (now - stat.lastTs) / halfLifeMs) : 0.5;
      const weight    = 1.0 + (rawWeight - 1.0) * Math.max(0.1, decay);
      this.state.weights[feat] = parseFloat(Math.max(0.3, Math.min(2.0, weight)).toFixed(3));
    }

    // ── Per-symbol weights (now with decay — previously missing) ───────────
    for (const [sym, featMap] of Object.entries(this.state.symbolFeatureStats)) {
      if (!this.state.symbolWeights[sym]) this.state.symbolWeights[sym] = {};
      for (const [feat, stat] of Object.entries(featMap)) {
        const total = stat.wins + stat.losses;
        if (total < 3) continue;
        const wr        = stat.wins / total;
        const rawWeight = 0.3 + wr * 1.7;
        // Apply staleness decay using symbol-specific lastTs
        const decay     = stat.lastTs ? Math.pow(0.5, (now - stat.lastTs) / halfLifeMs) : 0.5;
        const weight    = 1.0 + (rawWeight - 1.0) * Math.max(0.1, decay);
        this.state.symbolWeights[sym][feat] = parseFloat(Math.max(0.3, Math.min(2.0, weight)).toFixed(3));
      }
    }
  }

  // ── Market session detector ────────────────────────────────────────────────
  // Improvement #4: tag signals with their session so the brain can learn
  // session-specific win-rates (London vs NY vs Asia have very different dynamics).
  _detectSession(tsMs) {
    const hour = new Date(tsMs).getUTCHours();
    if (hour >= 23 || hour < 3)  return 'asia_open';    // 11pm–3am UTC
    if (hour >= 3  && hour < 7)  return 'asia_late';    // 3–7am UTC
    if (hour >= 7  && hour < 12) return 'london';       // 7–12pm UTC
    if (hour >= 12 && hour < 16) return 'london_ny';    // 12–4pm UTC (overlap — best)
    if (hour >= 16 && hour < 20) return 'ny_close';     // 4–8pm UTC
    return 'dead';                                       // 8–11pm UTC
  }

  // ── Combo stats pruning (improvement #8) ──────────────────────────────────
  // With 65+ features, O(n²) pairs can grow to 2000+ entries per signal.
  // After hitting 500 combos, evict those with the fewest total samples.
  _pruneComboStats() {
    const MAX_COMBOS = 500;
    const entries = Object.entries(this.state.comboStats);
    if (entries.length <= MAX_COMBOS) return;
    // Sort ascending by sample count; remove the least-seen ones
    entries.sort((a, b) => (a[1].wins + a[1].losses) - (b[1].wins + b[1].losses));
    const toRemove = entries.slice(0, entries.length - MAX_COMBOS);
    for (const [key] of toRemove) delete this.state.comboStats[key];
    console.log(`Brain: pruned ${toRemove.length} low-sample combo entries`);
  }

  // ── 3-bar candle fingerprint (improvement #9: wick flag added) ───────────
  // Each candle encoded as Direction + Body-size + Wick-dominant:
  //   Direction:  R = rising, F = falling
  //   Body-size:  s = small (<0.3 ATR), m = medium, l = large (>0.7 ATR)
  //   Wick-flag:  U = upper wick dominant (>1.5× lower), L = lower wick dominant, N = balanced
  // Result: 9-char code like "RlLFsNRmU"
  _fingerprint(candles, atr) {
    if (candles.length < 3 || atr <= 0) return '?';
    return candles.slice(-3).map(c => {
      const dir       = c.close >= c.open ? 'R' : 'F';
      const body      = Math.abs(c.close - c.open);
      const size      = body < atr * 0.3 ? 's' : body < atr * 0.7 ? 'm' : 'l';
      const bodyTop   = Math.max(c.open, c.close);
      const bodyBot   = Math.min(c.open, c.close);
      const upperWick = c.high - bodyTop;
      const lowerWick = bodyBot - c.low;
      const wick      = upperWick > lowerWick * 1.5 ? 'U'
                      : lowerWick > upperWick * 1.5 ? 'L' : 'N';
      return dir + size + wick;
    }).join('');
  }

  // ── Resume pending checks after app restart ────────────────────────────────
  _resumePending() {
    const now  = Date.now();
    const kept = [];
    for (const check of (this.state.pendingChecks || [])) {
      const delay = (check.checkAt || 0) - now;
      if (delay <= 0) {
        setTimeout(() => this._runOutcomeCheck(check), 2000 + Math.random() * 5000);
      } else {
        setTimeout(() => this._runOutcomeCheck(check), delay);
        kept.push(check);
      }
    }
    this.state.pendingChecks = kept;
    if (kept.length > 0) console.log(`Brain: resumed ${kept.length} pending outcome check(s)`);
  }

  // ── Stats for the Journal / Brain panel ───────────────────────────────────
  getStats() {
    const total   = this.state.totalLearned;
    const wr      = total > 0 ? ((this.state.totalWins / total) * 100).toFixed(1) : '—';
    const tp2Rate = total > 0 ? (((this.state.totalWinsFull || 0) / total) * 100).toFixed(1) : '—';

    // Top features by weight
    const featList = Object.entries(this.state.featureStats)
      .map(([feat, s]) => {
        const t = s.wins + s.losses;
        return {
          feat,
          total:  t,
          wins:   s.wins,
          losses: s.losses,
          wr:     t > 0 ? ((s.wins / t) * 100).toFixed(1) : '—',
          weight: this.getWeight(feat).toFixed(2),
        };
      })
      .filter(f => f.total >= 1)
      .sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight));

    // Top fingerprints
    const fpList = Object.entries(this.state.fingerprintStats)
      .map(([fp, s]) => {
        const t = s.wins + s.losses;
        return { fp, total: t, wr: t > 0 ? ((s.wins / t) * 100).toFixed(1) : '—' };
      })
      .filter(f => f.total >= 2)
      .sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));

    // Improvement #4: session breakdown
    const sessionList = Object.entries(this.state.sessionStats)
      .map(([session, s]) => {
        const t = s.wins + s.losses;
        return {
          session,
          total:    t,
          wins:     s.wins,
          losses:   s.losses,
          winsFull: s.winsFull || 0,
          wr:       t > 0 ? ((s.wins / t) * 100).toFixed(1) : '—',
        };
      })
      .sort((a, b) => parseFloat(b.wr || 0) - parseFloat(a.wr || 0));

    // Improvement #6: confidence calibration — are high-confidence signals
    // actually winning more than low-confidence ones?
    const confList = ['50-60', '60-70', '70-80', '80-90', '90-100'].map(tier => {
      const s = this.state.confidenceStats[tier] || { wins: 0, losses: 0, winsFull: 0 };
      const t = s.wins + s.losses;
      return {
        tier,
        total:    t,
        wins:     s.wins,
        losses:   s.losses,
        winsFull: s.winsFull || 0,
        wr:       t > 0 ? ((s.wins / t) * 100).toFixed(1) : '—',
      };
    });

    return {
      totalLearned:     total,
      totalWins:        this.state.totalWins,
      totalLosses:      this.state.totalLosses,
      totalWinsFull:    this.state.totalWinsFull || 0,
      overallWR:        wr,
      tp2Rate,
      pendingChecks:    this.state.pendingChecks.length,
      topFeatures:      featList.slice(0, 8),
      worstFeatures:    featList.slice(-5).reverse(),
      topFingerprints:  fpList.slice(0, 5),
      totalWeighted:    Object.keys(this.state.weights).length,
      sessionBreakdown: sessionList,
      confidenceCalibration: confList,
      comboCount:       Object.keys(this.state.comboStats).length,
    };
  }

  // ── Reset brain (clear all learned data) ──────────────────────────────────
  reset() {
    this.state = this._freshState();
    this._weightsDirty = false;
    this._save();
    console.log('Brain: reset complete');
  }

  // ── localStorage persistence ───────────────────────────────────────────────
  _save() {
    try {
      const toSave = { ...this.state, pendingChecks: (this.state.pendingChecks || []).slice(-20) };
      localStorage.setItem('cnax_brain_v1', JSON.stringify(toSave));
    } catch (e) {
      console.warn('Brain save failed (storage full?):', e.message);
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem('cnax_brain_v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
}

// Instantiate and resume any pending checks immediately
window.brain = new Brain();
window.brain._resumePending();
console.log(`Brain loaded — ${window.brain.state.totalLearned} outcomes learned, ${Object.keys(window.brain.state.weights).length} feature weights active`);
