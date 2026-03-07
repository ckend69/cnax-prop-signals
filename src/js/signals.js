// signals.js — Technical analysis signal engine

class TechnicalAnalysis {
  // ── Moving Averages ────────────────────────────────────────────────────────
  static ema(closes, period) {
    if (closes.length < period) return [];
    const k = 2 / (period + 1);
    const result = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < closes.length; i++) {
      result.push(closes[i] * k + result[result.length - 1] * (1 - k));
    }
    return result;
  }

  static sma(closes, period) {
    return closes.map((_, i) => {
      if (i < period - 1) return null;
      return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    }).filter(v => v !== null);
  }

  // ── RSI ───────────────────────────────────────────────────────────────────
  static rsi(closes, period = 14) {
    if (closes.length <= period) return 50;
    const changes = closes.slice(1).map((c, i) => c - closes[i]);
    let avgGain = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    let avgLoss = Math.abs(changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;

    for (let i = period; i < changes.length; i++) {
      const gain = changes[i] > 0 ? changes[i] : 0;
      const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // ── MACD ──────────────────────────────────────────────────────────────────
  static macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast   = this.ema(closes, fast);
    const emaSlow   = this.ema(closes, slow);
    const offset    = emaFast.length - emaSlow.length;
    const macdLine  = emaSlow.map((v, i) => emaFast[i + offset] - v);
    const signalLine= this.ema(macdLine, signal);
    const sigOffset = macdLine.length - signalLine.length;
    const histogram = signalLine.map((v, i) => macdLine[i + sigOffset] - v);

    return {
      macd:      macdLine[macdLine.length - 1],
      signal:    signalLine[signalLine.length - 1],
      histogram: histogram[histogram.length - 1],
      bullish:   histogram[histogram.length - 1] > 0 &&
                 histogram[histogram.length - 1] > histogram[histogram.length - 2],
      bearish:   histogram[histogram.length - 1] < 0 &&
                 histogram[histogram.length - 1] < histogram[histogram.length - 2],
    };
  }

  // ── ATR ───────────────────────────────────────────────────────────────────
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
    const slice  = closes.slice(-period);
    const mid    = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
    const std    = Math.sqrt(variance);
    return { upper: mid + stdDev * std, mid, lower: mid - stdDev * std, std };
  }

  // ── Volume Analysis ────────────────────────────────────────────────────────
  static volumeSignal(candles, period = 20) {
    if (candles.length < period) return 'normal';
    const avgVol  = candles.slice(-period - 1, -1).reduce((a, b) => a + b.volume, 0) / period;
    const lastVol = candles[candles.length - 1].volume;
    if (lastVol > avgVol * 1.5) return 'high';
    if (lastVol < avgVol * 0.5) return 'low';
    return 'normal';
  }

  // ── Support & Resistance ───────────────────────────────────────────────────
  static keyLevels(candles, lookback = 50) {
    const slice  = candles.slice(-lookback);
    const highs  = slice.map(c => c.high).sort((a, b) => b - a);
    const lows   = slice.map(c => c.low).sort((a, b) => a - b);
    return {
      resistance: highs.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
      support:    lows.slice(0, 3).reduce((a, b)  => a + b, 0) / 3,
    };
  }
}

// ── Signal Generator ──────────────────────────────────────────────────────
class SignalEngine {
  constructor() {
    this.lastSignals = {};
  }

  async generateSignal(symbol, candles) {
    if (!candles || candles.length < 50) return null;

    const closes = candles.map(c => c.close);
    const current = closes[closes.length - 1];

    // ── Compute Indicators ─────────────────────────────────────────────────
    const ema9   = TechnicalAnalysis.ema(closes, 9);
    const ema21  = TechnicalAnalysis.ema(closes, 21);
    const ema50  = TechnicalAnalysis.ema(closes, 50);
    const rsi    = TechnicalAnalysis.rsi(closes, 14);
    const macdData = TechnicalAnalysis.macd(closes);
    const atr    = TechnicalAnalysis.atr(candles, 14);
    const bb     = TechnicalAnalysis.bollinger(closes, 20);
    const vol    = TechnicalAnalysis.volumeSignal(candles);
    const levels = TechnicalAnalysis.keyLevels(candles);

    const e9  = ema9[ema9.length - 1];
    const e21 = ema21[ema21.length - 1];
    const e50 = ema50[ema50.length - 1];

    // ── Scoring System (0-100) ────────────────────────────────────────────
    let bullScore = 0;
    let bearScore = 0;
    const reasons = [];

    // EMA trend alignment (max 30 pts)
    if (current > e9 && e9 > e21 && e21 > e50) {
      bullScore += 30; reasons.push('✅ EMA stack bullish (9 > 21 > 50)');
    } else if (current < e9 && e9 < e21 && e21 < e50) {
      bearScore += 30; reasons.push('✅ EMA stack bearish (9 < 21 < 50)');
    } else if (current > e21 && e21 > e50) {
      bullScore += 18; reasons.push('📈 EMA trend up (21 > 50)');
    } else if (current < e21 && e21 < e50) {
      bearScore += 18; reasons.push('📉 EMA trend down (21 < 50)');
    } else if (e9 > e21) {
      bullScore += 10; reasons.push('📈 Short-term bullish momentum');
    } else {
      bearScore += 10; reasons.push('📉 Short-term bearish momentum');
    }

    // RSI (max 20 pts)
    if (rsi < 35) {
      bullScore += 20; reasons.push(`✅ RSI oversold (${rsi.toFixed(1)}) — bounce zone`);
    } else if (rsi > 65) {
      bearScore += 20; reasons.push(`✅ RSI overbought (${rsi.toFixed(1)}) — pullback zone`);
    } else if (rsi > 50 && rsi < 65) {
      bullScore += 10; reasons.push(`📈 RSI in bullish zone (${rsi.toFixed(1)})`);
    } else if (rsi < 50 && rsi > 35) {
      bearScore += 10; reasons.push(`📉 RSI in bearish zone (${rsi.toFixed(1)})`);
    }

    // MACD (max 20 pts)
    if (macdData.bullish) {
      bullScore += 20; reasons.push('✅ MACD histogram expanding bullish');
    } else if (macdData.bearish) {
      bearScore += 20; reasons.push('✅ MACD histogram expanding bearish');
    } else if (macdData.macd > 0) {
      bullScore += 8; reasons.push('📈 MACD positive territory');
    } else {
      bearScore += 8; reasons.push('📉 MACD negative territory');
    }

    // Bollinger Bands (max 15 pts)
    if (bb) {
      if (current < bb.lower) {
        bullScore += 15; reasons.push('✅ Price at lower Bollinger Band — mean reversion buy');
      } else if (current > bb.upper) {
        bearScore += 15; reasons.push('✅ Price at upper Bollinger Band — mean reversion sell');
      } else if (current > bb.mid) {
        bullScore += 5; reasons.push('📈 Price above BB midline');
      } else {
        bearScore += 5; reasons.push('📉 Price below BB midline');
      }
    }

    // Volume confirmation (max 10 pts)
    if (vol === 'high') {
      if (bullScore > bearScore) { bullScore += 10; reasons.push('✅ High volume confirms bullish move'); }
      else                       { bearScore += 10; reasons.push('✅ High volume confirms bearish move'); }
    } else if (vol === 'low') {
      reasons.push('⚠️ Low volume — treat signal with caution');
    }

    // Key levels (max 5 pts)
    const distToSupport    = Math.abs(current - levels.support) / atr;
    const distToResistance = Math.abs(current - levels.resistance) / atr;
    if (distToSupport < 1.5) {
      bullScore += 5; reasons.push('📍 Near support level');
    } else if (distToResistance < 1.5) {
      bearScore += 5; reasons.push('📍 Near resistance level');
    }

    // ── Determine Signal ──────────────────────────────────────────────────
    const totalScore = bullScore + bearScore;
    const confidence = totalScore === 0 ? 50 : (Math.max(bullScore, bearScore) / totalScore) * 100;

    if (confidence < 55) return null; // Too weak — no signal

    const direction = bullScore > bearScore ? 'BUY' : 'SELL';

    // ── Calculate Entry, SL, TP ────────────────────────────────────────────
    const slMultiplier = 1.5;
    const tp1Multiplier = 2.0;
    const tp2Multiplier = 3.0;

    let entry, sl, tp1, tp2;
    if (direction === 'BUY') {
      entry = current;
      sl    = entry - atr * slMultiplier;
      tp1   = entry + atr * tp1Multiplier;
      tp2   = entry + atr * tp2Multiplier;
    } else {
      entry = current;
      sl    = entry + atr * slMultiplier;
      tp1   = entry - atr * tp1Multiplier;
      tp2   = entry - atr * tp2Multiplier;
    }

    const rrRatio = tp1Multiplier / slMultiplier; // 1.33 minimum

    const signal = {
      id:         `${symbol}-${Date.now()}`,
      symbol,
      display:    window.INSTRUMENTS?.[symbol]?.display || symbol,
      direction,
      confidence: Math.round(confidence),
      entry:      parseFloat(entry.toFixed(5)),
      sl:         parseFloat(sl.toFixed(5)),
      tp1:        parseFloat(tp1.toFixed(5)),
      tp2:        parseFloat(tp2.toFixed(5)),
      rrRatio:    rrRatio.toFixed(2),
      atr:        parseFloat(atr.toFixed(5)),
      rsi:        parseFloat(rsi.toFixed(1)),
      macd:       macdData,
      volume:     vol,
      reasons:    reasons.slice(0, 5),
      timestamp:  new Date(),
      simulated:  candles[0]?.simulated || false,
      timeframe:  '1H',
    };

    // Deduplicate — don't re-emit same direction on same symbol within 30 min
    const last = this.lastSignals[symbol];
    if (last && last.direction === direction && Date.now() - last.ts < 30 * 60 * 1000) {
      return { ...signal, refreshed: true };
    }
    this.lastSignals[symbol] = { direction, ts: Date.now() };

    return signal;
  }

  // ── Batch scan all instruments ─────────────────────────────────────────────
  async scanAll(symbols) {
    const results = [];
    for (const sym of symbols) {
      try {
        const candles = await window.marketData.getCandles(sym, '1h', 120);
        const signal  = await this.generateSignal(sym, candles);
        if (signal) results.push(signal);
      } catch (e) {
        console.warn(`Signal scan failed for ${sym}:`, e.message);
      }
    }
    // Sort by confidence descending
    return results.sort((a, b) => b.confidence - a.confidence);
  }
}

// ── Risk Manager ─────────────────────────────────────────────────────────────
class RiskManager {
  /**
   * Calculate position size in lots (forex) or contracts (futures/crypto)
   * such that a stop loss hit = riskAmount
   */
  calcPositionSize({ symbol, entry, sl, riskAmount }) {
    const inst = window.INSTRUMENTS?.[symbol];
    if (!inst) return 0;

    const slPips   = Math.abs(entry - sl);
    if (slPips === 0) return 0;

    if (inst.type === 'forex') {
      // Standard lot = 100,000 units, 1 pip on EUR/USD = $10/lot
      const pipValue = inst.pip;
      const pips     = slPips / pipValue;
      const lots     = riskAmount / (pips * 10); // $10 per pip per lot
      return parseFloat(Math.max(0.01, lots).toFixed(2));

    } else if (inst.type === 'futures') {
      // ES tick = $12.50 (0.25 pts), NQ tick = $5 (0.25 pts), CL tick = $10 (0.01)
      const tickValues = { ES: 12.5, NQ: 5, CL: 10, GC: 10 };
      const tickSize   = inst.pip;
      const tickVal    = tickValues[symbol] || 10;
      const ticks      = slPips / tickSize;
      const contracts  = riskAmount / (ticks * tickVal);
      return parseFloat(Math.max(1, Math.floor(contracts)).toFixed(0));

    } else if (inst.type === 'crypto') {
      // Size in coins such that move * size = riskAmount
      const size = riskAmount / slPips;
      return parseFloat(Math.max(0.001, size).toFixed(4));
    }
    return 0;
  }

  /**
   * Validate a signal against prop firm challenge rules.
   * Returns { valid, warnings }
   */
  validateSignal(signal, challenge) {
    const warnings = [];
    let valid = true;

    if (!challenge) return { valid: true, warnings };

    // Daily loss check
    if (challenge.dailyBreached) {
      valid = false;
      warnings.push('🚫 Daily loss limit reached — no more trades today');
    }

    // Overall drawdown check
    if (challenge.drawdownProgress > 90) {
      warnings.push('⚠️ Approaching max drawdown — only take very high-confidence setups');
    }

    // Apex: 5:1 max R:R on PA
    if (challenge.firmKey === 'apex' && parseFloat(signal.rrRatio) > 5) {
      warnings.push('⚠️ R:R exceeds 5:1 Apex PA limit — reduce TP or widen SL');
    }

    // Confidence gate for danger zones
    if (challenge.drawdownProgress > 70 && signal.confidence < 75) {
      warnings.push('⚠️ Account in drawdown — only signals above 75% confidence recommended');
    }

    return { valid, warnings };
  }
}

window.TechnicalAnalysis = TechnicalAnalysis;
window.SignalEngine = SignalEngine;
window.RiskManager  = RiskManager;
window.signalEngine = new SignalEngine();
window.riskManager  = new RiskManager();
