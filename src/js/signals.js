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
    const range = highMax - lowMin;
    if (range < 1e-10) return 50;   // also guards floating-point near-zero
    return ((last - lowMin) / range) * 100;
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
    const current = slice[slice.length - 1]?.close ?? 0;
    return {
      // Fallback to current price if highs/lows are empty to avoid ±Infinity
      resistance: swingHighs.length > 0 ? swingHighs[swingHighs.length - 1]
                : highs.length > 0 ? Math.max(...highs) : current,
      support:    swingLows.length  > 0 ? swingLows[swingLows.length - 1]
                : lows.length  > 0 ? Math.min(...lows)  : current,
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

    // Recent 5-bar direction (guard: need at least 6 candles)
    const ref6    = closes.length >= 6 ? closes[closes.length - 6] : closes[0];
    const move5   = ref6 > 0 ? ((closes[closes.length - 1] - ref6) / ref6 * 100) : 0;

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

  // ── Reversal Pattern Detection ─────────────────────────────────────────────

  // Engulfing candle — current bar's body completely swallows previous bar's body
  // Returns 'bullish' | 'bearish' | 'none'
  static engulfing(candles) {
    if (candles.length < 2) return 'none';
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    if (prevBody === 0 || currBody === 0) return 'none';
    // Bullish: previous bar bearish, current bar bullish and engulfs
    if (prev.close < prev.open && curr.close > curr.open &&
        curr.open  <= prev.close && curr.close >= prev.open) {
      return 'bullish';
    }
    // Bearish: previous bar bullish, current bar bearish and engulfs
    if (prev.close > prev.open && curr.close < curr.open &&
        curr.open  >= prev.close && curr.close <= prev.open) {
      return 'bearish';
    }
    return 'none';
  }

  // Pin bar — hammer (bullish) or shooting star (bearish)
  // Returns 'bullish' | 'bearish' | 'none'
  static pinBar(candles) {
    if (candles.length < 1) return 'none';
    const c     = candles[candles.length - 1];
    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return 'none';
    const bodyTop    = Math.max(c.open, c.close);
    const bodyBottom = Math.min(c.open, c.close);
    const upperWick  = c.high - bodyTop;
    const lowerWick  = bodyBottom - c.low;
    const bodyRatio  = body / range;
    // Hammer (bullish): small body, long lower wick (≥2× body), small upper wick
    if (bodyRatio < 0.35 && lowerWick >= body * 2.0 && upperWick <= body * 0.6) {
      return 'bullish';
    }
    // Shooting star (bearish): small body, long upper wick (≥2× body), small lower wick
    if (bodyRatio < 0.35 && upperWick >= body * 2.0 && lowerWick <= body * 0.6) {
      return 'bearish';
    }
    return 'none';
  }

  // Doji — body is <10% of total range (indecision candle)
  static isDoji(candles) {
    if (candles.length < 1) return false;
    const c     = candles[candles.length - 1];
    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return true;
    return body / range < 0.10;
  }

  // RSI divergence — price makes a new extreme but RSI does not confirm it
  // Returns 'bullish' | 'bearish' | 'none'
  static rsiDivergence(candles, lookback = 25) {
    if (candles.length < lookback + 5) return 'none';
    const slice  = candles.slice(-lookback);
    const closes = slice.map(c => c.close);

    // Build rolling RSI series using period 9 (faster response on 5m)
    const rsiSeries = [];
    for (let i = 10; i <= closes.length; i++) {
      rsiSeries.push(this.rsi(closes.slice(0, i), 9));
    }
    if (rsiSeries.length < 10) return 'none';

    const recentRsi   = rsiSeries[rsiSeries.length - 1];

    // Bullish divergence: price made lower low in recent 5 bars vs prior 10–20 bars,
    // but RSI is higher → momentum is recovering
    const priceLowNew = Math.min(...closes.slice(-5));
    const priceLowOld = Math.min(...closes.slice(-20, -5));
    const rsiLowNew   = Math.min(...rsiSeries.slice(-5));
    const rsiLowOld   = Math.min(...rsiSeries.slice(-20, -5));
    if (priceLowNew < priceLowOld * 0.9999 && rsiLowNew > rsiLowOld + 2 && recentRsi < 52) {
      return 'bullish';
    }

    // Bearish divergence: price made higher high in recent 5 bars vs prior 10–20 bars,
    // but RSI is lower → momentum is fading
    const priceHighNew = Math.max(...closes.slice(-5));
    const priceHighOld = Math.max(...closes.slice(-20, -5));
    const rsiHighNew   = Math.max(...rsiSeries.slice(-5));
    const rsiHighOld   = Math.max(...rsiSeries.slice(-20, -5));
    if (priceHighNew > priceHighOld * 1.0001 && rsiHighNew < rsiHighOld - 2 && recentRsi > 48) {
      return 'bearish';
    }

    return 'none';
  }

  // Double top / double bottom — two swing highs/lows within 0.5 ATR, price now reversing
  // Returns 'bullish' (double bottom) | 'bearish' (double top) | 'none'
  static doubleTopBottom(candles, atr) {
    if (candles.length < 30 || atr <= 0) return 'none';
    const slice   = candles.slice(-40);
    const current = slice[slice.length - 1].close;

    // Collect swing highs and lows (simple: bar higher/lower than 2 neighbours each side)
    const swingH = [], swingL = [];
    for (let i = 2; i < slice.length - 2; i++) {
      const { high, low } = slice[i];
      if (high > slice[i-1].high && high > slice[i-2].high &&
          high > slice[i+1].high && high > slice[i+2].high) swingH.push(high);
      if (low  < slice[i-1].low  && low  < slice[i-2].low  &&
          low  < slice[i+1].low  && low  < slice[i+2].low)  swingL.push(low);
    }

    // Double top: two highs within 0.5 ATR, current price declining from second peak
    if (swingH.length >= 2) {
      const h1 = swingH[swingH.length - 2], h2 = swingH[swingH.length - 1];
      if (Math.abs(h1 - h2) < atr * 0.5 && current < h2 - atr * 0.25) return 'bearish';
    }
    // Double bottom: two lows within 0.5 ATR, current price rising from second trough
    if (swingL.length >= 2) {
      const l1 = swingL[swingL.length - 2], l2 = swingL[swingL.length - 1];
      if (Math.abs(l1 - l2) < atr * 0.5 && current > l2 + atr * 0.25) return 'bullish';
    }
    return 'none';
  }

  // Bollinger Band squeeze — current band width < 70% of band width 20 bars ago
  static bbSqueeze(closes) {
    if (closes.length < 45) return false;
    const bb1 = this.bollinger(closes, 20);
    const bb2 = this.bollinger(closes.slice(0, -20), 20);
    if (!bb1 || !bb2 || bb2.mid === 0) return false;
    const widthNow  = (bb1.upper - bb1.lower) / bb1.mid;
    const widthPrev = (bb2.upper - bb2.lower) / bb2.mid;
    return widthNow < widthPrev * 0.7;
  }

  // Short-term trend from 1H context candles (works with as few as 10 bars)
  static shortTrend(candles1H) {
    if (!candles1H || candles1H.length < 10) return null;
    const closes = candles1H.map(c => c.close);
    const p9  = Math.min(9,  closes.length - 1);
    const p21 = Math.min(21, closes.length - 1);
    const e9  = this.ema(closes, p9);
    const e21 = this.ema(closes, p21);
    if (!e9.length || !e21.length) return null;
    const cur = closes[closes.length - 1];
    if (cur > e9[e9.length-1] && e9[e9.length-1] > e21[e21.length-1]) return 'bullish';
    if (cur < e9[e9.length-1] && e9[e9.length-1] < e21[e21.length-1]) return 'bearish';
    return 'neutral';
  }

  // ── VWAP (Volume-Weighted Average Price) ──────────────────────────────────
  // Institutional benchmark — price reverts to VWAP intraday.
  // Returns the VWAP price, or null if volume data is unavailable.
  static vwap(candles) {
    if (candles.length < 5) return null;
    let cumTPV = 0, cumVol = 0;
    for (const c of candles) {
      const tp  = (c.high + c.low + c.close) / 3;
      const vol = c.volume > 0 ? c.volume : 1;
      cumTPV += tp * vol;
      cumVol += vol;
    }
    return cumVol > 0 ? cumTPV / cumVol : null;
  }

  // ── Fibonacci OTE Zone (Optimal Trade Entry) ───────────────────────────────
  // TJR's core entry rule: enter at 0.618–0.786 retracement of the most recent swing.
  // Returns 'bullish' | 'bearish' | 'none'
  static fibOTE(candles, atr) {
    if (candles.length < 20 || atr <= 0) return 'none';
    const slice   = candles.slice(-35);
    const current = slice[slice.length - 1].close;
    const highs   = slice.map(c => c.high);
    const lows    = slice.map(c => c.low);
    const swingH  = Math.max(...highs);
    const swingL  = Math.min(...lows);
    const range   = swingH - swingL;
    if (range < atr * 1.0) return 'none';

    const hiIdx = highs.indexOf(swingH);
    const loIdx = lows.indexOf(swingL);

    if (loIdx < hiIdx) {
      // Swing low→high: retracing DOWN into OTE = bullish
      const ote618 = swingH - range * 0.618;
      const ote786 = swingH - range * 0.786;
      if (current >= ote786 - atr * 0.15 && current <= ote618 + atr * 0.15) return 'bullish';
    } else {
      // Swing high→low: retracing UP into OTE = bearish
      const ote618 = swingL + range * 0.618;
      const ote786 = swingL + range * 0.786;
      if (current >= ote618 - atr * 0.15 && current <= ote786 + atr * 0.15) return 'bearish';
    }
    return 'none';
  }

  // ── ICT Power of 3 (Accumulation → Manipulation → Distribution) ───────────
  // Detects the 3-phase model: tight range → Judas swing → real directional move.
  // Returns { phase, direction }
  static powerOfThree(candles) {
    if (candles.length < 30) return { phase: 'unknown', direction: 'none' };
    const slice     = candles.slice(-30);
    const early     = slice.slice(0, 10);
    const mid       = slice.slice(10, 20);
    const late      = slice.slice(20);
    const rangeH    = Math.max(...early.map(c => c.high));
    const rangeL    = Math.min(...early.map(c => c.low));
    const rangeSize = rangeH - rangeL;
    if (rangeSize <= 0) return { phase: 'unknown', direction: 'none' };

    const midH      = Math.max(...mid.map(c => c.high));
    const midL      = Math.min(...mid.map(c => c.low));
    const lateClose = late[late.length - 1].close;
    const lateOpen  = late[0].open;
    const lateMove  = lateClose - lateOpen;

    if (midL < rangeL - rangeSize * 0.05 && lateMove > rangeSize * 0.4 && lateClose > rangeH) {
      return { phase: 'distribution', direction: 'bullish' };
    }
    if (midH > rangeH + rangeSize * 0.05 && lateMove < -rangeSize * 0.4 && lateClose < rangeL) {
      return { phase: 'distribution', direction: 'bearish' };
    }
    if (midL < rangeL - rangeSize * 0.05 || midH > rangeH + rangeSize * 0.05) {
      return { phase: 'manipulation', direction: 'none' };
    }
    return { phase: 'accumulation', direction: 'none' };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── TJR / Smart Money Concepts (SMC / ICT-based) ─────────────────────────
  // Implements the core concepts used by popular trader TJR:
  //   • Order Blocks (OB)  — institutional demand/supply zones
  //   • Fair Value Gaps (FVG) — price imbalances that act as magnets
  //   • Liquidity Sweeps   — stop hunts before the real move
  //   • Market Structure   — BOS (Break of Structure) and CHoCH (Change of Character)
  //   • Premium / Discount — buy below midrange, sell above midrange
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Order Block (OB) — the last opposing-direction candle before a significant
   * displacement move. When price returns to this zone it often reacts strongly.
   *
   * Bullish OB: last bearish candle before a strong bullish impulse (>1.2 ATR)
   * Bearish OB: last bullish candle before a strong bearish impulse (>1.2 ATR)
   *
   * Returns { type, top, bottom, strength } or { type: 'none' }
   */
  static orderBlock(candles, atr) {
    if (candles.length < 10 || atr <= 0) return { type: 'none' };
    const slice   = candles.slice(-50);
    const current = slice[slice.length - 1].close;
    const threshold = atr * 1.2;   // displacement requires at least 1.2× ATR body

    for (let i = slice.length - 3; i >= 3; i--) {
      const c    = slice[i];
      const body = Math.abs(c.close - c.open);

      // Bullish displacement: big bullish candle — look back for last bearish OB candle
      if (c.close > c.open && body >= threshold) {
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const ob = slice[j];
          if (ob.close < ob.open) {  // bearish candle = bullish order block
            const top    = Math.max(ob.open, ob.close);
            const bottom = Math.min(ob.open, ob.close);
            // Price must be AT or NEAR the OB (within 0.6 ATR to react)
            if (current >= bottom - atr * 0.6 && current <= top + atr * 0.3) {
              return { type: 'bullish', top, bottom, strength: Math.min(1, body / (atr * 3)) };
            }
            break;
          }
        }
      }

      // Bearish displacement: big bearish candle — look back for last bullish OB candle
      if (c.open > c.close && body >= threshold) {
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const ob = slice[j];
          if (ob.close > ob.open) {  // bullish candle = bearish order block
            const top    = Math.max(ob.open, ob.close);
            const bottom = Math.min(ob.open, ob.close);
            if (current >= bottom - atr * 0.3 && current <= top + atr * 0.6) {
              return { type: 'bearish', top, bottom, strength: Math.min(1, body / (atr * 3)) };
            }
            break;
          }
        }
      }
    }
    return { type: 'none' };
  }

  /**
   * Fair Value Gap (FVG) — a 3-candle imbalance where the high of candle[i] and
   * low of candle[i+2] don't overlap (or vice versa). Price tends to return to
   * fill these gaps. TJR watches FVGs as high-probability re-entry zones.
   *
   * Returns { type: 'bullish'|'bearish'|'none', top, bottom, size }
   */
  static fairValueGap(candles, atr) {
    if (candles.length < 5 || atr <= 0) return { type: 'none' };
    const current = candles[candles.length - 1].close;
    const minSize = atr * 0.25;   // FVG must be at least 0.25 ATR to be significant

    // Search last 10 candle triplets for a valid FVG
    const start = Math.max(0, candles.length - 12);
    for (let i = candles.length - 3; i >= start; i--) {
      const c1 = candles[i];
      const c3 = candles[i + 2];

      // Bullish FVG: c1.high < c3.low (gap between top of c1 and bottom of c3)
      const bullGap = c3.low - c1.high;
      if (bullGap >= minSize) {
        // Price retracing INTO the gap = re-entry opportunity
        if (current >= c1.high - atr * 0.1 && current <= c3.low + atr * 0.2) {
          return { type: 'bullish', bottom: c1.high, top: c3.low, size: bullGap };
        }
      }

      // Bearish FVG: c3.high < c1.low (gap between bottom of c1 and top of c3)
      const bearGap = c1.low - c3.high;
      if (bearGap >= minSize) {
        if (current >= c3.high - atr * 0.2 && current <= c1.low + atr * 0.1) {
          return { type: 'bearish', bottom: c3.high, top: c1.low, size: bearGap };
        }
      }
    }
    return { type: 'none' };
  }

  /**
   * Liquidity Sweep — price wicks below a key low (or above a key high) grabbing
   * stop orders, then reverses. This is TJR's #1 entry trigger: once the sweep
   * candle closes back inside the range, the real move begins.
   *
   * Returns 'bullish' | 'bearish' | 'none'
   */
  static liquiditySweep(candles, atr) {
    if (candles.length < 25 || atr <= 0) return 'none';
    const lookback = 20;
    const history  = candles.slice(-lookback - 2, -2);  // prior range (excluding sweep candle)
    const sweepCandle  = candles[candles.length - 2];   // potential sweep candle
    const currentCandle = candles[candles.length - 1];  // current candle confirming

    const rangeLow  = Math.min(...history.map(c => c.low));
    const rangeHigh = Math.max(...history.map(c => c.high));

    // Bullish sweep: wick below range low but CLOSED above range low
    // Confirmed by current candle being bullish (price already reversing)
    if (sweepCandle.low < rangeLow - atr * 0.02 &&
        sweepCandle.close > rangeLow &&
        currentCandle.close > currentCandle.open) {
      return 'bullish';
    }

    // Bearish sweep: wick above range high but CLOSED below range high
    if (sweepCandle.high > rangeHigh + atr * 0.02 &&
        sweepCandle.close < rangeHigh &&
        currentCandle.close < currentCandle.open) {
      return 'bearish';
    }

    return 'none';
  }

  /**
   * Market Structure — TJR uses two key concepts:
   *   BOS  (Break of Structure): price breaks a previous swing H/L in the SAME
   *        direction as the trend — confirms trend continuation.
   *   CHoCH (Change of Character): price breaks a swing H/L AGAINST the current
   *        trend — first sign of reversal, highest probability setups.
   *
   * Returns { bos: 'bullish'|'bearish'|'none', choch: 'bullish'|'bearish'|'none' }
   */
  static marketStructure(candles) {
    if (candles.length < 25) return { bos: 'none', choch: 'none' };
    const slice = candles.slice(-35);
    const current = slice[slice.length - 1].close;

    // Identify swing highs and lows (3-bar pivot logic)
    const swingH = [], swingL = [];
    for (let i = 2; i < slice.length - 2; i++) {
      const { high, low } = slice[i];
      if (high > slice[i-1].high && high > slice[i-2].high &&
          high > slice[i+1].high && high > slice[i+2].high) swingH.push(high);
      if (low  < slice[i-1].low  && low  < slice[i-2].low  &&
          low  < slice[i+1].low  && low  < slice[i+2].low)  swingL.push(low);
    }

    let bos = 'none', choch = 'none';
    if (swingH.length < 2 || swingL.length < 2) return { bos, choch };

    const lastH = swingH[swingH.length - 1], prevH = swingH[swingH.length - 2];
    const lastL = swingL[swingL.length - 1], prevL = swingL[swingL.length - 2];

    const isUptrend   = lastH > prevH && lastL > prevL;
    const isDowntrend = lastH < prevH && lastL < prevL;

    // BOS: break in direction of existing structure (continuation)
    if (current > lastH && isUptrend)   bos = 'bullish';
    if (current < lastL && isDowntrend) bos = 'bearish';

    // CHoCH: break AGAINST existing structure (reversal — higher probability)
    if (current > lastH && isDowntrend) choch = 'bullish';
    if (current < lastL && isUptrend)   choch = 'bearish';

    return { bos, choch };
  }

  /**
   * Premium / Discount Zone — TJR core rule:
   *   "Buy in Discount (below 50% of range), Sell in Premium (above 50%)"
   * Uses the recent swing range to determine equilibrium.
   *
   * Returns 'premium' | 'discount' | 'equilibrium'
   */
  static premiumDiscount(candles, lookback = 30) {
    if (candles.length < lookback) return 'equilibrium';
    const slice   = candles.slice(-lookback);
    const rangeHigh = Math.max(...slice.map(c => c.high));
    const rangeLow  = Math.min(...slice.map(c => c.low));
    const mid       = (rangeHigh + rangeLow) / 2;
    const current   = candles[candles.length - 1].close;
    const buffer    = (rangeHigh - rangeLow) * 0.05;  // 5% buffer around midline

    if (current > mid + buffer)  return 'premium';
    if (current < mid - buffer)  return 'discount';
    return 'equilibrium';
  }
}

// ── Signal Generator ──────────────────────────────────────────────────────────
class SignalEngine {
  constructor() {
    this.lastSignals = {};   // symbol -> { direction, ts }
    // Max possible raw score before brain bonuses.
    // Classic TA:  EMA(30) + 200EMA(5) + RSI(20) + MACD(20) + BB(10) + Stoch(5)
    //              + Volume(10) + Levels(5) + HTF(8) = 113
    // Patterns:    Engulfing(25) + PinBar(20) + RSIDiv(15) + DblTop(15) + Doji@BB(10) = 85
    // TJR / SMC:   OrderBlock(20) + FVG(15) + LiqSweep(18) + CHoCH(15) + PremDisc(8) = 76
    // New (v3):    KillZone(15) + VWAP(8) + FibOTE(18) + PO3(20) + Funding(12) + CurrStr(10) = 83
    // Total = 357 pts max (brain bonuses are additive on top of this)
    this.MAX_SCORE = 357;
  }

  // ── Core signal generator: 1m primary, 5m context, brain-weighted ──────────
  // options.timeframe: '1m' (default) | '5m' (fallback if 1m unavailable)
  async generateSignal(symbol, candles, candlesCtx = null, options = {}) {
    if (!candles || candles.length < 50) return null;

    const closes  = candles.map(c => c.close);
    const current = closes[closes.length - 1];

    // Brain weight getter — multiplies each indicator's point contribution
    // by its observed win-rate factor (0.3×–2.0×). Uses per-symbol blend when available.
    // Falls back to 1.0 if no data yet. Symbol-specific learning after 3+ outcomes.
    const w = (feature) => window.brain?.getSymbolWeight(symbol, feature) ?? window.brain?.getWeight(feature) ?? 1.0;

    // Feature tracking — we collect which indicators fired in the winning direction
    // so the brain can learn which combos actually work.
    const bullFeatures = [];
    const bearFeatures = [];

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

    const e9   = ema9.length   > 0 ? ema9[ema9.length - 1]     : current;
    const e21  = ema21.length  > 0 ? ema21[ema21.length - 1]   : current;
    const e50  = ema50.length  > 0 ? ema50[ema50.length - 1]   : current;
    const e200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;

    // ── Scoring: every component multiplied by its brain weight ────────────
    let bullScore = 0, bearScore = 0;
    const reasons = [];

    // ── EMA stack (max 30 pts × weight) ───────────────────────────────────
    if (current > e9 && e9 > e21 && e21 > e50) {
      const pts = Math.round(30 * w('ema_stack_full_bull'));
      bullScore += pts; bullFeatures.push('ema_stack_full_bull');
      reasons.push('EMA stack fully bullish (9 > 21 > 50)');
    } else if (current < e9 && e9 < e21 && e21 < e50) {
      const pts = Math.round(30 * w('ema_stack_full_bear'));
      bearScore += pts; bearFeatures.push('ema_stack_full_bear');
      reasons.push('EMA stack fully bearish (9 < 21 < 50)');
    } else if (current > e21 && e21 > e50) {
      const pts = Math.round(18 * w('ema_stack_partial_bull'));
      bullScore += pts; bullFeatures.push('ema_stack_partial_bull');
      reasons.push('Trend up: price above 21 EMA above 50 EMA');
    } else if (current < e21 && e21 < e50) {
      const pts = Math.round(18 * w('ema_stack_partial_bear'));
      bearScore += pts; bearFeatures.push('ema_stack_partial_bear');
      reasons.push('Trend down: price below 21 EMA below 50 EMA');
    } else if (e9 > e21) {
      const pts = Math.round(10 * w('ema_9_21_bull'));
      bullScore += pts; bullFeatures.push('ema_9_21_bull');
      reasons.push('Short-term momentum bullish (9 EMA > 21 EMA)');
    } else {
      const pts = Math.round(10 * w('ema_9_21_bear'));
      bearScore += pts; bearFeatures.push('ema_9_21_bear');
      reasons.push('Short-term momentum bearish (9 EMA < 21 EMA)');
    }

    // ── 200 EMA bias (max 5 pts) ──────────────────────────────────────────
    if (e200 !== null && ema200.length >= 50) {
      if (current > e200) {
        const pts = Math.round(5 * w('ema200_above'));
        bullScore += pts; bullFeatures.push('ema200_above');
        reasons.push('Price above 200 EMA — long-term uptrend');
      } else {
        const pts = Math.round(5 * w('ema200_below'));
        bearScore += pts; bearFeatures.push('ema200_below');
        reasons.push('Price below 200 EMA — long-term downtrend');
      }
    }

    // ── RSI (max 20 pts) ──────────────────────────────────────────────────
    if (rsi < 30) {
      const pts = Math.round(20 * w('rsi_oversold'));
      bullScore += pts; bullFeatures.push('rsi_oversold');
      reasons.push(`RSI oversold at ${rsi.toFixed(1)} — elevated reversal probability`);
    } else if (rsi > 70) {
      const pts = Math.round(20 * w('rsi_overbought'));
      bearScore += pts; bearFeatures.push('rsi_overbought');
      reasons.push(`RSI overbought at ${rsi.toFixed(1)} — elevated pullback probability`);
    } else if (rsi > 50 && rsi < 70) {
      const pts = Math.round(10 * w('rsi_bullzone'));
      bullScore += pts; bullFeatures.push('rsi_bullzone');
      reasons.push(`RSI bullish zone (${rsi.toFixed(1)})`);
    } else if (rsi < 50 && rsi > 30) {
      const pts = Math.round(10 * w('rsi_bearzone'));
      bearScore += pts; bearFeatures.push('rsi_bearzone');
      reasons.push(`RSI bearish zone (${rsi.toFixed(1)})`);
    }

    // ── MACD (max 20 pts) ─────────────────────────────────────────────────
    if (macdData.bullish) {
      const pts = Math.round(20 * w('macd_expand_bull'));
      bullScore += pts; bullFeatures.push('macd_expand_bull');
      reasons.push('MACD histogram expanding bullish — momentum accelerating up');
    } else if (macdData.bearish) {
      const pts = Math.round(20 * w('macd_expand_bear'));
      bearScore += pts; bearFeatures.push('macd_expand_bear');
      reasons.push('MACD histogram expanding bearish — momentum accelerating down');
    } else if (macdData.macd > 0) {
      const pts = Math.round(8 * w('macd_pos'));
      bullScore += pts; bullFeatures.push('macd_pos');
      reasons.push('MACD positive territory');
    } else {
      const pts = Math.round(8 * w('macd_neg'));
      bearScore += pts; bearFeatures.push('macd_neg');
      reasons.push('MACD negative territory');
    }

    // ── Bollinger Bands (max 10 pts) ──────────────────────────────────────
    if (bb) {
      if (current < bb.lower) {
        const pts = Math.round(10 * w('bb_at_lower'));
        bullScore += pts; bullFeatures.push('bb_at_lower');
        reasons.push('Price at lower Bollinger Band — mean reversion setup');
      } else if (current > bb.upper) {
        const pts = Math.round(10 * w('bb_at_upper'));
        bearScore += pts; bearFeatures.push('bb_at_upper');
        reasons.push('Price at upper Bollinger Band — mean reversion setup');
      } else if (current > bb.mid) {
        const pts = Math.round(4 * w('bb_above_mid'));
        bullScore += pts; bullFeatures.push('bb_above_mid');
        reasons.push('Price above Bollinger midline');
      } else {
        const pts = Math.round(4 * w('bb_below_mid'));
        bearScore += pts; bearFeatures.push('bb_below_mid');
        reasons.push('Price below Bollinger midline');
      }
    }

    // ── Stochastic (max 5 pts) ────────────────────────────────────────────
    if (stoch < 20) {
      const pts = Math.round(5 * w('stoch_oversold'));
      bullScore += pts; bullFeatures.push('stoch_oversold');
      reasons.push(`Stochastic oversold (${stoch.toFixed(1)})`);
    } else if (stoch > 80) {
      const pts = Math.round(5 * w('stoch_overbought'));
      bearScore += pts; bearFeatures.push('stoch_overbought');
      reasons.push(`Stochastic overbought (${stoch.toFixed(1)})`);
    }

    // ── Volume (max 10 pts) ───────────────────────────────────────────────
    if (vol === 'high') {
      if (bullScore >= bearScore) {
        const pts = Math.round(10 * w('volume_high'));
        bullScore += pts; bullFeatures.push('volume_high');
        reasons.push('Above-average volume confirms bullish move');
      } else {
        const pts = Math.round(10 * w('volume_high'));
        bearScore += pts; bearFeatures.push('volume_high');
        reasons.push('Above-average volume confirms bearish move');
      }
    } else if (vol === 'low') {
      reasons.push('Low volume — wait for confirmation');
    }

    // ── Key levels (max 5 pts) ────────────────────────────────────────────
    if (atr > 0) {
      const distS = Math.abs(current - levels.support)    / atr;
      const distR = Math.abs(current - levels.resistance) / atr;
      if (distS < 1.5 && current >= levels.support) {
        const pts = Math.round(5 * w('near_support'));
        bullScore += pts; bullFeatures.push('near_support');
        reasons.push(`Near swing support at ${levels.support.toFixed(4)}`);
      } else if (distR < 1.5 && current <= levels.resistance) {
        const pts = Math.round(5 * w('near_resistance'));
        bearScore += pts; bearFeatures.push('near_resistance');
        reasons.push(`Near swing resistance at ${levels.resistance.toFixed(4)}`);
      }
    }

    // ── Higher-timeframe trend alignment (max 8 pts) ───────────────────────
    // 1m signals: candlesCtx holds 5m bars  → shortTrend (EMA9/21 on 5m)
    // 5m signals: candlesCtx holds 1H bars  → shortTrend (EMA9/21 on 1H)
    const is1m     = options.timeframe === '1m';
    const is5m     = options.timeframe === '5m';
    const htfTrend = TechnicalAnalysis.shortTrend(candlesCtx);
    const htfLabel = is1m ? '5m' : (is5m ? '1H' : '4H');

    if (htfTrend) {
      if (htfTrend === 'bullish' && bullScore >= bearScore) {
        const pts = Math.round(8 * w('htf_bull'));
        bullScore += pts; bullFeatures.push('htf_bull');
        reasons.push(`${htfLabel} trend aligned bullish — multi-timeframe confluence`);
      } else if (htfTrend === 'bearish' && bearScore > bullScore) {
        const pts = Math.round(8 * w('htf_bear'));
        bearScore += pts; bearFeatures.push('htf_bear');
        reasons.push(`${htfLabel} trend aligned bearish — multi-timeframe confluence`);
      } else if (htfTrend !== 'neutral') {
        reasons.push(`Counter-trend to ${htfLabel} — reversal signal against ${htfTrend} bias`);
      }
    }

    // ── Reversal Patterns ──────────────────────────────────────────────────
    // Engulfing (25 pts) — strongest two-bar reversal signal
    const engulf = TechnicalAnalysis.engulfing(candles.slice(-3));
    if (engulf === 'bullish') {
      const pts = Math.round(25 * w('engulfing_bull'));
      bullScore += pts; bullFeatures.push('engulfing_bull');
      reasons.push('Bullish engulfing candle — buyers overwhelmed sellers decisively');
    } else if (engulf === 'bearish') {
      const pts = Math.round(25 * w('engulfing_bear'));
      bearScore += pts; bearFeatures.push('engulfing_bear');
      reasons.push('Bearish engulfing candle — sellers overwhelmed buyers decisively');
    }

    // Pin bar (20 pts) — hammer or shooting star rejection
    const pin = TechnicalAnalysis.pinBar(candles.slice(-2));
    if (pin === 'bullish') {
      const pts = Math.round(20 * w('pin_bar_bull'));
      bullScore += pts; bullFeatures.push('pin_bar_bull');
      reasons.push('Hammer pin bar — strong lower-wick rejection of bearish pressure');
    } else if (pin === 'bearish') {
      const pts = Math.round(20 * w('pin_bar_bear'));
      bearScore += pts; bearFeatures.push('pin_bar_bear');
      reasons.push('Shooting star — strong upper-wick rejection of bullish pressure');
    }

    // RSI divergence (15 pts) — momentum leading price reversal
    const div = TechnicalAnalysis.rsiDivergence(candles, 25);
    if (div === 'bullish') {
      const pts = Math.round(15 * w('rsi_div_bull'));
      bullScore += pts; bullFeatures.push('rsi_div_bull');
      reasons.push('Bullish RSI divergence — momentum recovering while price still weak');
    } else if (div === 'bearish') {
      const pts = Math.round(15 * w('rsi_div_bear'));
      bearScore += pts; bearFeatures.push('rsi_div_bear');
      reasons.push('Bearish RSI divergence — momentum fading while price still elevated');
    }

    // Double top / bottom (15 pts) — structural reversal
    const dbl = TechnicalAnalysis.doubleTopBottom(candles, atr);
    if (dbl === 'bullish') {
      const pts = Math.round(15 * w('double_bottom'));
      bullScore += pts; bullFeatures.push('double_bottom');
      reasons.push('Double bottom — price tested support twice and is now bouncing');
    } else if (dbl === 'bearish') {
      const pts = Math.round(15 * w('double_top'));
      bearScore += pts; bearFeatures.push('double_top');
      reasons.push('Double top — price failed at resistance twice and is now reversing');
    }

    // Doji at BB extreme (10 pts) — indecision at a stretched level
    if (TechnicalAnalysis.isDoji(candles.slice(-1)) && bb) {
      if (current <= bb.lower + (bb.mid - bb.lower) * 0.1) {
        const pts = Math.round(10 * w('doji_at_bb_lower'));
        bullScore += pts; bullFeatures.push('doji_at_bb_lower');
        reasons.push('Doji at lower Bollinger Band — indecision after oversold stretch');
      } else if (current >= bb.upper - (bb.upper - bb.mid) * 0.1) {
        const pts = Math.round(10 * w('doji_at_bb_upper'));
        bearScore += pts; bearFeatures.push('doji_at_bb_upper');
        reasons.push('Doji at upper Bollinger Band — indecision after overbought stretch');
      }
    }

    // BB squeeze (context annotation — brain learns directional squeeze resolution)
    const squeeze = TechnicalAnalysis.bbSqueeze(closes);
    if (squeeze) {
      reasons.push('Bollinger Band squeeze — volatility contraction, breakout imminent');
      // Only tag the currently leading direction so the brain can learn whether
      // squeezes in that direction tend to resolve profitably or not.
      if (bullScore >= bearScore) {
        bullFeatures.push('bb_squeeze');
      } else {
        bearFeatures.push('bb_squeeze');
      }
    }

    // ── TJR / Smart Money Concepts ─────────────────────────────────────────
    // Order Block (max 20 pts × strength multiplier)
    const ob = TechnicalAnalysis.orderBlock(candles, atr);
    if (ob.type === 'bullish') {
      const pts = Math.round(20 * ob.strength * w('tjr_ob_bull'));
      bullScore += pts; bullFeatures.push('tjr_ob_bull');
      reasons.push(`Bullish Order Block at ${ob.bottom.toFixed(4)}–${ob.top.toFixed(4)} — institutional demand zone`);
    } else if (ob.type === 'bearish') {
      const pts = Math.round(20 * ob.strength * w('tjr_ob_bear'));
      bearScore += pts; bearFeatures.push('tjr_ob_bear');
      reasons.push(`Bearish Order Block at ${ob.bottom.toFixed(4)}–${ob.top.toFixed(4)} — institutional supply zone`);
    }

    // Fair Value Gap (15 pts)
    const fvg = TechnicalAnalysis.fairValueGap(candles, atr);
    if (fvg.type === 'bullish') {
      const pts = Math.round(15 * w('tjr_fvg_bull'));
      bullScore += pts; bullFeatures.push('tjr_fvg_bull');
      reasons.push(`Bullish FVG ${fvg.bottom.toFixed(4)}–${fvg.top.toFixed(4)} — price retracing into imbalance`);
    } else if (fvg.type === 'bearish') {
      const pts = Math.round(15 * w('tjr_fvg_bear'));
      bearScore += pts; bearFeatures.push('tjr_fvg_bear');
      reasons.push(`Bearish FVG ${fvg.bottom.toFixed(4)}–${fvg.top.toFixed(4)} — price retracing into imbalance`);
    }

    // Liquidity Sweep (18 pts) — stop hunt then reversal
    const sweep = TechnicalAnalysis.liquiditySweep(candles, atr);
    if (sweep === 'bullish') {
      const pts = Math.round(18 * w('tjr_sweep_bull'));
      bullScore += pts; bullFeatures.push('tjr_sweep_bull');
      reasons.push('Bullish liquidity sweep — stops cleared below, smart money entering long');
    } else if (sweep === 'bearish') {
      const pts = Math.round(18 * w('tjr_sweep_bear'));
      bearScore += pts; bearFeatures.push('tjr_sweep_bear');
      reasons.push('Bearish liquidity sweep — stops cleared above, smart money entering short');
    }

    // Market Structure: CHoCH (15 pts) > BOS (10 pts)
    const ms = TechnicalAnalysis.marketStructure(candles);
    if (ms.choch === 'bullish') {
      const pts = Math.round(15 * w('tjr_choch_bull'));
      bullScore += pts; bullFeatures.push('tjr_choch_bull');
      reasons.push('CHoCH bullish — change of character, downtrend structure broken');
    } else if (ms.choch === 'bearish') {
      const pts = Math.round(15 * w('tjr_choch_bear'));
      bearScore += pts; bearFeatures.push('tjr_choch_bear');
      reasons.push('CHoCH bearish — change of character, uptrend structure broken');
    } else if (ms.bos === 'bullish') {
      const pts = Math.round(10 * w('tjr_bos_bull'));
      bullScore += pts; bullFeatures.push('tjr_bos_bull');
      reasons.push('BOS bullish — break of structure confirms uptrend continuation');
    } else if (ms.bos === 'bearish') {
      const pts = Math.round(10 * w('tjr_bos_bear'));
      bearScore += pts; bearFeatures.push('tjr_bos_bear');
      reasons.push('BOS bearish — break of structure confirms downtrend continuation');
    }

    // Premium / Discount zone (8 pts)
    const pd = TechnicalAnalysis.premiumDiscount(candles);
    if (pd === 'discount') {
      const pts = Math.round(8 * w('tjr_discount'));
      bullScore += pts; bullFeatures.push('tjr_discount');
      reasons.push('Price in discount zone (<50% of range) — TJR optimal long entry area');
    } else if (pd === 'premium') {
      const pts = Math.round(8 * w('tjr_premium'));
      bearScore += pts; bearFeatures.push('tjr_premium');
      reasons.push('Price in premium zone (>50% of range) — TJR optimal short entry area');
    }

    // ── ICT Kill Zone (max 15 pts) ─────────────────────────────────────────
    const kz = MarketData.getKillZone();
    if (kz.boost > 0) {
      if (bullScore >= bearScore) {
        const pts = Math.round(kz.boost * w('kill_zone'));
        bullScore += pts; bullFeatures.push('kill_zone');
        reasons.push(`${kz.label} — inside high-probability ICT kill zone`);
      } else {
        const pts = Math.round(kz.boost * w('kill_zone'));
        bearScore += pts; bearFeatures.push('kill_zone');
        reasons.push(`${kz.label} — inside high-probability ICT kill zone`);
      }
    }

    // ── VWAP confluence (max 8 pts) ────────────────────────────────────────
    const vwapPrice = TechnicalAnalysis.vwap(candles);
    if (vwapPrice && atr > 0) {
      const dist = (current - vwapPrice) / atr;
      if (dist > 0.2 && dist < 1.5) {
        // Price above VWAP by 0.2–1.5 ATR = bullish momentum confirmation
        const pts = Math.round(8 * w('vwap_above'));
        bullScore += pts; bullFeatures.push('vwap_above');
        reasons.push(`Price above VWAP (${vwapPrice.toFixed(4)}) — institutional buy-side bias`);
      } else if (dist < -0.2 && dist > -1.5) {
        const pts = Math.round(8 * w('vwap_below'));
        bearScore += pts; bearFeatures.push('vwap_below');
        reasons.push(`Price below VWAP (${vwapPrice.toFixed(4)}) — institutional sell-side bias`);
      }
    }

    // ── Fibonacci OTE Zone (max 18 pts) ───────────────────────────────────
    const ote = TechnicalAnalysis.fibOTE(candles, atr);
    if (ote === 'bullish') {
      const pts = Math.round(18 * w('fib_ote_bull'));
      bullScore += pts; bullFeatures.push('fib_ote_bull');
      reasons.push('Price in Fibonacci OTE zone (0.618–0.786) — optimal long entry level');
    } else if (ote === 'bearish') {
      const pts = Math.round(18 * w('fib_ote_bear'));
      bearScore += pts; bearFeatures.push('fib_ote_bear');
      reasons.push('Price in Fibonacci OTE zone (0.618–0.786) — optimal short entry level');
    }

    // ── ICT Power of 3 Distribution (max 20 pts) ──────────────────────────
    const po3 = TechnicalAnalysis.powerOfThree(candles);
    if (po3.phase === 'distribution') {
      if (po3.direction === 'bullish') {
        const pts = Math.round(20 * w('po3_bull'));
        bullScore += pts; bullFeatures.push('po3_bull');
        reasons.push('ICT Power of 3 — Judas swing complete, distribution phase bullish');
      } else if (po3.direction === 'bearish') {
        const pts = Math.round(20 * w('po3_bear'));
        bearScore += pts; bearFeatures.push('po3_bear');
        reasons.push('ICT Power of 3 — Judas swing complete, distribution phase bearish');
      }
    } else if (po3.phase === 'accumulation') {
      reasons.push('ICT PO3 accumulation phase — awaiting manipulation before entry');
    }

    // ── Crypto Funding Rate (max 12 pts) ──────────────────────────────────
    const fundingRate = options.fundingRate ?? null;
    if (fundingRate !== null) {
      const EXTREME_THRESHOLD = 0.0005;  // 0.05% per 8h = very extreme
      const HIGH_THRESHOLD    = 0.00015; // 0.015% = elevated
      if (fundingRate > EXTREME_THRESHOLD) {
        // Extremely positive = crowded longs = bears have edge
        const pts = Math.round(12 * w('funding_bear'));
        bearScore += pts; bearFeatures.push('funding_bear');
        reasons.push(`Funding rate ${(fundingRate * 100).toFixed(4)}% — extreme long crowding, short favoured`);
      } else if (fundingRate < -EXTREME_THRESHOLD) {
        // Extremely negative = crowded shorts = bulls have edge
        const pts = Math.round(12 * w('funding_bull'));
        bullScore += pts; bullFeatures.push('funding_bull');
        reasons.push(`Funding rate ${(fundingRate * 100).toFixed(4)}% — extreme short crowding, long favoured`);
      } else if (fundingRate > HIGH_THRESHOLD && bearScore > bullScore) {
        const pts = Math.round(6 * w('funding_bear'));
        bearScore += pts; bearFeatures.push('funding_bear');
        reasons.push(`Elevated positive funding — slight short bias`);
      } else if (fundingRate < -HIGH_THRESHOLD && bullScore > bearScore) {
        const pts = Math.round(6 * w('funding_bull'));
        bullScore += pts; bullFeatures.push('funding_bull');
        reasons.push(`Elevated negative funding — slight long bias`);
      }
    }

    // ── Currency Strength confluence (max 10 pts, forex only) ─────────────
    const inst = window.INSTRUMENTS?.[symbol];
    const strengths = options.currencyStrengths ?? null;
    if (strengths && inst?.type === 'forex' && atr > 0) {
      const baseCur  = inst.av || symbol.slice(0, 3);
      const quoteCur = inst.quote || symbol.slice(3, 6);
      const baseStr  = strengths[baseCur]  ?? 0;
      const quoteStr = strengths[quoteCur] ?? 0;
      const delta    = baseStr - quoteStr;  // positive = base strengthening vs quote

      if (delta > 0.05 && bullScore >= bearScore) {
        const pts = Math.round(10 * w('strength_bull'));
        bullScore += pts; bullFeatures.push('strength_bull');
        reasons.push(`${baseCur} strong vs ${quoteCur} — currency strength confirms BUY`);
      } else if (delta < -0.05 && bearScore > bullScore) {
        const pts = Math.round(10 * w('strength_bear'));
        bearScore += pts; bearFeatures.push('strength_bear');
        reasons.push(`${quoteCur} strong vs ${baseCur} — currency strength confirms SELL`);
      }
    }

    // ── News suppression — penalise if high-impact event imminent ─────────
    const newsEvents = options.newsEvents ?? [];
    const relevantNews = newsEvents.filter(e => {
      if (!inst) return e.minutesAway >= -2 && e.minutesAway <= 30;
      const cur = e.currency || '';
      return (cur === inst.av || cur === inst.quote || cur === 'USD') &&
             e.minutesAway >= -2 && e.minutesAway <= 30;
    });
    if (relevantNews.length > 0) {
      const ev = relevantNews[0];
      const penalty = ev.minutesAway <= 5 ? 25 : 12;
      bullScore -= penalty; bearScore -= penalty;  // penalise both sides
      reasons.push(`[WARN] ${ev.title} (${ev.currency}) in ~${Math.max(0, ev.minutesAway)} min — reduced confidence`);
    }

    // ── Brain bonuses (applied after all manual indicators) ────────────────
    // Determine preliminary direction before applying bonuses
    const prelim      = bullScore >= bearScore ? 'BUY' : 'SELL';
    const activeFeats = prelim === 'BUY' ? bullFeatures : bearFeatures;

    const confBonus = window.brain?.getConfluenceBonus(activeFeats) ?? 0;
    const comboBonus = window.brain?.getComboBonus(activeFeats) ?? 0;
    const fpResult   = window.brain?.getFingerprintBonus(candles, atr) ?? { bonus: 0, fp: '?' };
    const brainBonus = confBonus + comboBonus + fpResult.bonus;

    if (prelim === 'BUY') bullScore += brainBonus;
    else                  bearScore += brainBonus;

    // Log brain contribution for debugging
    if (brainBonus !== 0) {
      console.debug(`Brain bonus for ${symbol}: conf=${confBonus} combo=${comboBonus} fp=${fpResult.bonus} total=${brainBonus}`);
    }

    // ── Final decision ─────────────────────────────────────────────────────
    const direction = bullScore > bearScore ? 'BUY' : 'SELL';
    const features  = direction === 'BUY' ? bullFeatures : bearFeatures;

    // Cap raw score to MAX_SCORE before converting to %, so brain bonuses
    // can never push confidence above 100% (double-guarded by Math.min below)
    const rawScore  = Math.max(bullScore, bearScore);
    const winScore  = Math.min(rawScore, this.MAX_SCORE);

    // Learning engine manual adjustment (from WIN/LOSS buttons in journal)
    const learnAdj   = window.learningEngine?.getAdjustment(symbol, direction) || 0;
    const baseConf   = Math.round((winScore / this.MAX_SCORE) * 100);
    const confidence = Math.max(0, Math.min(100, baseConf + learnAdj));

    // Minimum threshold — 1m requires fewer indicators (less history) so threshold is 50%
    const minConf = is1m ? 50 : 55;
    if (confidence < minConf) return null;

    // ── ATR-adaptive SL/TP (tighter for 1m scalp trades) ──────────────────
    // 1m: SL 1.2× ATR → TP1 2.0× → targets hit in 3–15 min
    // 5m: SL 1.3× ATR → TP1 2.2× → targets hit in 5–25 min
    // 1H: SL 1.5× ATR → TP1 2.5× → targets hit in hours
    let slMult, tp1Mult, tp2Mult, timingHint, dedupMs;
    if (is1m) {
      slMult  = volReg === 'high' ? 1.4  : 1.2;
      tp1Mult = volReg === 'high' ? 2.3  : 2.0;
      tp2Mult = volReg === 'high' ? 3.8  : 3.2;
      timingHint = '3–15 min';
      dedupMs    = 5 * 60 * 1000;
    } else if (is5m) {
      slMult  = volReg === 'high' ? 1.6  : 1.3;
      tp1Mult = volReg === 'high' ? 2.6  : 2.2;
      tp2Mult = volReg === 'high' ? 4.0  : 3.5;
      timingHint = '5–25 min';
      dedupMs    = 15 * 60 * 1000;
    } else {
      slMult  = volReg === 'high' ? 1.8  : 1.5;
      tp1Mult = volReg === 'high' ? 2.8  : 2.5;
      tp2Mult = volReg === 'high' ? 4.5  : 4.0;
      timingHint = '15–60 min';
      dedupMs    = 45 * 60 * 1000;
    }

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

    // ── Pattern chip labels ────────────────────────────────────────────────
    const patterns = [];
    if (engulf !== 'none')        patterns.push(engulf === 'bullish' ? 'Engulfing ▲'   : 'Engulfing ▼');
    if (pin    !== 'none')        patterns.push(pin    === 'bullish' ? 'Hammer'         : 'Shooting Star');
    if (div    !== 'none')        patterns.push(div    === 'bullish' ? 'RSI Div ▲'      : 'RSI Div ▼');
    if (dbl    !== 'none')        patterns.push(dbl    === 'bullish' ? 'Dbl Bottom'     : 'Dbl Top');
    if (squeeze)                  patterns.push('BB Squeeze');
    // TJR / SMC chips
    if (ob.type  !== 'none')            patterns.push(ob.type  === 'bullish' ? 'OB ▲'         : 'OB ▼');
    if (fvg.type !== 'none')            patterns.push(fvg.type === 'bullish' ? 'FVG ▲'        : 'FVG ▼');
    if (sweep    !== 'none')            patterns.push(sweep    === 'bullish' ? 'Liq Sweep ▲'  : 'Liq Sweep ▼');
    if (ms.choch !== 'none')            patterns.push(ms.choch === 'bullish' ? 'CHoCH ▲'      : 'CHoCH ▼');
    else if (ms.bos !== 'none')         patterns.push(ms.bos   === 'bullish' ? 'BOS ▲'        : 'BOS ▼');
    if (pd !== 'equilibrium')           patterns.push(pd === 'discount' ? 'Discount'          : 'Premium');
    // New v3 chips
    if (kz.boost > 0)                   patterns.push(kz.label);
    if (ote !== 'none')                 patterns.push(ote === 'bullish' ? 'Fib OTE ▲'        : 'Fib OTE ▼');
    if (po3.phase === 'distribution')   patterns.push(po3.direction === 'bullish' ? 'PO3 ▲'  : 'PO3 ▼');
    if (po3.phase === 'accumulation')   patterns.push('PO3 Accum');
    if (relevantNews.length > 0)        patterns.push('News');

    // ── Signal object ──────────────────────────────────────────────────────
    const timeframeLabel = is1m ? '1m' : (is5m ? '5m' : '1H');
    const signal = {
      id:          `${symbol}-${direction}`,
      uid:         `${symbol}-${direction}-${Date.now()}`,
      symbol,
      display:     window.INSTRUMENTS?.[symbol]?.display || symbol,
      direction,
      confidence,
      learnAdj:    learnAdj !== 0 ? learnAdj : undefined,
      brainBonus:  brainBonus !== 0 ? brainBonus : undefined,
      features,
      fingerprint: fpResult.fp,
      patterns:    patterns.length > 0 ? patterns : undefined,
      entry:       parseFloat(entry.toFixed(5)),
      sl:          parseFloat(sl.toFixed(5)),
      tp1:         parseFloat(tp1.toFixed(5)),
      tp2:         parseFloat(tp2.toFixed(5)),
      rrRatio:     (tp1Mult / slMult).toFixed(2),
      atr:         parseFloat(atr.toFixed(5)),
      rsi:         parseFloat(rsi.toFixed(1)),
      stoch:       parseFloat(stoch.toFixed(1)),
      macd:        macdData,
      volume:      vol,
      volRegime:      volReg,
      trend4H:        htfTrend || 'none',
      killZone:       kz.boost > 0 ? kz.label : null,
      vwap:           vwapPrice ? parseFloat(vwapPrice.toFixed(5)) : null,
      fundingRate:    fundingRate,
      reasons:        reasons.slice(0, 10),
      timestamp:      new Date(),
      simulated:      candles[0]?.simulated || false,
      timeframe:      timeframeLabel,
      timingHint,
      previewCandles: candles.slice(-40),  // for mini chart rendering
    };

    // ── Deduplicate ────────────────────────────────────────────────────────
    const last = this.lastSignals[symbol];
    if (last && last.direction === direction && Date.now() - last.ts < dedupMs) {
      // If entry repriced by more than 0.5× ATR since last signal, treat as fresh
      // so the trader sees and is notified about the updated entry price.
      const repriced = last.entry != null && Math.abs(entry - last.entry) > atr * 0.5;
      if (!repriced) return { ...signal, refreshed: true };
    }
    this.lastSignals[symbol] = { direction, ts: Date.now(), entry };
    return signal;
  }

  // ── Batch scan — crypto in parallel, forex/futures in small batches ────────
  async scanAll(symbols) {
    // Pre-fetch shared context once per scan cycle (reduces API calls)
    const [currencyStrengths, newsEvents] = await Promise.all([
      window.marketData.getCurrencyStrengths().catch(() => null),
      window.marketData.getUpcomingHighImpactEvents().catch(() => []),
    ]);
    const sharedCtx = { currencyStrengths, newsEvents };

    if (newsEvents.length > 0) {
      console.log(`Brain: ${newsEvents.length} high-impact news event(s) upcoming:`,
        newsEvents.map(e => `${e.title} (${e.currency}) in ${e.minutesAway}min`).join(', '));
    }

    const results = [];
    const cryptos = symbols.filter(s => window.INSTRUMENTS?.[s]?.type === 'crypto');
    const others  = symbols.filter(s => window.INSTRUMENTS?.[s]?.type !== 'crypto');

    const cryptoSettled = await Promise.allSettled(cryptos.map(s => this._scanOne(s, sharedCtx)));
    for (const o of cryptoSettled) {
      if (o.status === 'fulfilled' && o.value) results.push(o.value);
    }

    const BATCH = 3;
    for (let i = 0; i < others.length; i += BATCH) {
      const batch   = others.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(s => this._scanOne(s, sharedCtx)));
      for (const o of settled) {
        if (o.status === 'fulfilled' && o.value) results.push(o.value);
      }
      if (i + BATCH < others.length) await new Promise(r => setTimeout(r, 600));
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  // ── Scan one symbol: 1m primary + 5m context + all enrichment data ────────
  // 300 bars × 1m = 5 hours of 1m data — sufficient for all indicators.
  // 5m context (aggregated from 1m) provides HTF trend confirmation.
  // Funding rate, currency strengths, news events, and kill zone are fetched
  // once per scan cycle and injected via options to avoid redundant API calls.
  async _scanOne(sym, sharedCtx = {}) {
    try {
      const candles1m = await window.marketData.getCandles(sym, '1m', 300);
      if (!candles1m || candles1m.length < 50) return null;

      // Aggregate 5m bars from 1m for higher-timeframe context (no extra API call)
      const candles5m = window.marketData._aggregate1mto5m(candles1m, 60);

      // Funding rate — only for crypto
      const fundingRate = window.INSTRUMENTS?.[sym]?.type === 'crypto'
        ? await window.marketData.getFundingRate(sym).catch(() => null)
        : null;

      return await this.generateSignal(sym, candles1m, candles5m, {
        timeframe:         '1m',
        fundingRate,
        currencyStrengths: sharedCtx.currencyStrengths ?? null,
        newsEvents:        sharedCtx.newsEvents        ?? [],
      });
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
