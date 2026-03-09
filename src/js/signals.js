// signals.js — Technical analysis engine, signal generator, risk manager
// Supports 1H (trend) + 1m (entry timing) + daily bias analysis.

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

  // ── RSI (Wilder smoothing) ─────────────────────────────────────────────────
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
    if (!signalLine.length) return { macd: macdLine[macdLine.length - 1] || 0, signal: 0, histogram: 0, bullish: false, bearish: false };
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
    const slice    = closes.slice(-period);
    const mid      = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
    const std      = Math.sqrt(variance);
    return { upper: mid + stdDev * std, mid, lower: mid - stdDev * std, std };
  }

  // ── Stochastic %K ─────────────────────────────────────────────────────────
  static stochastic(candles, period = 14) {
    if (candles.length < period) return 50;
    const slice   = candles.slice(-period);
    const highMax = Math.max(...slice.map(c => c.high));
    const lowMin  = Math.min(...slice.map(c => c.low));
    const last    = candles[candles.length - 1].close;
    if (highMax === lowMin) return 50;
    return ((last - lowMin) / (highMax - lowMin)) * 100;
  }

  // ── Volume Signal ─────────────────────────────────────────────────────────
  static volumeSignal(candles, period = 20) {
    if (candles.length < period + 1) return 'normal';
    const avgVol  = candles.slice(-period - 1, -1).reduce((a, b) => a + b.volume, 0) / period;
    const lastVol = candles[candles.length - 1].volume;
    if (avgVol === 0) return 'normal';
    if (lastVol > avgVol * 1.5) return 'high';
    if (lastVol < avgVol * 0.5) return 'low';
    return 'normal';
  }

  // ── Support & Resistance (swing pivot detection) ──────────────────────────
  static keyLevels(candles, lookback = 60) {
    const slice      = candles.slice(-lookback);
    const swingHighs = [], swingLows = [];
    for (let i = 2; i < slice.length - 2; i++) {
      const c = slice[i];
      if (c.high > slice[i-1].high && c.high > slice[i-2].high &&
          c.high > slice[i+1].high && c.high > slice[i+2].high) swingHighs.push(c.high);
      if (c.low  < slice[i-1].low  && c.low  < slice[i-2].low  &&
          c.low  < slice[i+1].low  && c.low  < slice[i+2].low)  swingLows.push(c.low);
    }
    const highs = slice.map(c => c.high), lows = slice.map(c => c.low);
    return {
      resistance: swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : Math.max(...highs),
      support:    swingLows.length  > 0 ? swingLows[swingLows.length - 1]   : Math.min(...lows),
    };
  }

  // ── Volatility regime ─────────────────────────────────────────────────────
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

  // ── 4H macro trend ────────────────────────────────────────────────────────
  static macroTrend(candles4H) {
    if (!candles4H || candles4H.length < 30) return null;
    const closes = candles4H.map(c => c.close);
    const ema9   = this.ema(closes, 9);
    const ema21  = this.ema(closes, 21);
    if (!ema9.length || !ema21.length) return null;
    const e9 = ema9[ema9.length - 1], e21 = ema21[ema21.length - 1];
    const cur = closes[closes.length - 1];
    if (cur > e9 && e9 > e21) return 'bullish';
    if (cur < e9 && e9 < e21) return 'bearish';
    return 'neutral';
  }

  // ── 1m momentum score (for entry timing) ─────────────────────────────────
  // Returns a score from -100 (strong bear 1m) to +100 (strong bull 1m)
  static momentum1m(candles1m) {
    if (!candles1m || candles1m.length < 10) return 0;
    const closes  = candles1m.map(c => c.close);
    const current = closes[closes.length - 1];

    const rsi     = this.rsi(closes.slice(-20), 14);
    const macd    = this.macd(closes.slice(-30));
    const vol     = this.volumeSignal(candles1m.slice(-20));

    // Recent 5-bar direction
    const move5   = (closes[closes.length - 1] - closes[closes.length - 6]) /
                     closes[closes.length - 6] * 100;

    let score = 0;
    if (rsi > 55)        score += 25;
    else if (rsi < 45)   score -= 25;
    if (macd.bullish)    score += 30;
    else if (macd.bearish) score -= 30;
    if (move5 > 0.01)    score += 25;
    else if (move5 < -0.01) score -= 25;
    if (vol === 'high' && score > 0) score += 15;
    if (vol === 'high' && score < 0) score -= 15;

    return Math.max(-100, Math.min(100, score));
  }

  // ── Estimated trade duration based on ATR and current momentum ────────────
  // Returns estimated minutes to TP or SL based on average 1m move size
  static estimateTradeDuration(atr1h, atr1m, slMult = 1.5) {
    if (atr1m <= 0) return { minTarget: 5, maxTarget: 45 };
    // SL distance in 1m ATR terms
    const slIn1mAtr  = (atr1h * slMult) / atr1m;
    const tpIn1mAtr  = slIn1mAtr * 2;   // 2R TP
    // Average move per minute roughly = atr1m * 0.4 (smoothed for realistic exits)
    const minsToTP   = Math.round(tpIn1mAtr / 0.4);
    const minsToSL   = Math.round(slIn1mAtr / 0.4);
    // Clamp to 1-45 min target range
    return {
      minTarget: Math.max(1, Math.min(45, Math.floor(minsToTP * 0.6))),
      maxTarget: Math.min(45, Math.ceil(minsToTP * 1.4)),
      slMins:    Math.max(1, Math.min(45, minsToSL)),
    };
  }
}

// ── Signal Generator ──────────────────────────────────────────────────────────
class SignalEngine {
  constructor() {
    this.lastSignals = {};   // symbol -> { direction, ts }
    this.MAX_SCORE   = 113;
  }

  async generateSignal(symbol, candles, candles4H = null) {
    if (!candles || candles.length < 50) return null;

    const closes  = candles.map(c => c.close);
    const current = closes[closes.length - 1];

    // ── Indicators ─────────────────────────────────────────────────────────
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

    const e9   = ema9.length   > 0 ? ema9[ema9.length - 1]     : current;
    const e21  = ema21.length  > 0 ? ema21[ema21.length - 1]   : current;
    const e50  = ema50.length  > 0 ? ema50[ema50.length - 1]   : current;
    const e200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;

    // ── Scoring ────────────────────────────────────────────────────────────
    let bullScore = 0, bearScore = 0;
    const reasons = [];

    // EMA stack (max 30 pts)
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

    // 200 EMA (max 5 pts)
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

    // Volume (max 10 pts)
    if (vol === 'high') {
      if (bullScore > bearScore) { bullScore += 10; reasons.push('Above-average volume confirms bullish move'); }
      else                       { bearScore += 10; reasons.push('Above-average volume confirms bearish move'); }
    } else if (vol === 'low') {
      reasons.push('Low volume — wait for confirmation');
    }

    // Key levels (max 5 pts)
    if (atr > 0) {
      const distS = Math.abs(current - levels.support)    / atr;
      const distR = Math.abs(current - levels.resistance) / atr;
      if (distS < 1.5 && current >= levels.support) {
        bullScore += 5; reasons.push(`Near swing support at ${levels.support.toFixed(4)}`);
      } else if (distR < 1.5 && current <= levels.resistance) {
        bearScore += 5; reasons.push(`Near swing resistance at ${levels.resistance.toFixed(4)}`);
      }
    }

    // 4H trend alignment (max 8 pts)
    if (trend4H) {
      if (trend4H === 'bullish' && bullScore >= bearScore) {
        bullScore += 8; reasons.push('4H trend aligned bullish — multi-timeframe confluence');
      } else if (trend4H === 'bearish' && bearScore > bullScore) {
        bearScore += 8; reasons.push('4H trend aligned bearish — multi-timeframe confluence');
      } else if (trend4H !== 'neutral') {
        reasons.push(`Counter-trend to 4H — signal goes against ${trend4H} macro trend`);
      }
    }

    // ── Decision ───────────────────────────────────────────────────────────
    const winScore   = Math.max(bullScore, bearScore);
    const confidence = Math.round((winScore / this.MAX_SCORE) * 100);
    if (confidence < 55) return null;

    const direction = bullScore > bearScore ? 'BUY' : 'SELL';

    // ── ATR-adaptive SL/TP ─────────────────────────────────────────────────
    const slMult  = volReg === 'high' ? 1.8 : 1.5;
    const tp1Mult = volReg === 'high' ? 2.8 : 2.5;
    const tp2Mult = volReg === 'high' ? 4.5 : 4.0;

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

    // ── Trade time target (1-45 min) ───────────────────────────────────────
    // Estimate duration using 1m ATR if available (fetched lazily)
    let timingHint = '5–45 min';
    let estMinutes = { minTarget: 5, maxTarget: 45, slMins: 15 };
    try {
      const candles1m = await window.marketData.getCandles1m(symbol, 30);
      if (candles1m && candles1m.length >= 10) {
        const atr1m = TechnicalAnalysis.atr(candles1m, Math.min(14, candles1m.length - 1));
        estMinutes  = TechnicalAnalysis.estimateTradeDuration(atr, atr1m, slMult);
        timingHint  = `${estMinutes.minTarget}–${estMinutes.maxTarget} min`;
      }
    } catch(e) {}

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
      rrRatio:    (tp1Mult / slMult).toFixed(2),
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
      timingHint,
      estMinutes,
    };

    // Deduplicate (same direction within 45 min)
    const last = this.lastSignals[symbol];
    if (last && last.direction === direction && Date.now() - last.ts < 45 * 60 * 1000) {
      return { ...signal, refreshed: true };
    }
    this.lastSignals[symbol] = { direction, ts: Date.now() };
    return signal;
  }

  // ── Batch scan all symbols in parallel ────────────────────────────────────
  async scanAll(symbols) {
    const settled = await Promise.allSettled(symbols.map(sym => this._scanOne(sym)));
    const results = [];
    for (const o of settled) {
      if (o.status === 'fulfilled' && o.value) results.push(o.value);
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async _scanOne(sym) {
    try {
      const [c1H, c4H] = await Promise.allSettled([
        window.marketData.getCandles(sym, '1h', 220),
        window.marketData.getCandles(sym, '4h', 60),
      ]);
      const candles1H = c1H.status === 'fulfilled' ? c1H.value : null;
      const candles4H = c4H.status === 'fulfilled' ? c4H.value : null;
      if (!candles1H || candles1H.length < 50) return null;
      return await this.generateSignal(sym, candles1H, candles4H);
    } catch(e) {
      console.warn(`Signal scan failed for ${sym}:`, e.message);
      return null;
    }
  }
}

// ── Risk Manager ──────────────────────────────────────────────────────────────
class RiskManager {
  calcPositionSize({ symbol, entry, sl, riskAmount }) {
    const inst = window.INSTRUMENTS?.[symbol];
    if (!inst || !entry || !sl || entry === sl || riskAmount <= 0) return 0;
    const slDistance = Math.abs(entry - sl);

    if (inst.type === 'forex') {
      const pips = slDistance / inst.pip;
      let pipValue = 10;
      if (inst.quote === 'JPY') pipValue = 10;
      if (symbol === 'XAUUSD') pipValue = 1;
      if (inst.quote === 'JPY' && !symbol.startsWith('USD')) pipValue = 7;
      const lots = riskAmount / (pips * pipValue);
      return parseFloat(Math.max(0.01, lots).toFixed(2));

    } else if (inst.type === 'futures') {
      const tickSize = inst.pip;
      const tickVal  = inst.tickVal || window.marketData.getTickVal(symbol) || 10;
      const ticks    = slDistance / tickSize;
      const risk     = ticks * tickVal;
      if (risk <= 0) return 0;
      return parseFloat(Math.max(1, Math.floor(riskAmount / risk)).toFixed(0));

    } else if (inst.type === 'crypto') {
      const size = riskAmount / slDistance;
      return parseFloat(Math.max(0.001, size).toFixed(4));
    }
    return 0;
  }

  validateSignal(signal, challenge) {
    const warnings = [];
    let valid = true;
    if (!challenge) return { valid: true, warnings };

    if (!challenge.isTrailingFirm && challenge.dailyBreached) {
      valid = false;
      warnings.push('Daily loss limit reached — no more trades today');
    }
    if (challenge.drawdownProgress > 90) {
      valid = false;
      warnings.push('Approaching max drawdown — trading suspended');
    } else if (challenge.drawdownProgress > 75 && signal.confidence < 75) {
      warnings.push('Elevated drawdown — only take setups above 75% confidence');
    }
    if (challenge.isTrailingFirm) {
      const preset = challenge.apexAccount;
      const room   = challenge.trailingRoomRemaining;
      if (preset && room < preset.trailingDrawdown * 0.15) {
        valid = false;
        warnings.push(`Only $${room.toFixed(0)} trailing room — stop trading`);
      } else if (preset && room < preset.trailingDrawdown * 0.30) {
        warnings.push(`Only $${room.toFixed(0)} trailing room — reduce size`);
      }
      if (window.marketData && !window.marketData.isFuturesMarketOpen()) {
        warnings.push('Futures market closed — CME Globex maintenance or weekend');
      }
    }
    if (challenge.firmKey === 'apex') {
      if (challenge.profitAmt > 0 && challenge.apexConsistencyPct > 80) {
        const maxAllowed = challenge.apexConsistencyMaxAllowed;
        warnings.push(`Approaching 30% daily consistency cap — max $${maxAllowed?.toFixed(0)} more today`);
      }
      if (challenge.eodMinutesRemaining !== null && challenge.eodMinutesRemaining <= 10) {
        warnings.push(`EOD in ${challenge.eodMinutesRemaining}m — close all positions by 4:59 PM ET`);
      }
    }
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
