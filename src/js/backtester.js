// backtester.js — Historical signal backtesting engine
// Replays historical candle data through the signal engine and tracks performance.

class Backtester {
  constructor() {
    this.results = {};  // symbol -> BacktestResult
  }

  // ── Run backtest for a single symbol ─────────────────────────────────────
  // Uses daily or hourly candles from the past N periods.
  async runBacktest(symbol, options = {}) {
    const {
      interval    = '1d',
      lookback    = 252,    // ~1 year of daily candles
      riskPct     = 1,      // risk 1% per trade
      accountSize = 50000,
    } = options;

    const candles = await window.marketData.getHistoricalCandles(symbol, interval, lookback + 50);
    if (!candles || candles.length < 60) return null;

    const trades    = [];
    const MIN_BARS  = 55;  // need at least 55 bars for indicators

    // Walk-forward: for each candle position from MIN_BARS onward,
    // run the signal engine on candles[:i] and check if the signal
    // was profitable by candle[i+1..i+10]
    let equity      = accountSize;
    let peakEquity  = accountSize;
    let maxDrawdown = 0;

    for (let i = MIN_BARS; i < candles.length - 5; i++) {
      const slice  = candles.slice(0, i + 1);
      const signal = await window.signalEngine.generateSignal(symbol, slice, null);
      if (!signal) continue;

      // Simulate trade outcome using next 5 candles
      const future   = candles.slice(i + 1, i + 6);
      const outcome  = this._simulateTrade(signal, future, interval);
      if (!outcome) continue;

      // Calculate dollar P&L
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
        outcome:    outcome.result,  // 'win' | 'loss' | 'breakeven'
        rMultiple:  outcome.rMultiple,
        pnlDollars: parseFloat(pnlDollars.toFixed(2)),
        equity:     parseFloat(equity.toFixed(2)),
        barsHeld:   outcome.barsHeld,
      });
    }

    if (trades.length === 0) return null;

    const wins      = trades.filter(t => t.outcome === 'win');
    const losses    = trades.filter(t => t.outcome === 'loss');
    const be        = trades.filter(t => t.outcome === 'breakeven');
    const winRate   = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
    const avgR      = trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length;
    const totalPnL  = equity - accountSize;
    const profitFactor = losses.length > 0
      ? wins.reduce((a, t) => a + Math.abs(t.rMultiple), 0) /
        losses.reduce((a, t) => a + Math.abs(t.rMultiple), 0)
      : wins.length > 0 ? 99 : 0;

    const result = {
      symbol,
      interval,
      totalTrades:   trades.length,
      wins:          wins.length,
      losses:        losses.length,
      breakevens:    be.length,
      winRate:       parseFloat(winRate.toFixed(1)),
      avgR:          parseFloat(avgR.toFixed(2)),
      totalPnL:      parseFloat(totalPnL.toFixed(2)),
      totalPnLPct:   parseFloat((totalPnL / accountSize * 100).toFixed(2)),
      maxDrawdown:   parseFloat(maxDrawdown.toFixed(1)),
      profitFactor:  parseFloat(profitFactor.toFixed(2)),
      finalEquity:   parseFloat(equity.toFixed(2)),
      trades:        trades.slice(-50),  // keep last 50 for display
      timestamp:     new Date(),
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

      if (isBuy) {
        // Check SL hit first (intra-bar low)
        if (c.low <= sl) {
          return { result: 'loss', rMultiple: -1.0, barsHeld: i + 1 };
        }
        // Check TP1 hit (intra-bar high)
        if (c.high >= tp1) {
          return { result: 'win', rMultiple: +2.0, barsHeld: i + 1 };
        }
      } else {
        if (c.high >= sl) {
          return { result: 'loss', rMultiple: -1.0, barsHeld: i + 1 };
        }
        if (c.low <= tp1) {
          return { result: 'win', rMultiple: +2.0, barsHeld: i + 1 };
        }
      }
    }

    // Neither SL nor TP hit in future window — count as breakeven (time exit)
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

  // ── Pattern analysis: how price reacts to indicator states ────────────────
  analyzePatterns(symbol) {
    const result = this.results[symbol];
    if (!result || result.trades.length < 10) return null;

    const trades = result.trades;

    // Group by confidence bracket
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

    // Average bars held for wins vs losses
    const wins   = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    const avgBarsWin  = wins.length > 0   ? (wins.reduce((a, t) => a + t.barsHeld, 0) / wins.length).toFixed(1) : 'N/A';
    const avgBarsLoss = losses.length > 0 ? (losses.reduce((a, t) => a + t.barsHeld, 0) / losses.length).toFixed(1) : 'N/A';

    return { confWinRates, avgBarsWin, avgBarsLoss };
  }
}

window.backtester = new Backtester();
