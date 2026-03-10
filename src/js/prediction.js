// prediction.js — Next-movement prediction engine
// Uses multi-factor momentum analysis on 1m candles to forecast next 5-15 minutes.

class PredictionEngine {
  constructor() {
    this.cache    = {};     // symbol -> { prediction, ts }
    this.CACHE_TTL = 30000; // 30s — refresh predictions with new 1m data
  }

  // ── Main prediction entry point ───────────────────────────────────────────
  async predict(symbol) {
    const now    = Date.now();
    const cached = this.cache[symbol];
    if (cached && (now - cached.ts) < this.CACHE_TTL) return cached.prediction;

    try {
      const candles1m = await window.marketData.getCandles1m(symbol, 60);
      if (!candles1m || candles1m.length < 15) return null;

      const prediction = this._computePrediction(symbol, candles1m);
      this.cache[symbol] = { prediction, ts: now };
      return prediction;
    } catch(e) {
      console.warn(`Prediction failed for ${symbol}:`, e.message);
      return null;
    }
  }

  // ── Multi-factor prediction computation ───────────────────────────────────
  _computePrediction(symbol, candles) {
    const closes  = candles.map(c => c.close);
    const current = closes[closes.length - 1];

    // Factor 1: Linear regression slope (momentum direction)
    const slope      = this._linearRegressionSlope(closes.slice(-20));
    const slopePct   = (slope / current) * 100;  // normalized slope

    // Factor 2: RSI momentum (is RSI accelerating up or down?)
    const rsi        = this._rsi(closes, 14);
    const rsiPrev    = this._rsi(closes.slice(0, -3), 14);
    const rsiMomentum = rsi - rsiPrev;   // positive = RSI rising

    // Factor 3: Volume surge (last 3 bars vs previous 10)
    const recentVol  = candles.slice(-3).reduce((a, c) => a + c.volume, 0) / 3;
    const avgVol     = candles.slice(-13, -3).reduce((a, c) => a + c.volume, 0) / 10;
    const volRatio   = avgVol > 0 ? recentVol / avgVol : 1;

    // Factor 4: MACD signal on 1m (fast momentum indicator)
    const macd       = this._macdQuick(closes);

    // Factor 5: Price velocity (acceleration of price movement)
    const vel5       = (closes[closes.length - 1] - closes[closes.length - 6]) / 5;
    const vel10      = (closes[closes.length - 6] - closes[closes.length - 11]) / 5;
    const accel      = vel5 - vel10;  // positive = accelerating up

    // Factor 6: Candlestick pattern (last 3 bars: bullish/bearish engulfing, doji)
    const pattern    = this._detectPattern(candles.slice(-5));

    // Factor 7: Bollinger squeeze / breakout
    const bb         = this._bollinger(closes, 20);
    const bbPosition = bb ? (current - bb.lower) / (bb.upper - bb.lower) : 0.5;
    const bbWidth    = bb ? (bb.upper - bb.lower) / bb.mid : 0;

    // ── Score aggregation ────────────────────────────────────────────────
    let bullScore = 0;
    let bearScore = 0;
    const factors = [];

    // Slope (0-30 pts)
    if (slopePct > 0.003) {
      bullScore += Math.min(30, slopePct * 5000);
      factors.push({ name: 'Trend slope', direction: 'bull', value: `+${slopePct.toFixed(4)}%/bar` });
    } else if (slopePct < -0.003) {
      bearScore += Math.min(30, Math.abs(slopePct) * 5000);
      factors.push({ name: 'Trend slope', direction: 'bear', value: `${slopePct.toFixed(4)}%/bar` });
    }

    // RSI (0-20 pts)
    if (rsi < 35) {
      bullScore += 20;
      factors.push({ name: 'RSI oversold', direction: 'bull', value: rsi.toFixed(1) });
    } else if (rsi > 65) {
      bearScore += 20;
      factors.push({ name: 'RSI overbought', direction: 'bear', value: rsi.toFixed(1) });
    } else if (rsiMomentum > 3) {
      bullScore += 10;
      factors.push({ name: 'RSI rising', direction: 'bull', value: `+${rsiMomentum.toFixed(1)}` });
    } else if (rsiMomentum < -3) {
      bearScore += 10;
      factors.push({ name: 'RSI falling', direction: 'bear', value: `${rsiMomentum.toFixed(1)}` });
    }

    // MACD (0-20 pts)
    if (macd.bullish) {
      bullScore += 20;
      factors.push({ name: 'MACD crossover', direction: 'bull', value: 'Bullish histogram' });
    } else if (macd.bearish) {
      bearScore += 20;
      factors.push({ name: 'MACD crossover', direction: 'bear', value: 'Bearish histogram' });
    }

    // Volume surge (0-15 pts)
    if (volRatio > 1.5) {
      const dir = slopePct >= 0 ? 'bull' : 'bear';
      if (dir === 'bull') bullScore += 15; else bearScore += 15;
      factors.push({ name: 'Volume surge', direction: dir, value: `${volRatio.toFixed(1)}x avg` });
    }

    // Acceleration (0-10 pts)
    if (accel > 0) {
      bullScore += Math.min(10, Math.abs(accel) / current * 50000);
      factors.push({ name: 'Price accelerating', direction: 'bull', value: 'Up' });
    } else if (accel < 0) {
      bearScore += Math.min(10, Math.abs(accel) / current * 50000);
      factors.push({ name: 'Price accelerating', direction: 'bear', value: 'Down' });
    }

    // Pattern (0-15 pts)
    if (pattern.signal !== 'neutral') {
      if (pattern.signal === 'bullish') {
        bullScore += pattern.strength;
        factors.push({ name: pattern.name, direction: 'bull', value: 'Pattern detected' });
      } else {
        bearScore += pattern.strength;
        factors.push({ name: pattern.name, direction: 'bear', value: 'Pattern detected' });
      }
    }

    // BB position (0-10 pts)
    if (bbPosition < 0.1) {
      bullScore += 10;
      factors.push({ name: 'Near BB lower', direction: 'bull', value: 'Mean reversion' });
    } else if (bbPosition > 0.9) {
      bearScore += 10;
      factors.push({ name: 'Near BB upper', direction: 'bear', value: 'Mean reversion' });
    }

    // ── Final prediction ──────────────────────────────────────────────────
    const totalScore  = bullScore + bearScore;
    const confidence  = totalScore > 0
      ? Math.round((Math.max(bullScore, bearScore) / (totalScore + 30)) * 100)
      : 0;
    const direction   = bullScore > bearScore ? 'UP' : bearScore > bullScore ? 'DOWN' : 'FLAT';

    // Estimate price target (ATR-based projection)
    const atr1m      = this._atr(candles.slice(-14), 14);
    const targetPips = atr1m * (confidence / 100) * 2;
    const pip        = window.marketData?.getPip?.(symbol) || 0.0001;

    const targetUp   = parseFloat((current + targetPips).toFixed(5));
    const targetDown = parseFloat((current - targetPips).toFixed(5));

    // Time horizon based on momentum strength
    const timeHorizon = confidence >= 70 ? '5-15 min' :
                        confidence >= 50 ? '15-30 min' : '30-45 min';

    return {
      symbol,
      direction,
      confidence: Math.min(95, confidence),
      currentPrice: current,
      targetUp,
      targetDown,
      targetPrice: direction === 'UP' ? targetUp : direction === 'DOWN' ? targetDown : current,
      atr1m:       parseFloat(atr1m.toFixed(5)),
      timeHorizon,
      factors:     factors.slice(0, 5),
      rsi:         parseFloat(rsi.toFixed(1)),
      rsiMomentum: parseFloat(rsiMomentum.toFixed(1)),
      volRatio:    parseFloat(volRatio.toFixed(2)),
      slopePct:    parseFloat(slopePct.toFixed(4)),
      bbWidth:     parseFloat((bbWidth * 100).toFixed(3)),
      pattern:     pattern.name,
      timestamp:   new Date(),
    };
  }

  // ── Daily momentum bias ───────────────────────────────────────────────────
  // Determines the overall directional bias for the current trading day.
  async getDailyBias(symbol) {
    try {
      // Get 1h candles for today + yesterday (request more to survive filtering)
      const candles1h = await window.marketData.getCandles(symbol, '1h', 96);
      if (!candles1h || candles1h.length < 4) return null;

      // Get 1m candles for current session dynamics
      const candles1m = await window.marketData.getCandles1m(symbol, 120);
      const closes1h  = candles1h.map(c => c.close);

      const n            = candles1h.length;
      // Previous day close (~24 bars ago, floor to available data)
      const prevDayClose = candles1h[Math.max(0, n - 24)]?.close || candles1h[0].close;
      const todayOpen    = candles1h[Math.max(0, n - 8)]?.open   || candles1h[0].open;
      const current      = closes1h[closes1h.length - 1];

      // Gap analysis
      const gapPct = prevDayClose > 0 ? ((todayOpen - prevDayClose) / prevDayClose * 100) : 0;

      // Session high/low (last 8h or all available)
      const sessionCandles = candles1h.slice(-Math.min(8, n));
      const sessionHigh    = Math.max(...sessionCandles.map(c => c.high));
      const sessionLow     = Math.min(...sessionCandles.map(c => c.low));
      const sessionRange   = sessionHigh - sessionLow;
      const pricePosition  = sessionRange > 0 ? (current - sessionLow) / sessionRange : 0.5;

      // VWAP approximation — use volume-weighted if available, else equal-weighted (forex has no volume)
      const totalVol = sessionCandles.reduce((a, c) => a + c.volume, 0);
      const vwap     = totalVol > 0
        ? sessionCandles.reduce((a, c) => a + ((c.high + c.low + c.close) / 3) * c.volume, 0) / totalVol
        : sessionCandles.reduce((a, c) => a + (c.high + c.low + c.close) / 3, 0) / sessionCandles.length;

      // Trend of last 4h (recent session bias)
      const ema4h_9  = window.TechnicalAnalysis?.ema(closes1h, 9) || [];
      const ema4h_21 = window.TechnicalAnalysis?.ema(closes1h, 21) || [];
      const e9  = ema4h_9[ema4h_9.length - 1]   || current;
      const e21 = ema4h_21[ema4h_21.length - 1] || current;

      // Overnight session RSI
      const rsi = window.TechnicalAnalysis?.rsi(closes1h.slice(-20), 14) || 50;

      // ── Bias score ──────────────────────────────────────────────────────
      let bullBias = 0, bearBias = 0;
      const reasons = [];

      // Gap direction
      if (gapPct > 0.05)  { bullBias += 20; reasons.push(`Gapped up ${gapPct.toFixed(2)}% from yesterday`); }
      if (gapPct < -0.05) { bearBias += 20; reasons.push(`Gapped down ${Math.abs(gapPct).toFixed(2)}% from yesterday`); }

      // Price vs VWAP
      if (current > vwap) { bullBias += 15; reasons.push(`Price above VWAP (${vwap.toFixed(4)})`); }
      else                 { bearBias += 15; reasons.push(`Price below VWAP (${vwap.toFixed(4)})`); }

      // EMA alignment
      if (current > e9 && e9 > e21) { bullBias += 20; reasons.push('Price above EMA 9 > 21 — intraday uptrend'); }
      if (current < e9 && e9 < e21) { bearBias += 20; reasons.push('Price below EMA 9 < 21 — intraday downtrend'); }

      // Price position in session range
      if (pricePosition > 0.65) { bullBias += 10; reasons.push('Price in upper third of today\'s range'); }
      if (pricePosition < 0.35) { bearBias += 10; reasons.push('Price in lower third of today\'s range'); }

      // RSI
      if (rsi > 55) { bullBias += 10; reasons.push(`RSI bullish zone (${rsi.toFixed(1)})`); }
      if (rsi < 45) { bearBias += 10; reasons.push(`RSI bearish zone (${rsi.toFixed(1)})`); }

      // 1m momentum (last 30 minutes, or all available)
      if (candles1m && candles1m.length >= 5) {
        const lookback = Math.min(30, candles1m.length - 1);
        const c30 = candles1m[candles1m.length - lookback].close;
        const movePct = (current - c30) / c30 * 100;
        if (movePct > 0.05)  { bullBias += 10; reasons.push(`Up ${movePct.toFixed(2)}% in last 30min`); }
        if (movePct < -0.05) { bearBias += 10; reasons.push(`Down ${Math.abs(movePct).toFixed(2)}% in last 30min`); }
      }

      const totalBias = bullBias + bearBias;
      const biasPct   = totalBias > 0 ? Math.round((Math.max(bullBias, bearBias) / totalBias) * 100) : 50;
      const biasDir   = bullBias > bearBias ? 'BULLISH' : bearBias > bullBias ? 'BEARISH' : 'NEUTRAL';

      return {
        symbol,
        direction:     biasDir,
        strength:      biasPct,     // 50-100
        gapPct:        parseFloat(gapPct.toFixed(3)),
        vwap:          parseFloat(vwap.toFixed(5)),
        sessionHigh:   parseFloat(sessionHigh.toFixed(5)),
        sessionLow:    parseFloat(sessionLow.toFixed(5)),
        pricePosition: parseFloat((pricePosition * 100).toFixed(1)),
        rsi:           parseFloat(rsi.toFixed(1)),
        reasons:       reasons.slice(0, 4),
        timestamp:     new Date(),
      };
    } catch(e) {
      console.warn(`Daily bias failed for ${symbol}:`, e.message);
      return null;
    }
  }

  // ── Technical helpers ─────────────────────────────────────────────────────
  _linearRegressionSlope(values) {
    const n   = values.length;
    if (n < 2) return 0;
    const sumX = n * (n - 1) / 2;
    const sumX2 = n * (n - 1) * (2 * n - 1) / 6;
    const sumY  = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((acc, v, i) => acc + i * v, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  _rsi(closes, period = 14) {
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
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  _macdQuick(closes, fast = 8, slow = 13, signal = 5) {
    if (closes.length < slow + signal) return { bullish: false, bearish: false };
    const k1 = 2 / (fast + 1), k2 = 2 / (slow + 1), ks = 2 / (signal + 1);
    let emaF = closes[0], emaS = closes[0];
    const macdLine = [];
    for (const c of closes) {
      emaF = c * k1 + emaF * (1 - k1);
      emaS = c * k2 + emaS * (1 - k2);
      macdLine.push(emaF - emaS);
    }
    let sigLine = macdLine[0];
    let prev = 0;
    for (let i = 0; i < macdLine.length; i++) {
      const s = macdLine[i] * ks + sigLine * (1 - ks);
      const h = macdLine[i] - s;
      if (i === macdLine.length - 1) {
        return {
          histogram: h, signal: s, macd: macdLine[i],
          bullish: h > 0 && h > prev,
          bearish: h < 0 && h < prev,
        };
      }
      prev = h;
      sigLine = s;
    }
    return { bullish: false, bearish: false };
  }

  _atr(candles, period = 14) {
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

  _bollinger(closes, period = 20) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    const mid   = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period);
    return { upper: mid + 2 * std, mid, lower: mid - 2 * std };
  }

  _detectPattern(candles) {
    if (candles.length < 3) return { signal: 'neutral', name: 'No pattern', strength: 0 };
    const [c3, c2, c1] = candles.slice(-3);

    // Bullish engulfing
    if (c2.close < c2.open && c1.close > c1.open &&
        c1.open < c2.close && c1.close > c2.open) {
      return { signal: 'bullish', name: 'Bullish engulfing', strength: 15 };
    }
    // Bearish engulfing
    if (c2.close > c2.open && c1.close < c1.open &&
        c1.open > c2.close && c1.close < c2.open) {
      return { signal: 'bearish', name: 'Bearish engulfing', strength: 15 };
    }
    // Hammer (bullish reversal)
    const hammer_body  = Math.abs(c1.close - c1.open);
    const hammer_wick  = c1.open > c1.close ? c1.open - c1.low : c1.close - c1.low;
    const hammer_upper = c1.high - Math.max(c1.close, c1.open);
    if (hammer_wick > hammer_body * 2 && hammer_upper < hammer_body * 0.5) {
      return { signal: 'bullish', name: 'Hammer', strength: 10 };
    }
    // Shooting star (bearish reversal)
    const ss_body  = Math.abs(c1.close - c1.open);
    const ss_wick  = c1.high - Math.max(c1.close, c1.open);
    const ss_lower = Math.min(c1.close, c1.open) - c1.low;
    if (ss_wick > ss_body * 2 && ss_lower < ss_body * 0.5) {
      return { signal: 'bearish', name: 'Shooting star', strength: 10 };
    }
    // 3 consecutive same-direction closes
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open) {
      return { signal: 'bullish', name: '3 Bull bars', strength: 8 };
    }
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open) {
      return { signal: 'bearish', name: '3 Bear bars', strength: 8 };
    }

    return { signal: 'neutral', name: 'No pattern', strength: 0 };
  }
}

window.predictionEngine = new PredictionEngine();
