// signals.js — Technical analysis engine, signal generator, and risk manager

class TechnicalAnalysis {

  // ── Exponential Moving Average ─────────────────────────────────────────────
  static ema(closes, period) {
    if (closes.length < period) return [];
    const k      = 2 / (period + 1);
    const result = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < closes.length; i++) {
      result.push(closes[i] * k + result[result.length - 1] * (1 - k));
    }
    return result;
  }

  // ── Simple Moving Average ──────────────────────────────────────────────────
  static sma(closes, period) {
    return closes.map((_, i) => {
      if (i < period - 1) return null;
      return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    }).filter(v => v !== null);
  }

  // ── RSI (Wilder smoothing) ─────────────────────────────────────────────────
  static rsi(closes, period = 14) {
    if (closes.length <= period) return 50;
    const changes = closes.slice(1).map((c, i) => c - closes[i]);
    let avgGain   = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    let avgLoss   = Math.abs(changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;

    for (let i = period; i < changes.length; i++) {
      const gain = changes[i] > 0 ? changes[i] : 0;
      const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
      avgGain    = (avgGain * (period - 1) + gain) / period;
      avgLoss    = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  // ── MACD ──────────────────────────────────────────────────────────────────
  static macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast    = this.ema(closes, fast);
    const emaSlow    = this.ema(closes, slow);
    if (!emaFast.length || !emaSlow.length) return { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false };
    const offset     = emaFast.length - emaSlow.length;
    const macdLine   = emaSlow.map((v, i) => emaFast[i + offset] - v);
    const signalLine = this.ema(macdLine, signal);
    if (!signalLine.length) return { macd: macdLine[macdLine.length-1] || 0, signal: 0, histogram: 0, bullish: false, bearish: false };
    const sigOffset  = macdLine.length - signalLine.length;
    const histogram  = signalLine.map((v, i) => macdLine[i + sigOffset] - v);
    const lastHist   = histogram[histogram.length - 1] || 0;
    const prevHist   = histogram[histogram.length - 2] || 0;

    return {
      macd:      macdLine[macdLine.length - 1] || 0,
      signal:    signalLine[signalLine.length - 1] || 0,
      histogram: lastHist,
      bullish:   lastHist > 0 && lastHist > prevHist,
      bearish:   lastHist < 0 && lastHist < prevHist,
    };
  }

  // ── ATR (Average True Range) ───────────────────────────────────────────────
  static atr(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trs = candles.slice(1).map((c, i) => {
      const prev = candles[i];
      return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    });
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  // ── Bollinger Bands ────────────────────────────────────────────────────────
  static bollinger(closes, period = 20, stdDev = 2) {
    if (closes.length < period) return null;
    const slice    = closes.slice(-period);
    const mid      = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
    const std      = Math.sqrt(variance);
    return { upper: mid + stdDev * std, mid, lower: mid - stdDev * std, std };
  }

  // ── Stochastic %K (fast) ──────────────────────────────────────────────────
  static stochastic(candles, period = 14) {
    if (candles.length < period) return 50;
    const slice   = candles.slice(-period);
    const highMax = Math.max(...slice.map(c => c.high));
    const lowMin  = Math.min(...slice.map(c => c.low));
    const last    = candles[candles.length - 1].close;
    if (highMax === lowMin) return 50;
    return ((last - lowMin) / (highMax - lowMin)) * 100;
  }

  // ── Volume signal ─────────────────────────────────────────────────────────
  static volumeSignal(candles, period = 20) {
    if (candles.length < period + 1) return 'normal';
    const avgVol  = candles.slice(-period - 1, -1).reduce((a, b) => a + b.volume, 0) / period;
    const lastVol = candles[candles.length - 1].volume;
    if (avgVol === 0) return 'normal';
    if (lastVol > avgVol * 1.5) return 'high';
    if (lastVol < avgVol * 0.5) return 'low';
    return 'normal';
  }

  // ── Support & Resistance (swing pivot detection) ───────────────────────────
  // Uses 5-bar pivot logic instead of simple top-N sort to find real levels.
  static keyLevels(candles, lookback = 60) {
    const slice      = candles.slice(-lookback);
    const swingHighs = [];
    const swingLows  = [];

    for (let i = 2; i < slice.length - 2; i++) {
      const c = slice[i];
      if (c.high > slice[i-1].high && c.high > slice[i-2].high &&
          c.high > slice[i+1].high && c.high > slice[i+2].high) {
        swingHighs.push(c.high);
      }
      if (c.low < slice[i-1].low && c.low < slice[i-2].low &&
          c.low < slice[i+1].low && c.low < slice[i+2].low) {
        swingLows.push(c.low);
      }
    }

    // Use most recent swing level, fall back to period extreme
    const highs = slice.map(c => c.high);
    const lows  = slice.map(c => c.low);
    return {
      resistance: swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : Math.max(...highs),
      support:    swingLows.length  > 0 ? swingLows[swingLows.length - 1]   : Math.min(...lows),
      swingHighs,
      swingLows,
    };
  }

  // ── ATR volatility regime (high/normal/low relative to 20-bar ATR average) ─
  static volatilityRegime(candles) {
    if (candles.length < 35) return 'normal';
    const current = this.atr(candles, 14);
    const prev    = this.atr(candles.slice(0, -14), 14);
    if (prev === 0) return 'normal';
    const ratio = current / prev;
    if (ratio > 1.3) return 'high';
    if (ratio < 0.7) return 'low';
    return 'normal';
  }

  // ── 4H macro trend direction (simplified EMA stack on 4H) ─────────────────
  static macroTrend(candles4H) {
    if (!candles4H || candles4H.length < 30) return null;
    const closes = candles4H.map(c => c.close);
    const ema9   = this.ema(closes, 9);
    const ema21  = this.ema(closes, 21);
    if (!ema9.length || !ema21.length) return null;
    const e9  = ema9[ema9.length - 1];
    const e21 = ema21[ema21.length - 1];
    const cur = closes[closes.length - 1];
    if (cur > e9 && e9 > e21) return 'bullish';
    if (cur < e9 && e9 < e21) return 'bearish';
    return 'neutral';
  }
}

// ── Signal Generator ──────────────────────────────────────────────────────────
class SignalEngine {
  constructor() {
    this.lastSignals = {};  // symbol -> { direction, ts }
    // Max possible indicator score — used for absolute confidence scaling.
    // EMA(30) + 200EMA(5) + RSI(20) + MACD(20) + BB(10) + Stoch(5) + Volume(10)
    // + Levels(5) + 4H alignment(8) = 113 pts max
    this.MAX_SCORE = 113;
  }

  async generateSignal(symbol, candles, candles4H = null) {
    if (!candles || candles.length < 50) return null;

    const closes  = candles.map(c => c.close);
    const current = closes[closes.length - 1];

    // ── Compute indicators ─────────────────────────────────────────────────
    const ema9     = TechnicalAnalysis.ema(closes, 9);
    const ema21    = TechnicalAnalysis.ema(closes, 21);
    const ema50    = TechnicalAnalysis.ema(closes, 50);
    const ema200   = TechnicalAnalysis.ema(closes, 200);
    const rsi      = TechnicalAnalysis.rsi(closes, 14);
    const macdData = TechnicalAnalysis.macd(closes);
    const atr      = TechnicalAnalysis.atr(candles, 14);
    const bb       = TechnicalAnalysis.bollinger(closes, 20);
    const stoch    = TechnicalAnalysis.stochastic(candles, 14);
    const vol      = TechnicalAnalysis.volumeSignal(candles);
    const levels   = TechnicalAnalysis.keyLevels(candles);
    const volReg   = TechnicalAnalysis.volatilityRegime(candles);
    const trend4H  = TechnicalAnalysis.macroTrend(candles4H);

    const e9   = ema9.length  > 0 ? ema9[ema9.length - 1]   : current;
    const e21  = ema21.length > 0 ? ema21[ema21.length - 1]  : current;
    const e50  = ema50.length > 0 ? ema50[ema50.length - 1]  : current;
    const e200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;

    // ── Scoring system ─────────────────────────────────────────────────────
    // IMPORTANT: confidence = max(bullScore, bearScore) / MAX_SCORE * 100
    // This means a signal needs high ABSOLUTE score to pass the threshold —
    // not just directional dominance (which was the old broken formula).
    let bullScore = 0;
    let bearScore = 0;
    const reasons = [];

    // EMA stack alignment (max 30 pts)
    if (current > e9 && e9 > e21 && e21 > e50) {
      bullScore += 30; reasons.push('EMA stack fully bullish (9 > 21 > 50)');
    } else if (current < e9 && e9 < e21 && e21 < e50) {
      bearScore += 30; reasons.push('EMA stack fully bearish (9 < 21 < 50)');
    } else if (current > e21 && e21 > e50) {
      bullScore += 18; reasons.push('Trend up: price above 21 EMA above 50 EMA');
    } else if (current < e21 && e21 < e50) {
      bearScore += 18; reasons.push('Trend down: price below 21 EMA below 50 EMA');
    } else if (e9 > e21) {
      bullScore += 10; reasons.push('Short-term momentum bullish (9 EMA > 21 EMA)');
    } else {
      bearScore += 10; reasons.push('Short-term momentum bearish (9 EMA < 21 EMA)');
    }

    // 200 EMA trend bias (max 5 pts) — only score if EMA is valid (needs 200 candles)
    if (e200 !== null && ema200.length >= 50) {
      if (current > e200) { bullScore += 5; reasons.push('Price above 200 EMA — long-term uptrend'); }
      else                { bearScore += 5; reasons.push('Price below 200 EMA — long-term downtrend'); }
    }

    // RSI (max 20 pts)
    if (rsi < 30) {
      bullScore += 20; reasons.push(`RSI oversold at ${rsi.toFixed(1)} — elevated reversal probability`);
    } else if (rsi > 70) {
      bearScore += 20; reasons.push(`RSI overbought at ${rsi.toFixed(1)} — elevated pullback probability`);
    } else if (rsi > 50 && rsi < 70) {
      bullScore += 10; reasons.push(`RSI bullish zone (${rsi.toFixed(1)})`);
    } else if (rsi < 50 && rsi > 30) {
      bearScore += 10; reasons.push(`RSI bearish zone (${rsi.toFixed(1)})`);
    }

    // MACD (max 20 pts)
    if (macdData.bullish) {
      bullScore += 20; reasons.push('MACD histogram expanding bullish — momentum accelerating up');
    } else if (macdData.bearish) {
      bearScore += 20; reasons.push('MACD histogram expanding bearish — momentum accelerating down');
    } else if (macdData.macd > 0) {
      bullScore += 8; reasons.push('MACD positive territory');
    } else {
      bearScore += 8; reasons.push('MACD negative territory');
    }

    // Bollinger Bands (max 10 pts)
    if (bb) {
      if (current < bb.lower) {
        bullScore += 10; reasons.push('Price at lower Bollinger Band — mean reversion setup');
      } else if (current > bb.upper) {
        bearScore += 10; reasons.push('Price at upper Bollinger Band — mean reversion setup');
      } else if (current > bb.mid) {
        bullScore += 4; reasons.push('Price above Bollinger midline');
      } else {
        bearScore += 4; reasons.push('Price below Bollinger midline');
      }
    }

    // Stochastic (max 5 pts)
    if (stoch < 20) {
      bullScore += 5; reasons.push(`Stochastic oversold (${stoch.toFixed(1)})`);
    } else if (stoch > 80) {
      bearScore += 5; reasons.push(`Stochastic overbought (${stoch.toFixed(1)})`);
    }

    // Volume confirmation (max 10 pts)
    if (vol === 'high') {
      if (bullScore > bearScore) { bullScore += 10; reasons.push('Above-average volume confirms bullish move'); }
      else                       { bearScore += 10; reasons.push('Above-average volume confirms bearish move'); }
    } else if (vol === 'low') {
      reasons.push('Low volume — wait for confirmation before entering');
    }

    // Key level proximity (max 5 pts) — uses real swing pivots
    if (atr > 0) {
      const distToSupport    = Math.abs(current - levels.support)    / atr;
      const distToResistance = Math.abs(current - levels.resistance) / atr;
      if (distToSupport < 1.5 && current >= levels.support) {
        bullScore += 5; reasons.push(`Near swing support at ${levels.support.toFixed(4)}`);
      } else if (distToResistance < 1.5 && current <= levels.resistance) {
        bearScore += 5; reasons.push(`Near swing resistance at ${levels.resistance.toFixed(4)}`);
      }
    }

    // 4H macro trend alignment bonus (max 8 pts) — cross-timeframe confluence
    if (trend4H) {
      if (trend4H === 'bullish' && bullScore >= bearScore) {
        bullScore += 8; reasons.push('4H trend aligned bullish — multi-timeframe confluence');
      } else if (trend4H === 'bearish' && bearScore > bullScore) {
        bearScore += 8; reasons.push('4H trend aligned bearish — multi-timeframe confluence');
      } else if (trend4H !== 'neutral') {
        // Counter-trend warning (reduces nothing but noted)
        reasons.push(`Counter-trend to 4H — signal goes against ${trend4H} macro trend`);
      }
    }

    // ── Final signal decision ─────────────────────────────────────────────
    // FIXED: confidence = absolute score vs max possible (not directional ratio).
    // Old formula gave 100% confidence for any 1-indicator signal.
    const winScore   = Math.max(bullScore, bearScore);
    const confidence = Math.round((winScore / this.MAX_SCORE) * 100);
    if (confidence < 58) return null;  // Minimum absolute strength threshold

    const direction = bullScore > bearScore ? 'BUY' : 'SELL';

    // ── ATR-adaptive SL/TP ────────────────────────────────────────────────
    // High volatility: tighter multiplier (price moves more, SL must be wider
    // relative to tick, so we actually slightly widen). Low vol: standard.
    // Result: TP1 = 2.5x, TP2 = 4x gives 1.67:1 and 2.67:1 R:R.
    const slMult  = volReg === 'high' ? 1.8  : 1.5;
    const tp1Mult = volReg === 'high' ? 2.8  : 2.5;
    const tp2Mult = volReg === 'high' ? 4.5  : 4.0;

    let entry, sl, tp1, tp2;
    if (direction === 'BUY') {
      entry = current;
      sl    = entry - atr * slMult;
      tp1   = entry + atr * tp1Mult;
      tp2   = entry + atr * tp2Mult;
    } else {
      entry = current;
      sl    = entry + atr * slMult;
      tp1   = entry - atr * tp1Mult;
      tp2   = entry - atr * tp2Mult;
    }

    const rrRatio = (tp1Mult / slMult).toFixed(2);

    // ── Signal object ─────────────────────────────────────────────────────
    // ID is stable (symbol+direction, not timestamp) for proper AI cache hits.
    const signal = {
      id:         `${symbol}-${direction}`,
      symbol,
      display:    window.INSTRUMENTS?.[symbol]?.display || symbol,
      direction,
      confidence,
      entry:      parseFloat(entry.toFixed(5)),
      sl:         parseFloat(sl.toFixed(5)),
      tp1:        parseFloat(tp1.toFixed(5)),
      tp2:        parseFloat(tp2.toFixed(5)),
      rrRatio,
      atr:        parseFloat(atr.toFixed(5)),
      rsi:        parseFloat(rsi.toFixed(1)),
      stoch:      parseFloat(stoch.toFixed(1)),
      macd:       macdData,
      volume:     vol,
      volRegime:  volReg,
      trend4H:    trend4H || 'none',
      reasons:    reasons.slice(0, 6),
      timestamp:  new Date(),
      simulated:  candles[0]?.simulated || false,
      timeframe:  '1H',
    };

    // ── Deduplicate (same direction on same symbol within 45 min) ─────────
    const last = this.lastSignals[symbol];
    if (last && last.direction === direction && Date.now() - last.ts < 45 * 60 * 1000) {
      return { ...signal, refreshed: true };
    }
    this.lastSignals[symbol] = { direction, ts: Date.now() };

    return signal;
  }

  // ── Batch scan all symbols — runs in PARALLEL for speed ───────────────────
  // Fixed: was sequential for..of (30+ seconds). Now Promise.allSettled() (3-5s).
  async scanAll(symbols) {
    const tasks = symbols.map(sym => this._scanOne(sym));
    const settled = await Promise.allSettled(tasks);

    const results = [];
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled' && outcome.value) {
        results.push(outcome.value);
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async _scanOne(sym) {
    try {
      // Fetch 1H candles (220 for valid 200-EMA) and 4H candles in parallel
      const [candles1H, candles4H] = await Promise.allSettled([
        window.marketData.getCandles(sym, '1h', 220),
        window.marketData.getCandles(sym, '4h', 60),
      ]);

      const c1H = candles1H.status === 'fulfilled' ? candles1H.value : null;
      const c4H = candles4H.status === 'fulfilled' ? candles4H.value : null;

      if (!c1H || c1H.length < 50) return null;

      return await this.generateSignal(sym, c1H, c4H);
    } catch (e) {
      console.warn(`Signal scan failed for ${sym}:`, e.message);
      return null;
    }
  }
}

// ── Risk Manager ──────────────────────────────────────────────────────────────
class RiskManager {

  /**
   * Calculate position size such that a stop loss hit = riskAmount dollars.
   * Uses instrument-specific tick value from the INSTRUMENTS map.
   * Returns: lots (forex), contracts (futures), or coin units (crypto).
   */
  calcPositionSize({ symbol, entry, sl, riskAmount }) {
    const inst = window.INSTRUMENTS?.[symbol];
    if (!inst || !entry || !sl || entry === sl || riskAmount <= 0) return 0;

    const slDistance = Math.abs(entry - sl);

    if (inst.type === 'forex') {
      // Standard lot = 100,000 units.
      // JPY pairs: pip = 0.01, $10/pip/lot for USD quote pairs.
      // Gold (XAU/USD): pip = 0.01, $1/pip/lot.
      // Cross pairs (non-USD quote): requires conversion — approximate with $10/pip for majors.
      const pips = slDistance / inst.pip;
      let pipValue = 10;  // default $10/pip per standard lot (USD quote)
      if (inst.quote === 'JPY') pipValue = 10;   // USD/JPY: 0.01 pip = $10/lot approx at ~150
      if (symbol === 'XAUUSD') pipValue = 1;     // Gold: 0.01 pt = $1/lot
      if (inst.quote === 'JPY' && !symbol.startsWith('USD')) pipValue = 7; // GBPJPY approx
      const lots = riskAmount / (pips * pipValue);
      return parseFloat(Math.max(0.01, lots).toFixed(2));

    } else if (inst.type === 'futures') {
      // Dollar risk per contract = (slDistance / tickSize) * tickValue
      const tickSize        = inst.pip;
      const tickVal         = inst.tickVal || 10;
      const ticks           = slDistance / tickSize;
      const riskPerContract = ticks * tickVal;
      if (riskPerContract <= 0) return 0;
      const contracts = riskAmount / riskPerContract;
      // Floor to nearest contract — if even 1 contract exceeds risk, return 1 with a note
      const floored = Math.floor(contracts);
      return parseFloat(Math.max(1, floored).toFixed(0));

    } else if (inst.type === 'crypto') {
      const size = riskAmount / slDistance;
      return parseFloat(Math.max(0.001, size).toFixed(4));
    }

    return 0;
  }

  /**
   * Validate a signal against the active prop firm challenge rules.
   * Returns { valid: boolean, warnings: string[] }
   */
  validateSignal(signal, challenge) {
    const warnings = [];
    let valid = true;

    if (!challenge) return { valid: true, warnings };

    // Daily loss limit (forex firms only — Apex has no daily limit)
    if (!challenge.isTrailingFirm && challenge.dailyBreached) {
      valid = false;
      warnings.push('Daily loss limit reached — no more trades today');
    }

    // Max drawdown proximity warnings
    if (challenge.drawdownProgress > 90) {
      valid = false;
      warnings.push('Approaching max drawdown — trading suspended until balance recovers');
    } else if (challenge.drawdownProgress > 75 && signal.confidence < 75) {
      warnings.push('Elevated drawdown — only take setups above 75% confidence');
    }

    // Trailing DD firms (Apex, TopStep) — floor proximity and consistency checks
    if (challenge.isTrailingFirm) {
      const preset       = challenge.apexAccount;
      const trailingRoom = challenge.trailingRoomRemaining;
      if (preset && trailingRoom < preset.trailingDrawdown * 0.15) {
        valid = false;
        warnings.push(`Only $${trailingRoom.toFixed(0)} trailing room — stop trading to protect the account`);
      } else if (preset && trailingRoom < preset.trailingDrawdown * 0.30) {
        warnings.push(`Only $${trailingRoom.toFixed(0)} trailing room — reduce size to minimum`);
      }

      // Futures market hours (applies to all trailing/futures firms)
      if (window.marketData && !window.marketData.isFuturesMarketOpen()) {
        warnings.push('Futures market closed — CME Globex maintenance or weekend');
      }
    }

    // Apex-only rules (consistency cap, EOD)
    if (challenge.firmKey === 'apex') {
      if (challenge.profitAmt > 0 && challenge.apexConsistencyPct > 80) {
        const maxAllowed = challenge.apexConsistencyMaxAllowed;
        warnings.push(`Approaching 30% daily consistency cap — max $${maxAllowed.toFixed(0)} more today`);
      }
      if (challenge.eodMinutesRemaining !== null && challenge.eodMinutesRemaining <= 10) {
        warnings.push(`EOD in ${challenge.eodMinutesRemaining}m — close all positions by 4:59 PM ET`);
      }
    }

    // 4H counter-trend warning (universal — applies to all firms)
    if (signal.trend4H && signal.trend4H !== 'none' && signal.trend4H !== 'neutral') {
      const signalDir = signal.direction === 'BUY' ? 'bullish' : 'bearish';
      if (signal.trend4H !== signalDir) {
        warnings.push(`Counter-trend to 4H ${signal.trend4H} bias — higher-risk setup`);
      }
    }

    return { valid, warnings };
  }
}

window.TechnicalAnalysis = TechnicalAnalysis;
window.SignalEngine      = SignalEngine;
window.RiskManager       = RiskManager;
window.signalEngine      = new SignalEngine();
window.riskManager       = new RiskManager();
