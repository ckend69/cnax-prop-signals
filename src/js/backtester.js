// backtester.js — Historical signal backtesting engine
// Replays historical candle data through the signal engine and tracks performance.
// Supports both 1m (live candles, forward-walk) and 1h (historical candles) modes.

class Backtester {
  constructor() {
    this.results = {};  // symbol -> BacktestResult
  }

  // ── Run backtest for a single symbol ─────────────────────────────────────
  // Default: 1m bars (matches live signal engine).
  // 1h mode available for longer historical perspective.
  async runBacktest(symbol, options = {}) {
    const {
      interval    = '1m',    // 1m matches the live signal engine
      lookback    = 300,     // bars for warm-up window
      riskPct     = 1,
      accountSize = 50000,
    } = options;

    // Route to 1m-specific path
    if (interval === '1m') {
      return this._runBacktest1m(symbol, { riskPct, accountSize });
    }

    // 1h historical path — request extra bars for warm-up
    const candles = await window.marketData.getHistoricalCandles(symbol, interval, lookback + 60);
    if (!candles || candles.length < 60) return null;

    const trades    = [];
    const MIN_BARS  = 55;   // minimum bars needed for indicator warm-up
    // Forward window: how many bars ahead to check for SL/TP
    const FORWARD   = interval === '1d' ? 15 : 30;

    let equity      = accountSize;
    let peakEquity  = accountSize;
    let maxDrawdown = 0;

    for (let i = MIN_BARS; i < candles.length - FORWARD; i++) {
      const slice  = candles.slice(0, i + 1);
      const signal = await window.signalEngine.generateSignal(symbol, slice, null, { skipLiveFetch: true });
      if (!signal) continue;

      // Simulate trade outcome on the next FORWARD candles
      const future  = candles.slice(i + 1, i + 1 + FORWARD);
      const outcome = this._simulateTrade(signal, future, interval);
      if (!outcome) continue;

      // Dollar P&L
      const riskDollars = equity * (riskPct / 100);
      const pnlDollars  = riskDollars * outcome.rMultiple;
      equity           += pnlDollars;
      peakEquity        = Math.max(peakEquity, equity);
      const dd          = (peakEquity - equity) / peakEquity * 100;
      maxDrawdown       = Math.max(maxDrawdown, dd);

      trades.push({
        index:      i,
        time:       candles[i].time,
        direction:  signal.direction,
        confidence: signal.confidence,
        entry:      signal.entry,
        sl:         signal.sl,
        tp1:        signal.tp1,
        outcome:    outcome.result,
        rMultiple:  outcome.rMultiple,
        pnlDollars: parseFloat(pnlDollars.toFixed(2)),
        equity:     parseFloat(equity.toFixed(2)),
        barsHeld:   outcome.barsHeld,
      });
    }

    if (trades.length === 0) return null;
    return this._buildResult(symbol, interval, trades, equity, accountSize, maxDrawdown);
  }

  // ── 1m backtest: forward-walk through the live 1m candle window ───────────
  // Fetches the current 300-bar 1m window and walks through it bar-by-bar,
  // generating signals at each step and simulating outcomes 20 bars ahead.
  // This gives a quick sanity-check of how the current engine performs on real data.
  async _runBacktest1m(symbol, { riskPct = 1, accountSize = 50000 } = {}) {
    const candles1m = await window.marketData.getCandles(symbol, '1m', 300);
    if (!candles1m || candles1m.length < 60) return null;

    const trades    = [];
    const MIN_BARS  = 55;   // minimum bars for warm-up
    const FORWARD   = 20;   // 20 × 1m bars to check for SL/TP

    let equity      = accountSize;
    let peakEquity  = accountSize;
    let maxDrawdown = 0;

    for (let i = MIN_BARS; i < candles1m.length - FORWARD; i++) {
      const slice   = candles1m.slice(0, i + 1);
      const ctx5m   = window.marketData._aggregate1mto5m(slice, 60);
      const signal  = await window.signalEngine.generateSignal(
        symbol, slice, ctx5m, { timeframe: '1m', skipLiveFetch: true }
      );
      if (!signal || signal.refreshed) continue;

      const future  = candles1m.slice(i + 1, i + 1 + FORWARD);
      const outcome = this._simulateTrade(signal, future, '1m');
      if (!outcome) continue;

      const riskDollars = equity * (riskPct / 100);
      const pnlDollars  = riskDollars * outcome.rMultiple;
      equity           += pnlDollars;
      peakEquity        = Math.max(peakEquity, equity);
      const dd          = (peakEquity - equity) / peakEquity * 100;
      maxDrawdown       = Math.max(maxDrawdown, dd);

      trades.push({
        index:      i,
        time:       candles1m[i].time,
        direction:  signal.direction,
        confidence: signal.confidence,
        entry:      signal.entry,
        sl:         signal.sl,
        tp1:        signal.tp1,
        outcome:    outcome.result,
        rMultiple:  outcome.rMultiple,
        pnlDollars: parseFloat(pnlDollars.toFixed(2)),
        equity:     parseFloat(equity.toFixed(2)),
        barsHeld:   outcome.barsHeld,
      });
    }

    if (trades.length === 0) return null;
    return this._buildResult(symbol, '1m', trades, equity, accountSize, maxDrawdown);
  }

  // ── Build result summary from trade list ──────────────────────────────────
  _buildResult(symbol, interval, trades, equity, accountSize, maxDrawdown) {
    const wins    = trades.filter(t => t.outcome === 'win');
    const losses  = trades.filter(t => t.outcome === 'loss');
    const be      = trades.filter(t => t.outcome === 'breakeven');
    const winRate = (wins.length / trades.length) * 100;
    const avgR    = trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length;
    const totalPnL = equity - accountSize;

    const profitFactor = losses.length > 0
      ? wins.reduce((a, t) => a + Math.abs(t.rMultiple), 0) /
        losses.reduce((a, t) => a + Math.abs(t.rMultiple), 0)
      : wins.length > 0 ? 99 : 0;

    // Fix #8: Additional stats — expectancy, streaks, recovery factor
    const avgWinR  = wins.length   > 0 ? wins.reduce((a, t)   => a + t.rMultiple, 0) / wins.length   : 0;
    const avgLossR = losses.length > 0 ? losses.reduce((a, t) => a + Math.abs(t.rMultiple), 0) / losses.length : 1;
    const wr01     = winRate / 100;
    const expectancy = parseFloat(((wr01 * avgWinR) - ((1 - wr01) * avgLossR)).toFixed(3));

    let maxConsecWins = 0, maxConsecLosses = 0, streak = 0, lastOutcome = null;
    for (const t of trades) {
      if (t.outcome === lastOutcome && t.outcome !== 'breakeven') {
        streak++;
      } else {
        streak = 1;
        lastOutcome = t.outcome;
      }
      if (lastOutcome === 'win')  maxConsecWins   = Math.max(maxConsecWins, streak);
      if (lastOutcome === 'loss') maxConsecLosses = Math.max(maxConsecLosses, streak);
    }

    const recoveryFactor = maxDrawdown > 0
      ? parseFloat(((totalPnL / accountSize * 100) / maxDrawdown).toFixed(2))
      : 0;

    const result = {
      symbol,
      interval,
      totalTrades:     trades.length,
      wins:            wins.length,
      losses:          losses.length,
      breakevens:      be.length,
      winRate:         parseFloat(winRate.toFixed(1)),
      avgR:            parseFloat(avgR.toFixed(2)),
      totalPnL:        parseFloat(totalPnL.toFixed(2)),
      totalPnLPct:     parseFloat((totalPnL / accountSize * 100).toFixed(2)),
      maxDrawdown:     parseFloat(maxDrawdown.toFixed(1)),
      profitFactor:    parseFloat(profitFactor.toFixed(2)),
      expectancy,
      maxConsecWins,
      maxConsecLosses,
      recoveryFactor,
      finalEquity:     parseFloat(equity.toFixed(2)),
      trades:          trades.slice(-50),
      timestamp:       new Date(),
    };
    this.results[symbol] = result;
    return result;
  }

  // ── Simulate trade outcome on future candles ──────────────────────────────
  _simulateTrade(signal, futureCandles, interval) {
    if (!futureCandles || futureCandles.length === 0) return null;

    const isBuy = signal.direction === 'BUY';
    const entry = signal.entry;
    const sl    = signal.sl;
    const tp1   = signal.tp1;

    for (let i = 0; i < futureCandles.length; i++) {
      const c = futureCandles[i];

      const slHit = isBuy ? c.low  <= sl  : c.high >= sl;
      const tpHit = isBuy ? c.high >= tp1 : c.low  <= tp1;

      if (slHit && tpHit) {
        // Both SL and TP touched on the same bar — determine which hit first
        // by comparing their distance from the bar's open price.
        // Whichever is closer to the open was reached first.
        const distToSL = Math.abs(c.open - sl);
        const distToTP = Math.abs(c.open - tp1);
        return distToTP <= distToSL
          ? { result: 'win',  rMultiple: +2.0, barsHeld: i + 1 }
          : { result: 'loss', rMultiple: -1.0, barsHeld: i + 1 };
      }

      if (slHit) return { result: 'loss', rMultiple: -1.0, barsHeld: i + 1 };
      if (tpHit) return { result: 'win',  rMultiple: +2.0, barsHeld: i + 1 };
    }

    // Neither SL nor TP hit within the forward window — time exit at last close
    const lastClose = futureCandles[futureCandles.length - 1].close;
    const slDist    = Math.abs(entry - sl);
    const pnl       = isBuy ? (lastClose - entry) : (entry - lastClose);
    const rMult     = slDist > 0 ? pnl / slDist : 0;
    const result    = rMult > 0.3 ? 'win' : rMult < -0.3 ? 'loss' : 'breakeven';
    return { result, rMultiple: parseFloat(rMult.toFixed(2)), barsHeld: futureCandles.length };
  }

  // ── Run backtest for all tracked symbols ─────────────────────────────────
  async runAll(symbols, options = {}) {
    const results = [];
    for (const sym of symbols) {
      try {
        const r = await this.runBacktest(sym, options);
        if (r) results.push(r);
      } catch(e) {
        console.warn(`Backtest failed for ${sym}:`, e.message);
      }
    }
    return results.sort((a, b) => b.winRate - a.winRate);
  }

  // ── Pattern analysis: win rate by confidence bracket ─────────────────────
  analyzePatterns(symbol) {
    const result = this.results[symbol];
    if (!result || result.trades.length < 10) return null;

    const trades = result.trades;
    const byConf = {};
    for (const t of trades) {
      const bracket = Math.floor(t.confidence / 10) * 10;
      if (!byConf[bracket]) byConf[bracket] = { wins: 0, total: 0 };
      byConf[bracket].total++;
      if (t.outcome === 'win') byConf[bracket].wins++;
    }

    const confWinRates = Object.entries(byConf).map(([conf, data]) => ({
      confidence: parseInt(conf),
      winRate: data.total > 0 ? (data.wins / data.total * 100).toFixed(1) : '0',
      trades: data.total,
    })).sort((a, b) => a.confidence - b.confidence);

    const wins   = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    const avgBarsWin  = wins.length   > 0 ? (wins.reduce((a, t)   => a + t.barsHeld, 0) / wins.length).toFixed(1)   : 'N/A';
    const avgBarsLoss = losses.length > 0 ? (losses.reduce((a, t) => a + t.barsHeld, 0) / losses.length).toFixed(1) : 'N/A';

    return { confWinRates, avgBarsWin, avgBarsLoss };
  }
}

window.backtester = new Backtester();
