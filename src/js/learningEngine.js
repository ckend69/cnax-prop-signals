// learningEngine.js — Adaptive learning from recorded trade outcomes
// Stores outcomes in localStorage and adjusts per-symbol confidence over time.

class LearningEngine {
  constructor() {
    this.STORAGE_KEY  = 'cnax_trade_outcomes';
    this.MAX_TRADES   = 500;          // rolling window
    this.MIN_SAMPLE   = 5;            // minimum trades before adjusting
    this.MAX_ADJ      = 12;           // max ±confidence points from learning
    this.trades       = [];
    this.adjustments  = {};           // "EURUSD-BUY" -> delta
    this._load();
  }

  // ── Load from localStorage ────────────────────────────────────────────────
  _load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.trades      = Array.isArray(parsed.trades)      ? parsed.trades      : [];
        this.adjustments = typeof parsed.adjustments === 'object' ? parsed.adjustments : {};
      }
    } catch(e) {
      this.trades = [];
      this.adjustments = {};
    }
  }

  // ── Save to localStorage ──────────────────────────────────────────────────
  _save() {
    try {
      // Keep only the last MAX_TRADES entries
      if (this.trades.length > this.MAX_TRADES) {
        this.trades = this.trades.slice(-this.MAX_TRADES);
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        trades:      this.trades,
        adjustments: this.adjustments,
      }));
    } catch(e) {
      console.warn('LearningEngine: could not save to localStorage', e.message);
    }
  }

  // ── Record a trade outcome ────────────────────────────────────────────────
  // result: 'win' | 'loss' | 'skip'
  // signal: the signal object (symbol, direction, confidence, entry, sl, tp1)
  recordOutcome(signal, result) {
    if (!signal || !result) return;
    const uid = signal.uid || signal.id;

    // Prevent duplicate recording
    if (uid && this.trades.find(t => t.uid === uid && t.result !== 'pending')) return;

    const trade = {
      uid:        uid || `${signal.symbol}-${Date.now()}`,
      symbol:     signal.symbol,
      direction:  signal.direction,
      confidence: signal.confidence,
      entry:      signal.entry,
      sl:         signal.sl,
      tp1:        signal.tp1,
      result,                              // 'win' | 'loss' | 'skip'
      ts:         Date.now(),
    };

    // Replace pending entry if exists, otherwise push
    const existIdx = this.trades.findIndex(t => t.uid === trade.uid);
    if (existIdx >= 0) {
      this.trades[existIdx] = trade;
    } else {
      this.trades.push(trade);
    }

    this._recalcAdjustments();
    this._save();
    return trade;
  }

  // ── Recalculate per-symbol-direction confidence adjustments ───────────────
  _recalcAdjustments() {
    const groups = {};
    for (const t of this.trades) {
      if (t.result === 'skip') continue;  // skips don't count
      const key = `${t.symbol}-${t.direction}`;
      if (!groups[key]) groups[key] = { wins: 0, total: 0 };
      groups[key].total++;
      if (t.result === 'win') groups[key].wins++;
    }

    this.adjustments = {};
    for (const [key, data] of Object.entries(groups)) {
      if (data.total < this.MIN_SAMPLE) continue;
      const winRate  = data.wins / data.total;           // 0-1
      // ±12 points: 0% WR → -12, 50% WR → 0, 100% WR → +12
      const raw = (winRate - 0.5) * (this.MAX_ADJ * 2);
      this.adjustments[key] = parseFloat(Math.max(-this.MAX_ADJ, Math.min(this.MAX_ADJ, raw)).toFixed(1));
    }
  }

  // ── Get confidence adjustment for a symbol-direction ─────────────────────
  getAdjustment(symbol, direction) {
    return this.adjustments[`${symbol}-${direction}`] || 0;
  }

  // ── Get outcome for a specific trade uid (for card state) ─────────────────
  getOutcome(uid) {
    const t = this.trades.find(t => t.uid === uid);
    return t ? t.result : null;
  }

  // ── Full stats for journal view ───────────────────────────────────────────
  getStats() {
    const actual = this.trades.filter(t => t.result !== 'skip');
    const wins   = actual.filter(t => t.result === 'win');
    const losses = actual.filter(t => t.result === 'loss');
    const skips  = this.trades.filter(t => t.result === 'skip');

    // Per-symbol breakdown
    const bySymbol = {};
    for (const t of actual) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { wins: 0, losses: 0 };
      if (t.result === 'win')  bySymbol[t.symbol].wins++;
      else                     bySymbol[t.symbol].losses++;
    }

    // Win rate streak
    let streak = 0;
    for (let i = actual.length - 1; i >= 0; i--) {
      if (actual[i].result === actual[actual.length - 1]?.result) streak++;
      else break;
    }

    return {
      totalTrades:  actual.length,
      wins:         wins.length,
      losses:       losses.length,
      skips:        skips.length,
      winRate:      actual.length > 0 ? (wins.length / actual.length * 100).toFixed(1) : '0.0',
      streak,
      streakType:   actual.length > 0 ? actual[actual.length - 1].result : null,
      bySymbol,
      adjustments:  this.adjustments,
      recent:       this.trades.slice(-20).reverse(),
    };
  }

  // ── Clear all history ─────────────────────────────────────────────────────
  clear() {
    this.trades = [];
    this.adjustments = {};
    this._save();
  }
}

window.learningEngine = new LearningEngine();
