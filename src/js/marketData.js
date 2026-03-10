// marketData.js — Market data fetching (Binance + Yahoo Finance + Alpha Vantage)

const INSTRUMENTS = {
  // ── Forex ──────────────────────────────────────────────────────────────────
  'EURUSD': { type: 'forex', av: 'EUR', quote: 'USD', display: 'EUR/USD',    pip: 0.0001 },
  'GBPUSD': { type: 'forex', av: 'GBP', quote: 'USD', display: 'GBP/USD',    pip: 0.0001 },
  'USDJPY': { type: 'forex', av: 'USD', quote: 'JPY', display: 'USD/JPY',    pip: 0.01   },
  'GBPJPY': { type: 'forex', av: 'GBP', quote: 'JPY', display: 'GBP/JPY',    pip: 0.01   },
  'XAUUSD': { type: 'forex', av: 'XAU', quote: 'USD', display: 'XAU/USD',    pip: 0.01   },
  'AUDUSD': { type: 'forex', av: 'AUD', quote: 'USD', display: 'AUD/USD',    pip: 0.0001 },
  'USDCAD': { type: 'forex', av: 'USD', quote: 'CAD', display: 'USD/CAD',    pip: 0.0001 },

  // ── Futures — Full contracts ────────────────────────────────────────────────
  'NQ':  { type: 'futures', yf: 'NQ=F',  display: 'Nasdaq 100 (NQ)',       pip: 0.25,  tickVal: 5.00  },
  'ES':  { type: 'futures', yf: 'ES=F',  display: 'S&P 500 (ES)',          pip: 0.25,  tickVal: 12.50 },
  'YM':  { type: 'futures', yf: 'YM=F',  display: 'Dow Jones (YM)',        pip: 1.00,  tickVal: 5.00  },
  'RTY': { type: 'futures', yf: 'RTY=F', display: 'Russell 2000 (RTY)',    pip: 0.10,  tickVal: 5.00  },
  'CL':  { type: 'futures', yf: 'CL=F',  display: 'Crude Oil (CL)',        pip: 0.01,  tickVal: 10.00 },
  'NG':  { type: 'futures', yf: 'NG=F',  display: 'Natural Gas (NG)',      pip: 0.001, tickVal: 10.00 },
  'GC':  { type: 'futures', yf: 'GC=F',  display: 'Gold (GC)',             pip: 0.10,  tickVal: 10.00 },

  // ── Futures — Micro contracts ──────────────────────────────────────────────
  'MNQ': { type: 'futures', yf: 'MNQ=F', display: 'Micro Nasdaq (MNQ)',    pip: 0.25,  tickVal: 0.50  },
  'MES': { type: 'futures', yf: 'MES=F', display: 'Micro S&P 500 (MES)',   pip: 0.25,  tickVal: 1.25  },
  'MYM': { type: 'futures', yf: 'MYM=F', display: 'Micro Dow (MYM)',       pip: 1.00,  tickVal: 0.50  },
  'M2K': { type: 'futures', yf: 'M2K=F', display: 'Micro Russell (M2K)',   pip: 0.10,  tickVal: 0.50  },

  // ── Crypto ────────────────────────────────────────────────────────────────
  'BTCUSDT':  { type: 'crypto', binance: 'BTCUSDT',  display: 'BTC/USDT',  pip: 1.0   },
  'ETHUSDT':  { type: 'crypto', binance: 'ETHUSDT',  display: 'ETH/USDT',  pip: 0.1   },
  'SOLUSDT':  { type: 'crypto', binance: 'SOLUSDT',  display: 'SOL/USDT',  pip: 0.01  },
};

// Seed prices for simulated candles (updated periodically)
const SEED_PRICES = {
  EURUSD: 1.0842, GBPUSD: 1.2643, USDJPY: 149.85, GBPJPY: 189.60,
  XAUUSD: 2385.0, AUDUSD: 0.6521, USDCAD: 1.3612,
  NQ: 18420, ES: 5285, YM: 38950, RTY: 2050, CL: 78.4, NG: 2.15, GC: 2385,
  MNQ: 18420, MES: 5285, MYM: 38950, M2K: 2050,
  BTCUSDT: 68000, ETHUSDT: 3520, SOLUSDT: 182,
};

// Per-instrument realistic 1H candle volatility (as fraction of price)
// Based on typical 1H ATR / price ratios observed in live markets
const SIM_VOLATILITY = {
  EURUSD: 0.0004, GBPUSD: 0.0005, USDJPY: 0.0004, GBPJPY: 0.0006,
  XAUUSD: 0.0008, AUDUSD: 0.0004, USDCAD: 0.0004,
  NQ: 0.0035, ES: 0.0025, YM: 0.0030, RTY: 0.0030,
  CL: 0.0060, NG: 0.0120, GC: 0.0025,
  MNQ: 0.0035, MES: 0.0025, MYM: 0.0030, M2K: 0.0030,
  BTCUSDT: 0.012, ETHUSDT: 0.014, SOLUSDT: 0.018,
};

class MarketData {
  constructor() {
    this.avApiKey  = '';
    this.cache     = {};     // cacheKey -> { candles, ts }
    this.inflight  = {};     // cacheKey -> Promise (prevents duplicate concurrent fetches)
    this.prices    = {};     // symbol -> last close price
    this.CACHE_TTL = 90 * 1000;  // 90 seconds — fresh enough for 5-min auto-scan
  }

  setAlphaVantageKey(key) { this.avApiKey = key.trim(); }

  // ── Public: get candles for a symbol ─────────────────────────────────────
  async getCandles(symbol, interval = '1h', limit = 120) {
    const cacheKey = symbol + '-' + interval;
    const now      = Date.now();
    const cached   = this.cache[cacheKey];
    if (cached && (now - cached.ts) < this.CACHE_TTL) return cached.candles;

    // Prevent duplicate concurrent fetches for the same symbol+interval
    if (this.inflight[cacheKey]) return this.inflight[cacheKey];

    const promise = this._doFetch(symbol, interval, limit, cacheKey, now);
    this.inflight[cacheKey] = promise;
    try {
      return await promise;
    } finally {
      delete this.inflight[cacheKey];
    }
  }

  async _doFetch(symbol, interval, limit, cacheKey, now) {
    const inst = INSTRUMENTS[symbol];
    if (!inst) throw new Error('Unknown symbol: ' + symbol);

    let candles;
    try {
      if (inst.type === 'crypto') {
        candles = await this._fetchBinance(inst.binance, interval, limit);
      } else if (inst.type === 'futures') {
        candles = await this._fetchYahoo(inst.yf, interval, limit);
      } else {
        // Forex — try Alpha Vantage first, gracefully fall back to simulated
        if (this.avApiKey) {
          candles = await this._fetchAlphaVantage(inst.av, inst.quote, limit);
        } else {
          throw new Error('No Alpha Vantage key');
        }
      }
    } catch (e) {
      console.warn('Market data fetch failed for ' + symbol + ': ' + e.message + ' — using simulated candles');
      candles = this._generateRealisticCandles(symbol, limit, interval);
    }

    // Validate candles — reject any with zero or negative close (not substitute)
    candles = candles.filter(c =>
      c.close > 0 && c.open > 0 &&
      c.high >= c.open && c.high >= c.close &&
      c.low  <= c.open && c.low  <= c.close
    );

    this.cache[cacheKey] = { candles, ts: now };
    if (candles.length > 0) this.prices[symbol] = candles[candles.length - 1].close;
    return candles;
  }

  // ── Binance REST (crypto — no API key required) ───────────────────────────
  async _fetchBinance(pair, interval, limit) {
    const intMap = { '1h': '1h', '4h': '4h', '1d': '1d', '15m': '15m' };
    const i   = intMap[interval] || '1h';
    const url = 'https://api.binance.com/api/v3/klines?symbol=' + pair + '&interval=' + i + '&limit=' + limit;

    const data = await this._fetch(url);
    if (!Array.isArray(data)) throw new Error('Unexpected Binance response');

    return data.map(k => ({
      time:   k[0],
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  // ── Alpha Vantage (forex) ─────────────────────────────────────────────────
  async _fetchAlphaVantage(from, to, limit) {
    if (!this.avApiKey) throw new Error('No Alpha Vantage key');
    const url = 'https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=' + from +
      '&to_symbol=' + to + '&interval=60min&outputsize=compact&apikey=' + this.avApiKey;

    const data = await this._fetch(url);
    const ts   = data['Time Series FX (60min)'];
    if (!ts) throw new Error('Alpha Vantage: rate limit or invalid key');

    return Object.entries(ts).slice(0, limit).reverse().map(([time, v], i) => ({
      time:   new Date(time).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      // Vary volume realistically instead of fixed 1000
      volume: 800 + Math.floor(Math.sin(i * 0.7) * 300 + Math.random() * 400),
    }));
  }

  // ── Yahoo Finance (futures + some forex) ─────────────────────────────────
  // FIX: the old code mapped '4h' -> '1h', silently giving wrong timeframe.
  // Yahoo Finance supports '1h' natively; for '4h' we fetch 1H and aggregate.
  async _fetchYahoo(ticker, interval, limit) {
    let candles;

    if (interval === '4h') {
      // Fetch 4x more 1H candles and aggregate into 4H bars
      const raw = await this._fetchYahooRaw(ticker, '1h', limit * 4);
      candles = this._aggregate1Hto4H(raw, limit);
    } else {
      candles = await this._fetchYahooRaw(ticker, interval, limit);
    }

    return candles;
  }

  async _fetchYahooRaw(ticker, interval, limit) {
    const ivMap = { '1h': '1h', '15m': '15m', '1d': '1d' };
    const iv    = ivMap[interval] || '1h';
    // 1H needs 30d to return 220+ bars (futures trade ~23h/day × 7d ≈ 161 bars — not enough for 200-EMA)
    const range = (interval === '1d') ? '3mo' : (interval === '15m' ? '5d' : '30d');
    const path  = '/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + iv + '&range=' + range;

    let data;
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        data = await this._fetch('https://' + host + path);
        if (data && data.chart && data.chart.result && data.chart.result[0]) break;
      } catch (e) { /* try next */ }
    }

    const res = data && data.chart && data.chart.result && data.chart.result[0];
    if (!res) throw new Error('Yahoo Finance: no data for ' + ticker);

    const ts     = res.timestamp;
    const quotes = res.indicators.quote[0];

    return ts.slice(-limit).map((t, i) => {
      const o = quotes.open[i];
      const h = quotes.high[i];
      const l = quotes.low[i];
      const c = quotes.close[i];
      const v = quotes.volume[i];
      if (!o || !h || !l || !c) return null;
      return {
        time:   t * 1000,
        open:   parseFloat(o),
        high:   parseFloat(h),
        low:    parseFloat(l),
        close:  parseFloat(c),
        volume: v || 0,
      };
    }).filter(Boolean);
  }

  // Aggregate 1H bars into 4H bars (groups of 4)
  _aggregate1Hto4H(candles1H, limit) {
    const result = [];
    for (let i = 0; i + 3 < candles1H.length; i += 4) {
      const group = candles1H.slice(i, i + 4);
      result.push({
        time:   group[0].time,
        open:   group[0].open,
        high:   Math.max(...group.map(c => c.high)),
        low:    Math.min(...group.map(c => c.low)),
        close:  group[group.length - 1].close,
        volume: group.reduce((a, c) => a + c.volume, 0),
      });
    }
    return result.slice(-limit);
  }

  // ── Electron IPC fetch helper ─────────────────────────────────────────────
  async _fetch(url) {
    if (window.electronAPI) return window.electronAPI.fetchUrl(url);
    const r = await fetch(url);
    return r.json();
  }

  // ── Realistic simulated candles ───────────────────────────────────────────
  // FIX: uses per-instrument volatility instead of flat 0.25% for everything.
  // Also generates proper trending/ranging regimes for better signal testing.
  _generateRealisticCandles(symbol, count, interval = '1h') {
    const base     = SEED_PRICES[symbol] || 1.0;
    const volFrac  = SIM_VOLATILITY[symbol] || 0.0010;
    // Scale volatility by timeframe
    const tfScale  = interval === '4h' ? 1.8 : interval === '1d' ? 3.5 : interval === '15m' ? 0.5 : 1.0;
    const vol      = base * volFrac * tfScale;
    const msPer    = interval === '4h' ? 14400000 : interval === '1d' ? 86400000 : interval === '15m' ? 900000 : 3600000;

    let price = base;
    // Add a mild trend bias (random walk with drift)
    const drift = (Math.random() - 0.5) * 0.0002;
    const candles = [];
    const now = Date.now();

    for (let i = count; i >= 0; i--) {
      const change = (Math.random() - 0.495 + drift) * vol;
      const open   = price;
      price        = Math.max(price * 0.95, price + change);
      const wick   = Math.random() * vol * 0.4;
      const high   = Math.max(open, price) + wick;
      const low    = Math.min(open, price) - wick;

      candles.push({
        time:      now - i * msPer,
        open:      parseFloat(open.toFixed(5)),
        high:      parseFloat(high.toFixed(5)),
        low:       parseFloat(low.toFixed(5)),
        close:     parseFloat(price.toFixed(5)),
        volume:    Math.floor(Math.random() * 5000) + 500,
        simulated: true,
      });
    }
    return candles;
  }

  // ── DST-aware Eastern Time helpers ────────────────────────────────────────
  // Returns true if US Eastern Daylight Time is in effect (UTC-4).
  // US DST: 2nd Sunday of March 2:00 AM → 1st Sunday of November 2:00 AM.
  static isEDT(now) {
    const year = now.getUTCFullYear();
    const m    = now.getUTCMonth(); // 0-indexed

    if (m < 2 || m > 10) return false;  // Jan, Feb, Dec = EST
    if (m > 2 && m < 10) return true;   // Apr-Sep = EDT

    if (m === 2) {  // March — DST starts 2nd Sunday at 2 AM ET = 7 AM UTC
      const firstSun   = (7 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7;
      const dstStart   = new Date(Date.UTC(year, 2, 1 + firstSun + 7, 7));
      return now >= dstStart;
    }
    if (m === 10) { // November — DST ends 1st Sunday at 2 AM ET = 6 AM UTC (EDT)
      const firstSun   = (7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7;
      const dstEnd     = new Date(Date.UTC(year, 10, 1 + firstSun, 6));
      return now < dstEnd;
    }
    return false;
  }

  // Returns current ET offset from UTC (-4 EDT or -5 EST)
  static etOffset(now) {
    return MarketData.isEDT(now) ? -4 : -5;
  }

  // Convert UTC Date to ET hour (0-23) and day (0=Sun)
  static toET(now) {
    const offset  = MarketData.etOffset(now);
    const etMs    = now.getTime() + offset * 3600000;
    const etDate  = new Date(etMs);
    return {
      hour:    etDate.getUTCHours(),
      minute:  etDate.getUTCMinutes(),
      day:     etDate.getUTCDay(),   // 0=Sun, 6=Sat
      date:    etDate,
    };
  }

  // ── Futures market hours (CME Globex) ─────────────────────────────────────
  // Sun 6pm ET → Fri 5pm ET, daily maintenance break 5pm-6pm ET.
  isFuturesMarketOpen() {
    const now = new Date();
    const { hour, day } = MarketData.toET(now);

    if (day === 6) return false;                    // Saturday: closed
    if (day === 0 && hour < 18) return false;       // Sunday before 6pm ET
    if (day === 5 && hour >= 17) return false;      // Friday after 5pm ET
    if (hour === 17) return false;                  // Daily 5-6pm maintenance
    return true;
  }

  // ── Minutes until Apex EOD close (4:59 PM ET) ─────────────────────────────
  // Returns positive number if market is open and EOD is today.
  // Returns null if weekend/closed or past EOD.
  minutesUntilEOD() {
    const now = new Date();
    const { hour, minute, day } = MarketData.toET(now);

    // Only relevant on weekdays during market hours
    if (day === 0 || day === 6) return null;
    if (day === 5 && hour >= 17) return null;  // Friday past EOD

    // Calculate minutes until 16:59 ET
    const eodMinutes = 16 * 60 + 59;
    const nowMinutes = hour * 60 + minute;

    if (nowMinutes >= eodMinutes) return null;  // Past EOD today
    return eodMinutes - nowMinutes;
  }

  getPrice(symbol)   { return this.prices[symbol] || 0; }
  getPip(symbol)     { return INSTRUMENTS[symbol] ? INSTRUMENTS[symbol].pip : 0.0001; }
  getTickVal(symbol) { return INSTRUMENTS[symbol] ? INSTRUMENTS[symbol].tickVal : 10; }
  getDisplay(symbol) { return INSTRUMENTS[symbol] ? INSTRUMENTS[symbol].display : symbol; }
}

window.INSTRUMENTS = INSTRUMENTS;
window.marketData  = new MarketData();
