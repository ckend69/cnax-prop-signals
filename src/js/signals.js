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
    const buffer    = (rangeHigh - rangeLow) * 0.05;

    if (current > mid + buffer)  return 'premium';
    if (current < mid - buffer)  return 'discount';
    return 'equilibrium';
  }

  // ── ADX — Average Directional Index (trend strength + direction) ───────────
  // ADX measures how STRONG the trend is (regardless of direction).
  // +DI > -DI = uptrend. -DI > +DI = downtrend. ADX < 20 = ranging/weak.
  // Uses Wilder smoothing (same as ATR). Returns { adx, pdi, ndi }.
  static adx(candles, period = 14) {
    if (candles.length < period * 2 + 1) return { adx: 0, pdi: 0, ndi: 0 };
    const dms = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      const upMove   = c.high - p.high;
      const downMove = p.low  - c.low;
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      dms.push({
        pdm: upMove > downMove && upMove > 0 ? upMove : 0,
        ndm: downMove > upMove && downMove > 0 ? downMove : 0,
        tr,
      });
    }
    // Wilder smoothed sums
    let sPDM = dms.slice(0, period).reduce((a, d) => a + d.pdm, 0);
    let sNDM = dms.slice(0, period).reduce((a, d) => a + d.ndm, 0);
    let sTR  = dms.slice(0, period).reduce((a, d) => a + d.tr,  0);
    const dxArr = [];
    for (let i = period; i < dms.length; i++) {
      sPDM = sPDM - sPDM / period + dms[i].pdm;
      sNDM = sNDM - sNDM / period + dms[i].ndm;
      sTR  = sTR  - sTR  / period + dms[i].tr;
      if (sTR === 0) continue;
      const pdi = (sPDM / sTR) * 100;
      const ndi = (sNDM / sTR) * 100;
      const dx  = (pdi + ndi) > 0 ? Math.abs(pdi - ndi) / (pdi + ndi) * 100 : 0;
      dxArr.push({ pdi, ndi, dx });
    }
    if (dxArr.length < period) return { adx: 0, pdi: 0, ndi: 0 };
    let adxVal = dxArr.slice(0, period).reduce((a, d) => a + d.dx, 0) / period;
    for (let i = period; i < dxArr.length; i++) adxVal = (adxVal * (period - 1) + dxArr[i].dx) / period;
    const last = dxArr[dxArr.length - 1];
    return { adx: parseFloat(adxVal.toFixed(2)), pdi: parseFloat(last.pdi.toFixed(2)), ndi: parseFloat(last.ndi.toFixed(2)) };
  }

  // ── Supertrend — dynamic trailing support/resistance ──────────────────────
  // Above supertrend = bullish regime. Below = bearish. Widely used by prop traders.
  // Returns { direction: 'bullish'|'bearish', level }
  static supertrend(candles, period = 10, multiplier = 3.0) {
    if (candles.length < period + 5) return { direction: 'none', level: null };
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const atrs = [atr];
    for (let i = period; i < trs.length; i++) { atr = (atr * (period - 1) + trs[i]) / period; atrs.push(atr); }

    let upperBand = 0, lowerBand = 0, prevDir = 1, prevST = null;
    // atrs[i] is the EMA-ATR at candle index (period + i); use correct offsets throughout.
    for (let i = 0; i < atrs.length; i++) {
      const ci  = candles[period + i];                 // current bar for this ATR value
      const hl2 = (ci.high + ci.low) / 2;
      const bUp  = hl2 + multiplier * atrs[i];
      const bLow = hl2 - multiplier * atrs[i];
      if (prevST === null) {
        // First bar: initialise bands directly (no previous close to compare against).
        upperBand = bUp;
        lowerBand = bLow;
      } else {
        const prevClose = candles[period + i - 1].close;
        upperBand = (bUp < upperBand || prevClose > upperBand) ? bUp : upperBand;
        lowerBand = (bLow > lowerBand || prevClose < lowerBand) ? bLow : lowerBand;
      }
      const dir  = (prevST === null || prevDir === -1) ? (ci.close <= upperBand ? -1 : 1)
                                                       : (ci.close >= lowerBand ?  1 : -1);
      prevST  = dir === 1 ? lowerBand : upperBand;
      prevDir = dir;
    }
    return { direction: prevDir === 1 ? 'bullish' : 'bearish', level: prevST };
  }

  // ── Pivot Points (classic) — institutional daily S/R levels ───────────────
  // Uses first 60% of candles as the "prior period" to compute pivot, R1/R2/S1/S2.
  // These are widely watched by institutions and floor traders.
  static pivotPoints(candles) {
    if (candles.length < 30) return null;
    const prev = candles.slice(0, Math.floor(candles.length * 0.6));
    const H  = Math.max(...prev.map(c => c.high));
    const L  = Math.min(...prev.map(c => c.low));
    const C  = prev[prev.length - 1].close;
    const P  = (H + L + C) / 3;
    return { P, R1: 2*P - L, R2: P + (H - L), S1: 2*P - H, S2: P - (H - L) };
  }

  // ── OBV — On-Balance Volume + divergence detection ────────────────────────
  // OBV accumulates volume on up-bars and subtracts on down-bars.
  // Divergence: price makes new extreme but OBV doesn't confirm = smart money disagreeing.
  static obv(candles) {
    if (candles.length < 5) return [];
    const result = [0];
    for (let i = 1; i < candles.length; i++) {
      const prev = result[result.length - 1];
      const vol  = candles[i].volume || 1;
      if      (candles[i].close > candles[i-1].close) result.push(prev + vol);
      else if (candles[i].close < candles[i-1].close) result.push(prev - vol);
      else                                              result.push(prev);
    }
    return result;
  }

  static obvDivergence(candles, lookback = 25) {
    const obvArr = this.obv(candles);
    if (obvArr.length < lookback + 5) return 'none';
    const prices     = candles.map(c => c.close);
    const priceSlice = prices.slice(-lookback);
    const obvSlice   = obvArr.slice(-lookback);
    const half       = Math.floor(lookback / 2);
    const priceLow   = Math.min(...priceSlice.slice(-half));
    const priceLowOld= Math.min(...priceSlice.slice(0, half));
    const priceHigh  = Math.max(...priceSlice.slice(-half));
    const priceHighOld=Math.max(...priceSlice.slice(0, half));
    const obvLow     = Math.min(...obvSlice.slice(-half));
    const obvLowOld  = Math.min(...obvSlice.slice(0, half));
    const obvHigh    = Math.max(...obvSlice.slice(-half));
    const obvHighOld = Math.max(...obvSlice.slice(0, half));
    // Bullish: price lower low but OBV higher low = accumulation underway
    if (priceLow < priceLowOld * 0.9999 && obvLow > obvLowOld) return 'bullish';
    // Bearish: price higher high but OBV lower high = distribution underway
    if (priceHigh > priceHighOld * 1.0001 && obvHigh < obvHighOld) return 'bearish';
    return 'none';
  }

  // ── Ichimoku Cloud ─────────────────────────────────────────────────────────
  // The cloud (Kumo) acts as dynamic support/resistance with institutional weight.
  // Tenkan/Kijun cross is the primary entry signal. Cloud position is the bias filter.
  // Returns null if not enough data (needs 52+ bars).
  static ichimoku(candles) {
    if (candles.length < 52) return null;
    const rangeHL = (n) => {
      const sl = candles.slice(-n);
      return { h: Math.max(...sl.map(c => c.high)), l: Math.min(...sl.map(c => c.low)) };
    };
    const t9  = rangeHL(9);
    const k26 = rangeHL(26);
    const s52 = rangeHL(52);
    const tenkan  = (t9.h  + t9.l)  / 2;   // Conversion line (fast)
    const kijun   = (k26.h + k26.l) / 2;   // Base line (slow)
    const senkouA = (tenkan + kijun) / 2;   // Cloud top/bottom A
    const senkouB = (s52.h  + s52.l) / 2;  // Cloud top/bottom B
    const cur     = candles[candles.length - 1].close;
    const cloudHi = Math.max(senkouA, senkouB);
    const cloudLo = Math.min(senkouA, senkouB);
    return {
      tenkan, kijun, senkouA, senkouB,
      aboveCloud:  cur > cloudHi,
      belowCloud:  cur < cloudLo,
      inCloud:     cur >= cloudLo && cur <= cloudHi,
      tkBull:      tenkan > kijun,   // Tenkan crossed above Kijun
      tkBear:      tenkan < kijun,
    };
  }

  // ── Williams %R ──────────────────────────────────────────────────────────
  // Oscillator in range [-100, 0]. Below -80 = oversold, above -20 = overbought.
  // Confirms or contradicts RSI/Stochastic for overbought/oversold conditions.
  static williamsR(candles, period = 14) {
    if (candles.length < period) return -50;
    const slice  = candles.slice(-period);
    const highMax = Math.max(...slice.map(c => c.high));
    const lowMin  = Math.min(...slice.map(c => c.low));
    const last    = candles[candles.length - 1].close;
    if (highMax === lowMin) return -50;
    return ((highMax - last) / (highMax - lowMin)) * -100;
  }
}

// ── Signal Generator ──────────────────────────────────────────────────────────
class SignalEngine {
  constructor() {
    this.lastSignals = {};   // symbol -> { direction, ts }
    // Max possible raw score before brain bonuses.
    // Classic TA:  EMA(30) + 200EMA(5) + RSI(20) + MACD(20) + BB(10) + Stoch(5)
    //              + Volume(10) + Levels(5) + HTF(8) + WilliamsR(5) = 118
    // Patterns:    Engulfing(25) + PinBar(20) + RSIDiv(15) + DblTop(15) + Doji@BB(10) = 85
    // TJR / SMC:   OrderBlock(20) + FVG(15) + LiqSweep(18) + CHoCH(15) + PremDisc(8) = 76
    // v3:          KillZone(15) + VWAP(8) + FibOTE(18) + PO3(20) + Funding(12) + CurrStr(10) = 83
    // Aletheia:    ShortSqueeze(12) + Insider(8) + GoldCross(10) + 52wk(8) + Instit(6) = 44
    // New (v4):    ADX(20) + Supertrend(12) + Pivots(12) + OBV Div(15) + Ichimoku(18) = 77
    // Sentiment:   FearGreed(12) + OpenInterest(10) + LongShortRatio(10) = 32
    // ── MAX_SCORE calibrated so realistic strong setups land 70-90% ─────────
    // Theoretical absolute max ~515 pts — no real signal ever fires all at once.
    // 260 keeps percentages meaningful:
    //   Moderate (100-130 pts) → 38-50%  |  Good (160-200) → 62-77%  |  Great (200+) → 77-100%
    this.MAX_SCORE = 260;
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

    // ── Williams %R (max 5 pts) — second oscillator confirmation ─────────
    const willR = TechnicalAnalysis.williamsR(candles, 14);
    if (willR < -80) {
      const pts = Math.round(5 * w('willr_oversold'));
      bullScore += pts; bullFeatures.push('willr_oversold');
      reasons.push(`Williams %R oversold (${willR.toFixed(1)}) — triple oscillator confluence`);
    } else if (willR > -20) {
      const pts = Math.round(5 * w('willr_overbought'));
      bearScore += pts; bearFeatures.push('willr_overbought');
      reasons.push(`Williams %R overbought (${willR.toFixed(1)}) — triple oscillator confluence`);
    }

    // ── ADX — Trend Strength + Direction (max 20 pts) ─────────────────────
    // ADX < 20: ranging market → suppress weak signals to reduce false entries
    // ADX ≥ 25 + directional confirmation = significant trend bonus
    const adxData = TechnicalAnalysis.adx(candles, 14);
    if (adxData.adx < 20 && adxData.adx > 0) {
      // Ranging market: penalise both sides equally so minConf filters weak setups
      const penalty = Math.round(8 * (1 - adxData.adx / 20));
      bullScore -= penalty; bearScore -= penalty;
      reasons.push(`ADX ${adxData.adx.toFixed(1)} — ranging/weak trend, reduced confidence`);
    } else if (adxData.adx >= 25) {
      const strong = adxData.adx >= 35;
      if (adxData.pdi > adxData.ndi && bullScore >= bearScore) {
        const pts = Math.round((strong ? 20 : 12) * w('adx_trend_bull'));
        bullScore += pts; bullFeatures.push('adx_trend_bull');
        reasons.push(`ADX ${adxData.adx.toFixed(1)} — ${strong ? 'strong' : 'confirmed'} uptrend (+DI ${adxData.pdi.toFixed(1)} > -DI ${adxData.ndi.toFixed(1)})`);
      } else if (adxData.ndi > adxData.pdi && bearScore > bullScore) {
        const pts = Math.round((strong ? 20 : 12) * w('adx_trend_bear'));
        bearScore += pts; bearFeatures.push('adx_trend_bear');
        reasons.push(`ADX ${adxData.adx.toFixed(1)} — ${strong ? 'strong' : 'confirmed'} downtrend (-DI ${adxData.ndi.toFixed(1)} > +DI ${adxData.pdi.toFixed(1)})`);
      }
    }

    // ── Supertrend (max 12 pts) — dynamic trailing support/resistance ────
    const st = TechnicalAnalysis.supertrend(candles, 10, 3.0);
    if (st.direction === 'bullish' && bullScore >= bearScore) {
      const pts = Math.round(12 * w('supertrend_bull'));
      bullScore += pts; bullFeatures.push('supertrend_bull');
      reasons.push(`Supertrend bullish — price above dynamic support ${st.level?.toFixed(4) ?? ''}`);
    } else if (st.direction === 'bearish' && bearScore > bullScore) {
      const pts = Math.round(12 * w('supertrend_bear'));
      bearScore += pts; bearFeatures.push('supertrend_bear');
      reasons.push(`Supertrend bearish — price below dynamic resistance ${st.level?.toFixed(4) ?? ''}`);
    }

    // ── Pivot Points (max 12 pts) — institutional S/R levels ─────────────
    // Classic daily pivot levels watched by floor traders and institutional desks.
    const pivots = TechnicalAnalysis.pivotPoints(candles);
    if (pivots && atr > 0) {
      const distS1 = Math.abs(current - pivots.S1) / atr;
      const distS2 = Math.abs(current - pivots.S2) / atr;
      const distR1 = Math.abs(current - pivots.R1) / atr;
      const distR2 = Math.abs(current - pivots.R2) / atr;
      if ((distS1 < 1.2 || distS2 < 1.2) && bullScore >= bearScore) {
        const useS2 = distS2 < distS1;
        const pts   = Math.round((useS2 ? 12 : 8) * w('pivot_support'));
        bullScore += pts; bullFeatures.push('pivot_support');
        reasons.push(`Near pivot ${useS2 ? 'S2' : 'S1'} at ${(useS2 ? pivots.S2 : pivots.S1).toFixed(4)} — institutional support level`);
      } else if ((distR1 < 1.2 || distR2 < 1.2) && bearScore > bullScore) {
        const useR2 = distR2 < distR1;
        const pts   = Math.round((useR2 ? 12 : 8) * w('pivot_resistance'));
        bearScore += pts; bearFeatures.push('pivot_resistance');
        reasons.push(`Near pivot ${useR2 ? 'R2' : 'R1'} at ${(useR2 ? pivots.R2 : pivots.R1).toFixed(4)} — institutional resistance level`);
      }
    }

    // ── OBV Divergence (max 15 pts) — volume confirms or contradicts price ─
    // Smart money disagreement with price = the single most reliable divergence.
    const obvDiv = TechnicalAnalysis.obvDivergence(candles, 25);
    if (obvDiv === 'bullish') {
      const pts = Math.round(15 * w('obv_div_bull'));
      bullScore += pts; bullFeatures.push('obv_div_bull');
      reasons.push('Bullish OBV divergence — volume accumulating while price falls (smart money buying)');
    } else if (obvDiv === 'bearish') {
      const pts = Math.round(15 * w('obv_div_bear'));
      bearScore += pts; bearFeatures.push('obv_div_bear');
      reasons.push('Bearish OBV divergence — volume distributing while price rises (smart money selling)');
    }

    // ── Ichimoku Cloud (max 18 pts) — institutional trend framework ────────
    // Cloud position = macro bias (10 pts). Tenkan/Kijun cross = timing signal (8 pts).
    const ichi = TechnicalAnalysis.ichimoku(candles);
    if (ichi) {
      if (ichi.aboveCloud) {
        const pts = Math.round(10 * w('ichimoku_cloud_bull'));
        bullScore += pts; bullFeatures.push('ichimoku_cloud_bull');
        reasons.push('Price above Ichimoku cloud (Kumo) — strong bullish macro bias');
      } else if (ichi.belowCloud) {
        const pts = Math.round(10 * w('ichimoku_cloud_bear'));
        bearScore += pts; bearFeatures.push('ichimoku_cloud_bear');
        reasons.push('Price below Ichimoku cloud (Kumo) — strong bearish macro bias');
      } else {
        reasons.push('Price inside Ichimoku cloud — indecision zone, lower conviction');
      }
      if (ichi.tkBull && (ichi.aboveCloud || bullScore >= bearScore)) {
        const pts = Math.round(8 * w('ichimoku_tk_bull'));
        bullScore += pts; bullFeatures.push('ichimoku_tk_bull');
        reasons.push('Ichimoku Tenkan > Kijun — short-term momentum turned bullish');
      } else if (ichi.tkBear && (ichi.belowCloud || bearScore > bullScore)) {
        const pts = Math.round(8 * w('ichimoku_tk_bear'));
        bearScore += pts; bearFeatures.push('ichimoku_tk_bear');
        reasons.push('Ichimoku Tenkan < Kijun — short-term momentum turned bearish');
      }
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

    // BB squeeze (annotation only — brain learns this as a context feature)
    const squeeze = TechnicalAnalysis.bbSqueeze(closes);
    if (squeeze) {
      reasons.push('Bollinger Band squeeze — volatility contraction, breakout imminent');
      // Add to both feature lists so brain learns which direction squeezes resolve
      bullFeatures.push('bb_squeeze'); bearFeatures.push('bb_squeeze');
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

    // ── Fear & Greed Index (max 12 pts, crypto only) ──────────────────────
    // alternative.me Fear & Greed: 0=Extreme Fear, 100=Extreme Greed
    // Extreme readings are strong contrarian signals for crypto.
    const fearGreed = options.fearGreed ?? null;
    if (fearGreed && inst?.type === 'crypto') {
      const fgv = fearGreed.value;
      if (fgv <= 15) {
        const pts = Math.round(12 * w('fear_greed_fear'));
        bullScore += pts; bullFeatures.push('fear_greed_fear');
        reasons.push(`Extreme Fear (${fgv}/100) — historically strong contrarian crypto buy signal`);
      } else if (fgv >= 85) {
        const pts = Math.round(12 * w('fear_greed_greed'));
        bearScore += pts; bearFeatures.push('fear_greed_greed');
        reasons.push(`Extreme Greed (${fgv}/100) — historically strong contrarian crypto sell signal`);
      } else if (fgv <= 30 && bullScore >= bearScore) {
        const pts = Math.round(6 * w('fear_greed_fear'));
        bullScore += pts; bullFeatures.push('fear_greed_fear');
        reasons.push(`Fear sentiment (${fgv}/100) — supportive of long crypto positions`);
      } else if (fgv >= 70 && bearScore > bullScore) {
        const pts = Math.round(6 * w('fear_greed_greed'));
        bearScore += pts; bearFeatures.push('fear_greed_greed');
        reasons.push(`Greed sentiment (${fgv}/100) — supportive of short crypto positions`);
      }
    }

    // ── Open Interest (max 10 pts, crypto only) ────────────────────────────
    // Rising OI + trend direction = fresh money entering = strong conviction signal.
    // Falling OI = position unwinding = weakening trend, penalty applied.
    const oiData = options.openInterest ?? null;
    if (oiData && inst?.type === 'crypto') {
      const { oiChange } = oiData;
      if (oiChange > 0.015 && bullScore >= bearScore) {
        const pts = Math.round(10 * w('oi_rising_bull'));
        bullScore += pts; bullFeatures.push('oi_rising_bull');
        reasons.push(`Open interest +${(oiChange * 100).toFixed(1)}% — fresh capital entering longs (strong conviction)`);
      } else if (oiChange > 0.015 && bearScore > bullScore) {
        const pts = Math.round(10 * w('oi_rising_bear'));
        bearScore += pts; bearFeatures.push('oi_rising_bear');
        reasons.push(`Open interest +${(oiChange * 100).toFixed(1)}% — fresh capital entering shorts (strong conviction)`);
      } else if (oiChange < -0.015) {
        bullScore -= 5; bearScore -= 5;
        reasons.push(`Open interest ${(oiChange * 100).toFixed(1)}% — positions unwinding, reduced conviction`);
      }
    }

    // ── Long/Short Ratio (max 10 pts, crypto only) ─────────────────────────
    // Extreme retail crowding is a strong contrarian indicator.
    // >70% longs = everyone is long = short squeeze fuel exhausted = bearish.
    // <30% longs = everyone is short = short covering rally likely = bullish.
    const lsRatio = options.lsRatio ?? null;
    if (lsRatio !== null && inst?.type === 'crypto') {
      if (lsRatio < 0.30 && bullScore >= bearScore) {
        const pts = Math.round(10 * w('ls_ratio_bull'));
        bullScore += pts; bullFeatures.push('ls_ratio_bull');
        reasons.push(`${(lsRatio * 100).toFixed(0)}% longs — extreme short crowding, contrarian long bias`);
      } else if (lsRatio > 0.70 && bearScore > bullScore) {
        const pts = Math.round(10 * w('ls_ratio_bear'));
        bearScore += pts; bearFeatures.push('ls_ratio_bear');
        reasons.push(`${(lsRatio * 100).toFixed(0)}% longs — extreme long crowding, contrarian short bias`);
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
      reasons.push(`⚠ ${ev.title} (${ev.currency}) in ~${Math.max(0, ev.minutesAway)} min — reduced confidence`);
    }

    // ── Aletheia Fundamental Context ──────────────────────────────────────
    // Adds institutional/fundamental signals not available from price data alone.
    // Requires aletheiaKey set in settings. Gracefully no-ops if unavailable.
    const aletheiaData = options.aletheiaData ?? null;
    if (aletheiaData) {
      if (aletheiaData.type === 'stock') {
        // Short float squeeze (max 12 pts): very high short interest + bullish = squeeze fuel
        const sf = aletheiaData.shortFloat || 0;
        if (sf > 0.15 && bullScore >= bearScore) {
          const pts = Math.round(12 * w('aletheia_short_squeeze'));
          bullScore += pts; bullFeatures.push('aletheia_short_squeeze');
          reasons.push(`Short float ${(sf * 100).toFixed(1)}% — elevated short squeeze potential`);
        } else if (sf > 0.08 && bearScore > bullScore) {
          const pts = Math.round(6 * w('aletheia_short_crowd'));
          bearScore += pts; bearFeatures.push('aletheia_short_crowd');
          reasons.push(`Short float ${(sf * 100).toFixed(1)}% — crowded short positioning`);
        }

        // Insider ownership (max 8 pts): high insider % = management confidence in upside
        const ip = aletheiaData.insiderPct || 0;
        if (ip > 0.05 && bullScore >= bearScore) {
          const pts = Math.round(8 * w('aletheia_insider'));
          bullScore += pts; bullFeatures.push('aletheia_insider');
          reasons.push(`Insider ownership ${(ip * 100).toFixed(1)}% — management aligned with upside`);
        }

        // 50/200-day MA cross (max 10 pts): institutional trend confirmation
        const { ma50, ma200 } = aletheiaData;
        if (ma50 && ma200 && ma50 > 0 && ma200 > 0) {
          if (ma50 > ma200) {
            if (bullScore >= bearScore) {
              const pts = Math.round(10 * w('aletheia_golden_cross'));
              bullScore += pts; bullFeatures.push('aletheia_golden_cross');
              reasons.push(`ETF 50-day MA > 200-day MA — institutional golden cross context`);
            }
          } else {
            if (bearScore > bullScore) {
              const pts = Math.round(10 * w('aletheia_death_cross'));
              bearScore += pts; bearFeatures.push('aletheia_death_cross');
              reasons.push(`ETF 50-day MA < 200-day MA — institutional death cross context`);
            }
          }
        }

        // 52-week range positioning (max 8 pts): mean-reversion from extremes
        const { yearHigh: yH, yearLow: yL } = aletheiaData;
        if (yH && yL && yH > yL) {
          const pctOfRange = (current - yL) / (yH - yL);
          if (pctOfRange < 0.15 && bullScore >= bearScore) {
            const pts = Math.round(8 * w('aletheia_52wk_low'));
            bullScore += pts; bullFeatures.push('aletheia_52wk_low');
            reasons.push(`ETF near 52-week low (bottom ${(pctOfRange * 100).toFixed(0)}% of range) — deep value zone`);
          } else if (pctOfRange > 0.85 && bearScore > bullScore) {
            const pts = Math.round(8 * w('aletheia_52wk_high'));
            bearScore += pts; bearFeatures.push('aletheia_52wk_high');
            reasons.push(`ETF near 52-week high (top ${((1 - pctOfRange) * 100).toFixed(0)}% of range) — extended zone`);
          }
        }

        // Institutional ownership (max 6 pts): high institution % = strong-hand backing
        const instPct = aletheiaData.institutionPct || 0;
        if (instPct > 0.65 && bullScore >= bearScore) {
          const pts = Math.round(6 * w('aletheia_institution'));
          bullScore += pts; bullFeatures.push('aletheia_institution');
          reasons.push(`${(instPct * 100).toFixed(0)}% institutional ownership — strong-hand backing supports longs`);
        }

        // Beta-scaled signal (informational): high beta in trending market amplifies moves
        // High beta (>1.5) = more volatile → widen stops implicitly via the ATR calculation.
        // We add a small bonus when beta confirms the trend direction (high beta in strong ADX)
        const beta = aletheiaData.beta || 1;
        if (beta > 1.4 && adxData.adx >= 25) {
          if (bullScore >= bearScore) {
            const pts = Math.round(4 * w('aletheia_high_beta'));
            bullScore += pts; bullFeatures.push('aletheia_high_beta');
            reasons.push(`Beta ${beta.toFixed(2)} — high-beta instrument amplifies upside in strong trend (ADX ${adxData.adx.toFixed(1)})`);
          } else {
            const pts = Math.round(4 * w('aletheia_high_beta'));
            bearScore += pts; bearFeatures.push('aletheia_high_beta');
            reasons.push(`Beta ${beta.toFixed(2)} — high-beta instrument amplifies downside in strong trend`);
          }
        }
      }

      if (aletheiaData.type === 'crypto') {
        // 52-week range for crypto (max 8 pts): historical support/resistance awareness
        const { yearHigh: yH, yearLow: yL } = aletheiaData;
        if (yH && yL && yH > yL) {
          const pctOfRange = (current - yL) / (yH - yL);
          if (pctOfRange < 0.20 && bullScore >= bearScore) {
            const pts = Math.round(8 * w('aletheia_crypto_52wk_low'));
            bullScore += pts; bullFeatures.push('aletheia_crypto_52wk_low');
            reasons.push(`Crypto near 52-week low (${(pctOfRange * 100).toFixed(0)}% of range) — historically strong support`);
          } else if (pctOfRange > 0.80 && bearScore > bullScore) {
            const pts = Math.round(8 * w('aletheia_crypto_52wk_high'));
            bearScore += pts; bearFeatures.push('aletheia_crypto_52wk_high');
            reasons.push(`Crypto near 52-week high (${(pctOfRange * 100).toFixed(0)}% of range) — historically strong resistance`);
          }
        }
      }
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
    const winScore  = Math.max(bullScore, bearScore);
    const direction = bullScore > bearScore ? 'BUY' : 'SELL';
    const features  = direction === 'BUY' ? bullFeatures : bearFeatures;

    // Learning engine manual adjustment (from WIN/LOSS buttons in journal)
    const learnAdj   = window.learningEngine?.getAdjustment(symbol, direction) || 0;
    const baseConf   = Math.round((winScore / this.MAX_SCORE) * 100);
    const confidence = Math.max(0, Math.min(100, baseConf + learnAdj));

    // Minimum threshold — internal gate before UI-level minConf filter
    // 1m needs fewer historical bars so we allow a lower floor.
    // With MAX_SCORE=200: 38% = 76 pts (3-4 indicators), 45% = 90 pts (several aligning).
    const minConf = is1m ? 38 : 45;
    if (confidence < minConf) return null;

    // ── ATR-adaptive SL/TP — fixed 2:1 min R:R (TP1) and 3:1 max R:R (TP2) ──
    // TP1 is always exactly 2× the SL distance → R:R = 2.00
    // TP2 is always exactly 3× the SL distance → R:R = 3.00
    // SL multiplier scales with timeframe and volatility regime only.
    let slMult, tp1Mult, tp2Mult, timingHint, dedupMs;
    if (is1m) {
      slMult  = volReg === 'high' ? 1.4  : 1.2;
      tp1Mult = slMult * 2;   // 2:1 R:R minimum
      tp2Mult = slMult * 3;   // 3:1 R:R maximum
      timingHint = '3–15 min';
      dedupMs    = 5 * 60 * 1000;
    } else if (is5m) {
      slMult  = volReg === 'high' ? 1.6  : 1.3;
      tp1Mult = slMult * 2;   // 2:1 R:R minimum
      tp2Mult = slMult * 3;   // 3:1 R:R maximum
      timingHint = '5–25 min';
      dedupMs    = 15 * 60 * 1000;
    } else {
      slMult  = volReg === 'high' ? 1.8  : 1.5;
      tp1Mult = slMult * 2;   // 2:1 R:R minimum
      tp2Mult = slMult * 3;   // 3:1 R:R maximum
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
    if (relevantNews.length > 0)        patterns.push('⚠ News');
    // v4 new indicator chips
    if (adxData.adx >= 25) patterns.push(`ADX ${adxData.adx.toFixed(0)}`);
    if (st.direction !== 'none') patterns.push(st.direction === 'bullish' ? 'Supertrend ▲' : 'Supertrend ▼');
    if (obvDiv !== 'none')      patterns.push(obvDiv === 'bullish' ? 'OBV Div ▲' : 'OBV Div ▼');
    if (ichi) {
      if (ichi.aboveCloud)  patterns.push('Kumo ▲');
      else if (ichi.belowCloud) patterns.push('Kumo ▼');
    }
    if (fearGreed && fearGreed.value <= 20) patterns.push('😨 Extreme Fear');
    else if (fearGreed && fearGreed.value >= 80) patterns.push('🤑 Extreme Greed');
    if (oiData && oiData.oiChange > 0.015) patterns.push('OI Rising ↑');
    // Aletheia chips
    if (aletheiaData?.type === 'stock') {
      if ((aletheiaData.shortFloat || 0) > 0.15 && direction === 'BUY') patterns.push('Short Squeeze ⚡');
      if (aletheiaData.ma50 && aletheiaData.ma200) {
        if (aletheiaData.ma50 > aletheiaData.ma200 && direction === 'BUY')  patterns.push('Golden Cross');
        if (aletheiaData.ma50 < aletheiaData.ma200 && direction === 'SELL') patterns.push('Death Cross');
      }
    }

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
      return { ...signal, refreshed: true };
    }
    this.lastSignals[symbol] = { direction, ts: Date.now() };
    return signal;
  }

  // ── Batch scan — crypto in parallel, forex/futures in small batches ────────
  async scanAll(symbols) {
    // Pre-fetch shared context once per scan cycle (reduces API calls)
    // Fetch shared context once per cycle (Fear & Greed is global, not per-symbol)
    const [currencyStrengths, newsEvents, fearGreed] = await Promise.all([
      window.marketData.getCurrencyStrengths().catch(() => null),
      window.marketData.getUpcomingHighImpactEvents().catch(() => []),
      window.marketData.getFearGreedIndex?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    const sharedCtx = { currencyStrengths, newsEvents, fearGreed };

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

    const BATCH = 5;
    for (let i = 0; i < others.length; i += BATCH) {
      const batch   = others.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(s => this._scanOne(s, sharedCtx)));
      for (const o of settled) {
        if (o.status === 'fulfilled' && o.value) results.push(o.value);
      }
      if (i + BATCH < others.length) await new Promise(r => setTimeout(r, 400));
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

      const isCrypto = window.INSTRUMENTS?.[sym]?.type === 'crypto';

      // Crypto-specific data (all free, no API key needed)
      const [fundingRate, openInterest, lsRatio] = isCrypto
        ? await Promise.all([
            window.marketData.getFundingRate(sym).catch(() => null),
            window.marketData.getCryptoOpenInterest?.(sym).catch(() => null) ?? Promise.resolve(null),
            window.marketData.getLongShortRatio?.(sym).catch(() => null)     ?? Promise.resolve(null),
          ])
        : [null, null, null];

      // Aletheia fundamental context (institutional/ownership data, 52-week range)
      // Fires only when aletheiaKey is set; fails gracefully with null
      const aletheiaData = window.marketData.aletheiaKey
        ? await window.marketData.getAletheiaData(sym).catch(() => null)
        : null;

      return await this.generateSignal(sym, candles1m, candles5m, {
        timeframe:         '1m',
        fundingRate,
        openInterest,
        lsRatio,
        fearGreed:         sharedCtx.fearGreed         ?? null,
        currencyStrengths: sharedCtx.currencyStrengths ?? null,
        newsEvents:        sharedCtx.newsEvents        ?? [],
        aletheiaData,
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
