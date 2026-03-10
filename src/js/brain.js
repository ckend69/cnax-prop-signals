// brain.js — Autonomous adaptive learning engine
// Tracks every indicator feature that fires on each signal, then auto-checks
// outcomes ~18 minutes later to build weighted knowledge about what actually works.
//
// Architecture:
//   • Feature weights (0.3–2.0) — per-indicator win-rate multipliers
//   • Combo stats — pairs of indicators that win together
//   • Confluence stats — bonus/penalty for N-way agreement
//   • Fingerprint stats — 3-bar candle sequence pattern memory
//   • Pending checks — signals re-fetched 18 min after generation for auto-learning

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
    ];

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
  }

  _freshState() {
    return {
      weights:            {},  // feature -> learned weight multiplier
      symbolWeights:      {},  // symbol -> { feature -> weight }
      featureStats:       {},  // feature -> { wins, losses, lastTs }
      comboStats:         {},  // 'feat1:feat2' -> { wins, losses }
      confluenceStats:    {},  // String(n) -> { wins, losses }
      fingerprintStats:   {},  // '3bar-code' -> { wins, losses }
      symbolFeatureStats: {},  // symbol -> { feature -> { wins, losses } }
      pendingChecks:      [],  // { signal, checkAt }
      totalLearned:       0,
      totalWins:          0,
      totalLosses:        0,
    };
  }

  // ── Feature weight getter ──────────────────────────────────────────────────
  // Returns a multiplier in [0.3, 2.0] based on observed win-rate.
  // Defaults to 1.0 (neutral) when not enough data exists.
  getWeight(feature) {
    const w = this.state.weights[feature];
    return (w !== undefined) ? Math.max(0.3, Math.min(2.0, w)) : 1.0;
  }

  // ── Confluence bonus: N indicators firing together ─────────────────────────
  // Returns bonus points based on how many features are aligned.
  // Brain-learned adjustments kick in after 5+ samples; default fallback used earlier.
  getConfluenceBonus(features) {
    const n   = features.length;
    const key = String(n);
    const stat = this.state.confluenceStats[key];

    if (!stat || (stat.wins + stat.losses) < 5) {
      // Default heuristic: reward multi-indicator confluence
      if (n >= 8) return 14;
      if (n >= 6) return 10;
      if (n >= 4) return  6;
      if (n >= 3) return  3;
      return 0;
    }
    const wr = stat.wins / (stat.wins + stat.losses);
    // 70% WR → +15 pts, 50% WR → 0 pts, 30% WR → -10 pts
    return Math.round((wr - 0.5) * 50);
  }

  // ── Combo bonus: known-good pairs of indicators ────────────────────────────
  // Checks every pairwise combo and sums learned bonuses.
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
  // Encodes the last 3 candles as e.g. "RlFsRm" (rising-large, falling-small…)
  // Returns { bonus: pts, fp: 'code' }
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

  // ── Schedule an autonomous outcome check ───────────────────────────────────
  // Called immediately after a signal is generated.
  // Re-fetches 1m data 18 minutes later and auto-determines WIN/LOSS.
  scheduleOutcomeCheck(signal, delayMs = 18 * 60 * 1000) {
    if (!signal || !signal.features || signal.features.length === 0) return;
    const check = { signal, checkAt: Date.now() + delayMs };
    this.state.pendingChecks.push(check);
    this._save();
    setTimeout(() => this._runOutcomeCheck(check), delayMs);
    console.log(`Brain: outcome check scheduled for ${signal.symbol} ${signal.direction} in ${Math.round(delayMs/60000)} min`);
  }

  async _runOutcomeCheck(check) {
    try {
      const { signal } = check;
      if (!signal || !signal.tp1 || !signal.sl) return;

      // Fetch recent 1m candles
      const candles = await window.marketData.getCandles(signal.symbol, '1m', 30);
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

      let result;
      if (signal.direction === 'BUY') {
        if      (minLow  <= signal.sl)  result = 'LOSS';
        else if (maxHigh >= signal.tp1) result = 'WIN';
        else result = null;   // TP/SL not yet hit — skip (too early)
      } else {
        if      (maxHigh >= signal.sl)  result = 'LOSS';
        else if (minLow  <= signal.tp1) result = 'WIN';
        else result = null;
      }

      if (result) {
        this._applyOutcome(check, result);
        const msg = `Auto [${result}] ${signal.symbol} ${signal.direction} | ${(signal.features||[]).length} features | weight adj pending`;
        console.log('Brain', msg);
        // Push to UI activity log if available
        if (typeof window._brainLog === 'function') {
          window._brainLog(msg, result === 'WIN' ? 'win' : 'loss');
        }
        // Desktop notification with trailing stop guidance on WIN
        if (result === 'WIN' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const tp2Str = signal.tp2 ? ` → trail to TP2 ${signal.tp2.toFixed ? signal.tp2.toFixed(4) : signal.tp2}` : '';
          new Notification(`✅ TP1 Hit — ${signal.symbol} ${signal.direction}`, {
            body: `Move SL to breakeven (${signal.entry?.toFixed ? signal.entry.toFixed(4) : signal.entry})${tp2Str}`,
            silent: false,
          });
          if (typeof window._brainLog === 'function') {
            window._brainLog(`💹 ${signal.symbol}: TP1 hit — move SL to breakeven, trail toward TP2`, 'win');
          }
        }
        if (result === 'LOSS' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`❌ SL Hit — ${signal.symbol} ${signal.direction}`, {
            body: `Stop loss triggered. Brain weight updated.`,
            silent: true,
          });
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
    const check = { signal };
    this._applyOutcome(check, result);
  }

  // ── Apply a confirmed outcome to all learned structures ───────────────────
  _applyOutcome(check, result) {
    const { signal } = check;
    const features   = signal.features || [];
    const fp         = signal.fingerprint || '?';
    const win        = result === 'WIN';
    const n          = features.length;

    const now = Date.now();

    // Feature stats (individual indicator win-rates) + recency timestamp
    for (const feat of features) {
      if (!this.state.featureStats[feat]) this.state.featureStats[feat] = { wins: 0, losses: 0 };
      if (win) this.state.featureStats[feat].wins++;
      else     this.state.featureStats[feat].losses++;
      this.state.featureStats[feat].lastTs = now;  // track recency for decay
    }

    // Per-symbol feature stats (symbol-specific learning)
    const sym = signal.symbol;
    if (sym) {
      if (!this.state.symbolFeatureStats[sym]) this.state.symbolFeatureStats[sym] = {};
      for (const feat of features) {
        if (!this.state.symbolFeatureStats[sym][feat])
          this.state.symbolFeatureStats[sym][feat] = { wins: 0, losses: 0 };
        if (win) this.state.symbolFeatureStats[sym][feat].wins++;
        else     this.state.symbolFeatureStats[sym][feat].losses++;
      }
    }

    // Combo stats (pairwise)
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const key = features[i] + ':' + features[j];
        if (!this.state.comboStats[key]) this.state.comboStats[key] = { wins: 0, losses: 0 };
        if (win) this.state.comboStats[key].wins++;
        else     this.state.comboStats[key].losses++;
      }
    }

    // Confluence stats (N-way)
    if (n > 0) {
      const nKey = String(n);
      if (!this.state.confluenceStats[nKey]) this.state.confluenceStats[nKey] = { wins: 0, losses: 0 };
      if (win) this.state.confluenceStats[nKey].wins++;
      else     this.state.confluenceStats[nKey].losses++;
    }

    // Fingerprint stats
    if (fp !== '?') {
      if (!this.state.fingerprintStats[fp]) this.state.fingerprintStats[fp] = { wins: 0, losses: 0 };
      if (win) this.state.fingerprintStats[fp].wins++;
      else     this.state.fingerprintStats[fp].losses++;
    }

    // Totals
    this.state.totalLearned++;
    if (win) this.state.totalWins++;
    else     this.state.totalLosses++;

    // Recalculate all weights from updated stats
    this._recalcWeights();
    this._save();
  }

  // ── Recalculate feature weights from observed win-rates ───────────────────
  // Uses time-decay: weights fade back towards neutral (1.0) if no recent outcomes.
  // Half-life of 14 days — a feature with no activity for 14 days retains 50% of its learned edge.
  _recalcWeights() {
    const now         = Date.now();
    const halfLifeMs  = 14 * 24 * 60 * 60 * 1000;  // 14-day half-life

    // Global weights (all symbols combined)
    for (const [feat, stat] of Object.entries(this.state.featureStats)) {
      const total = stat.wins + stat.losses;
      if (total < 3) continue;

      const wr        = stat.wins / total;
      const rawWeight = 0.3 + wr * 1.7;   // 0% WR→0.3, 50%→1.0, 100%→2.0

      // Staleness decay: blend rawWeight toward neutral (1.0) based on how stale the data is
      const decay  = stat.lastTs ? Math.pow(0.5, (now - stat.lastTs) / halfLifeMs) : 0.5;
      const weight = 1.0 + (rawWeight - 1.0) * Math.max(0.1, decay);

      this.state.weights[feat] = parseFloat(Math.max(0.3, Math.min(2.0, weight)).toFixed(3));
    }

    // Per-symbol weights
    for (const [sym, featMap] of Object.entries(this.state.symbolFeatureStats)) {
      if (!this.state.symbolWeights[sym]) this.state.symbolWeights[sym] = {};
      for (const [feat, stat] of Object.entries(featMap)) {
        const total = stat.wins + stat.losses;
        if (total < 3) continue;
        const wr     = stat.wins / total;
        const weight = 0.3 + wr * 1.7;
        this.state.symbolWeights[sym][feat] = parseFloat(Math.max(0.3, Math.min(2.0, weight)).toFixed(3));
      }
    }
  }

  // ── Per-symbol weight getter ───────────────────────────────────────────────
  // Returns a blend of global weight (70%) and symbol-specific weight (30%).
  // Falls back to global weight alone if not enough symbol-specific data.
  getSymbolWeight(symbol, feature) {
    const symW = this.state.symbolWeights?.[symbol]?.[feature];
    const glbW = this.getWeight(feature);
    if (symW === undefined) return glbW;
    // Blend: 70% global + 30% symbol-specific for robustness
    return parseFloat((glbW * 0.7 + symW * 0.3).toFixed(3));
  }

  // ── 3-bar candle fingerprint ───────────────────────────────────────────────
  // Encodes each of the last 3 candles as Direction + Body-size:
  //   R = rising (close ≥ open), F = falling
  //   s = small body (< 0.3 ATR), m = medium, l = large (> 0.7 ATR)
  // Example: "RlFsRm" → large bullish bar, small bearish bar, medium bullish bar
  _fingerprint(candles, atr) {
    if (candles.length < 3 || atr <= 0) return '?';
    return candles.slice(-3).map(c => {
      const dir  = c.close >= c.open ? 'R' : 'F';
      const body = Math.abs(c.close - c.open);
      const size = body < atr * 0.3 ? 's' : body < atr * 0.7 ? 'm' : 'l';
      return dir + size;
    }).join('');
  }

  // ── Resume pending checks after app restart ────────────────────────────────
  _resumePending() {
    const now = Date.now();
    const kept = [];
    for (const check of (this.state.pendingChecks || [])) {
      const delay = (check.checkAt || 0) - now;
      if (delay <= 0) {
        // Overdue — run immediately (with slight stagger to avoid API hammering)
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

    // Top features by weight
    const featList = Object.entries(this.state.featureStats)
      .map(([feat, s]) => {
        const t  = s.wins + s.losses;
        return {
          feat,
          total: t,
          wins:  s.wins,
          losses: s.losses,
          wr:    t > 0 ? ((s.wins / t) * 100).toFixed(1) : '—',
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

    return {
      totalLearned:   total,
      totalWins:      this.state.totalWins,
      totalLosses:    this.state.totalLosses,
      overallWR:      wr,
      pendingChecks:  this.state.pendingChecks.length,
      topFeatures:    featList.slice(0, 8),
      worstFeatures:  featList.slice(-5).reverse(),
      topFingerprints: fpList.slice(0, 5),
      totalWeighted:  Object.keys(this.state.weights).length,
    };
  }

  // ── Reset brain (clear all learned data) ──────────────────────────────────
  reset() {
    this.state = this._freshState();
    this._save();
    console.log('Brain: reset complete');
  }

  // ── localStorage persistence ───────────────────────────────────────────────
  _save() {
    try {
      // Keep pendingChecks lean (strip full candle arrays if present)
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
