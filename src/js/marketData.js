// marketData.js — Live market data: Binance WebSocket (crypto), Yahoo 1m (futures), AV (forex)
// All crypto data is real-time via WebSocket. Futures/forex use the freshest available REST data.

const INSTRUMENTS = {
  // Forex — yf: Yahoo Finance ticker (free, no key), av: Alpha Vantage symbols (optional key)
  'EURUSD': { type: 'forex', yf: 'EURUSD=X', av: 'EUR', quote: 'USD', display: 'EUR/USD', pip: 0.0001 },
  'GBPUSD': { type: 'forex', yf: 'GBPUSD=X', av: 'GBP', quote: 'USD', display: 'GBP/USD', pip: 0.0001 },
  'USDJPY': { type: 'forex', yf: 'USDJPY=X', av: 'USD', quote: 'JPY', display: 'USD/JPY', pip: 0.01   },
  'GBPJPY': { type: 'forex', yf: 'GBPJPY=X', av: 'GBP', quote: 'JPY', display: 'GBP/JPY', pip: 0.01   },
  'XAUUSD': { type: 'forex', yf: 'GC=F',     av: 'XAU', quote: 'USD', display: 'XAU/USD', pip: 0.01   },
  'AUDUSD': { type: 'forex', yf: 'AUDUSD=X', av: 'AUD', quote: 'USD', display: 'AUD/USD', pip: 0.0001 },
  'USDCAD': { type: 'forex', yf: 'USDCAD=X', av: 'USD', quote: 'CAD', display: 'USD/CAD', pip: 0.0001 },
  // Futures
  'ES':  { type: 'futures', yf: 'ES=F',  display: 'S&P 500 (ES)',       pip: 0.25,  tickVal: 12.50 },
  'NQ':  { type: 'futures', yf: 'NQ=F',  display: 'Nasdaq (NQ)',        pip: 0.25,  tickVal: 5.00  },
  'YM':  { type: 'futures', yf: 'YM=F',  display: 'Dow Jones (YM)',     pip: 1.00,  tickVal: 5.00  },
  'RTY': { type: 'futures', yf: 'RTY=F', display: 'Russell 2000 (RTY)', pip: 0.10,  tickVal: 5.00  },
  'CL':  { type: 'futures', yf: 'CL=F',  display: 'Crude Oil (CL)',     pip: 0.01,  tickVal: 10.00 },
  'GC':  { type: 'futures', yf: 'GC=F',  display: 'Gold (GC)',          pip: 0.10,  tickVal: 10.00 },
  'MNQ': { type: 'futures', yf: 'MNQ=F', display: 'Micro Nasdaq (MNQ)', pip: 0.25,  tickVal: 0.50  },
  'MES': { type: 'futures', yf: 'MES=F', display: 'Micro S&P (MES)',    pip: 0.25,  tickVal: 1.25  },
  // Crypto
  'BTCUSDT': { type: 'crypto', binance: 'BTCUSDT', display: 'BTC/USDT', pip: 1.0  },
  'ETHUSDT': { type: 'crypto', binance: 'ETHUSDT', display: 'ETH/USDT', pip: 0.1  },
  'SOLUSDT': { type: 'crypto', binance: 'SOLUSDT', display: 'SOL/USDT', pip: 0.01 },
};

const SEED_PRICES = {
  EURUSD: 1.0842, GBPUSD: 1.2643, USDJPY: 149.85, GBPJPY: 189.60,
  XAUUSD: 2385.0, AUDUSD: 0.6521, USDCAD: 1.3612,
  ES: 5285, NQ: 18420, YM: 38950, RTY: 2050, CL: 78.4, GC: 2385,
  MNQ: 18420, MES: 5285,
  BTCUSDT: 68000, ETHUSDT: 3520, SOLUSDT: 182,
};

const SIM_VOLATILITY = {
  EURUSD: 0.0004, GBPUSD: 0.0005, USDJPY: 0.0004, GBPJPY: 0.0006,
  XAUUSD: 0.0008, AUDUSD: 0.0004, USDCAD: 0.0004,
  ES: 0.0025, NQ: 0.0035, YM: 0.0030, RTY: 0.0030, CL: 0.006, GC: 0.0025,
  MNQ: 0.0035, MES: 0.0025,
  BTCUSDT: 0.012, ETHUSDT: 0.014, SOLUSDT: 0.018,
};

class MarketData {
  constructor() {
    this.avApiKey  = '';
    this.cache     = {};        // cacheKey -> { candles, ts }
    this.cache1m   = {};        // symbol -> { candles[], ts }
    this.inflight  = {};        // prevents duplicate concurrent fetches
    this.prices    = {};        // symbol -> last price (live)
    this.liveWs    = {};        // symbol -> WebSocket (crypto only)
    this.listeners = {};        // symbol -> Set<callback>
    this.CACHE_TTL    = 60 * 1000;   // 60s for hourly/daily candles
    this.CACHE_TTL_1M = 15 * 1000;   // 15s for 1m candles — nearly live
  }

  setAlphaVantageKey(key) {
    const trimmed = key.trim();
    if (trimmed !== this.avApiKey) {
      this.avApiKey = trimmed;
      // Clear all caches so next fetch uses the new key with live data
      this.cache   = {};
      this.cache1m = {};
    }
  }

  // ── Subscribe to live price ticks ────────────────────────────────────────
  onPriceUpdate(symbol, cb) {
    if (!this.listeners[symbol]) this.listeners[symbol] = new Set();
    this.listeners[symbol].add(cb);
    // Start WebSocket for crypto, polling for others
    this._ensureLiveFeed(symbol);
  }

  offPriceUpdate(symbol, cb) {
    this.listeners[symbol]?.delete(cb);
  }

  _emit(symbol, price) {
    this.prices[symbol] = price;
    this.listeners[symbol]?.forEach(cb => {
      try { cb(symbol, price); } catch(e) {}
    });
  }

  _ensureLiveFeed(symbol) {
    const inst = INSTRUMENTS[symbol];
    if (!inst) return;
    if (inst.type === 'crypto') {
      this._startBinanceWs(symbol);
    } else if (inst.type === 'futures' || (inst.type === 'forex' && inst.yf)) {
      // Poll Yahoo Finance for both futures and forex every 30s
      if (!this._pollTimers) this._pollTimers = {};
      if (!this._pollTimers[symbol]) {
        this._pollFuturesPrice(symbol);
        this._pollTimers[symbol] = setInterval(() => this._pollFuturesPrice(symbol), 30000);
      }
    }
  }

  async _pollFuturesPrice(symbol) {
    const inst = INSTRUMENTS[symbol];
    if (!inst) return;
    try {
      if (inst.type === 'futures' || (inst.type === 'forex' && inst.yf)) {
        // Yahoo Finance works for both futures and forex (EURUSD=X etc.)
        let data;
        for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
          try {
            data = await this._fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(inst.yf)}?interval=1m&range=1d`);
            if (data?.chart?.result?.[0]) break;
          } catch(e) {}
        }
        const res = data?.chart?.result?.[0];
        if (res) {
          const quotes = res.indicators.quote[0];
          const closes = quotes.close.filter(Boolean);
          if (closes.length > 0) this._emit(symbol, closes[closes.length - 1]);
        }
      }
      // Optional AV enhancement for forex real-time rate
      if (inst.type === 'forex' && this.avApiKey) {
        const data = await this._fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${inst.av}&to_currency=${inst.quote}&apikey=${this.avApiKey}`);
        const rate = data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate'];
        if (rate) this._emit(symbol, parseFloat(rate));
      }
    } catch(e) { /* keep cached price */ }
  }

  _startBinanceWs(symbol) {
    if (this.liveWs[symbol]) return;  // already connected
    const inst = INSTRUMENTS[symbol];
    if (!inst?.binance) return;

    const pair = inst.binance.toLowerCase();
    const url  = `wss://stream.binance.com:9443/stream?streams=${pair}@trade/${pair}@kline_1m`;

    // Electron doesn't natively support renderer-side WebSocket to wss:// via IPC,
    // so we use the main-process WebSocket bridge if available, else REST polling.
    if (window.electronAPI?.openWebSocket) {
      const wsId = `binance-${symbol}`;
      window.electronAPI.openWebSocket(wsId, url, (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.stream?.endsWith('@trade')) {
            this._emit(symbol, parseFloat(data.data.p));
          } else if (data.stream?.endsWith('@kline_1m') && data.data?.k?.x) {
            // Completed 1m candle — push to cache
            const k = data.data.k;
            this._push1mCandle(symbol, {
              time:   k.t,
              open:   parseFloat(k.o),
              high:   parseFloat(k.h),
              low:    parseFloat(k.l),
              close:  parseFloat(k.c),
              volume: parseFloat(k.v),
            });
          }
        } catch(e) {}
      });
      this.liveWs[symbol] = wsId;
    } else {
      // Fallback: poll Binance REST every 10s for freshest tick
      const poll = async () => {
        try {
          const data = await this._fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${inst.binance}`);
          if (data?.price) this._emit(symbol, parseFloat(data.price));
        } catch(e) {}
      };
      poll();
      this.liveWs[symbol] = setInterval(poll, 10000);
    }
  }

  _push1mCandle(symbol, candle) {
    if (!this.cache1m[symbol]) this.cache1m[symbol] = { candles: [], ts: Date.now() };
    const list = this.cache1m[symbol].candles;
    if (list.length > 0 && list[list.length - 1].time === candle.time) {
      list[list.length - 1] = candle; // update in-progress candle
    } else {
      list.push(candle);
      if (list.length > 500) list.shift(); // keep ~8h of 1m data
    }
    this.cache1m[symbol].ts = Date.now();
  }

  // ── Public: get candles (any timeframe) ──────────────────────────────────
  async getCandles(symbol, interval = '1h', limit = 120) {
    if (interval === '1m') return this.getCandles1m(symbol, limit);

    const cacheKey = `${symbol}-${interval}`;
    const now = Date.now();
    const cached = this.cache[cacheKey];
    if (cached && (now - cached.ts) < this.CACHE_TTL) return cached.candles;

    if (this.inflight[cacheKey]) return this.inflight[cacheKey];
    const p = this._doFetch(symbol, interval, limit, cacheKey, now);
    this.inflight[cacheKey] = p;
    try { return await p; } finally { delete this.inflight[cacheKey]; }
  }

  // ── Public: get 1-minute candles (live / near-live) ───────────────────────
  async getCandles1m(symbol, limit = 120) {
    const cacheKey = `${symbol}-1m`;
    const now = Date.now();
    const cached = this.cache[cacheKey];
    if (cached && (now - cached.ts) < this.CACHE_TTL_1M) return cached.candles.slice(-limit);

    if (this.inflight[cacheKey]) return this.inflight[cacheKey];
    const p = this._fetch1m(symbol, limit, cacheKey, now);
    this.inflight[cacheKey] = p;
    try { return await p; } finally { delete this.inflight[cacheKey]; }
  }

  async _fetch1m(symbol, limit, cacheKey, now) {
    const inst = INSTRUMENTS[symbol];
    if (!inst) throw new Error('Unknown symbol: ' + symbol);
    let candles;
    try {
      if (inst.type === 'crypto') {
        candles = await this._fetchBinance(inst.binance, '1m', Math.min(limit, 500));
      } else if (inst.type === 'futures') {
        candles = await this._fetchYahooRaw(inst.yf, '1m', limit);
      } else {
        // Forex 1m — Yahoo Finance first (free), then Alpha Vantage (optional key)
        if (inst.yf) {
          try {
            candles = await this._fetchYahooRaw(inst.yf, '1m', limit);
          } catch(e) {
            if (this.avApiKey) {
              candles = await this._fetchAlphaVantage1m(inst.av, inst.quote, limit);
            } else throw e;
          }
        } else if (this.avApiKey) {
          candles = await this._fetchAlphaVantage1m(inst.av, inst.quote, limit);
        } else {
          throw new Error('No data source for forex 1m');
        }
      }
    } catch(e) {
      console.error(`Live 1m fetch failed for ${symbol}:`, e.message);
      candles = [];
    }

    candles = (candles || []).filter(c => c.close > 0 && c.open > 0 && c.high > 0 && c.low > 0);
    this.cache[cacheKey] = { candles, ts: now };
    if (candles.length > 0) this.prices[symbol] = candles[candles.length - 1].close;
    return candles.slice(-limit);
  }

  // ── Historical candles for backtesting (large datasets) ───────────────────
  async getHistoricalCandles(symbol, interval = '1d', limit = 365) {
    const inst = INSTRUMENTS[symbol];
    if (!inst) throw new Error('Unknown: ' + symbol);
    try {
      if (inst.type === 'crypto') {
        return await this._fetchBinance(inst.binance, interval, Math.min(limit, 1000));
      } else if (inst.type === 'futures') {
        return await this._fetchYahooHistorical(inst.yf, interval, limit);
      } else {
        // Forex: Yahoo Finance first, then AV
        if (inst.yf) {
          try {
            return await this._fetchYahooHistorical(inst.yf, interval, limit);
          } catch(e) {
            if (this.avApiKey) return await this._fetchAlphaVantageDaily(inst.av, inst.quote, limit);
            throw e;
          }
        } else if (this.avApiKey) {
          return await this._fetchAlphaVantageDaily(inst.av, inst.quote, limit);
        }
        throw new Error('No data source for historical forex');
      }
    } catch(e) {
      console.error(`Historical fetch failed ${symbol}:`, e.message);
      return [];
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
        // Forex: try Yahoo Finance first (free, no key), fall back to Alpha Vantage
        if (inst.yf) {
          try {
            candles = await this._fetchYahoo(inst.yf, interval, limit);
          } catch(e) {
            if (this.avApiKey) {
              candles = await this._fetchAlphaVantage(inst.av, inst.quote, limit);
            } else throw e;
          }
        } else if (this.avApiKey) {
          candles = await this._fetchAlphaVantage(inst.av, inst.quote, limit);
        } else {
          throw new Error('No data source for forex');
        }
      }
    } catch(e) {
      console.error(`Live data fetch failed ${symbol} ${interval}:`, e.message);
      candles = [];
    }

    candles = (candles || []).filter(c => c.close > 0 && c.open > 0 && c.high > 0 && c.low > 0);

    this.cache[cacheKey] = { candles, ts: now };
    if (candles.length > 0) this.prices[symbol] = candles[candles.length - 1].close;
    return candles;
  }

  // ── Binance REST (crypto) ─────────────────────────────────────────────────
  async _fetchBinance(pair, interval, limit) {
    const intMap = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
    const i = intMap[interval] || '1h';
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${i}&limit=${limit}`;
    const data = await this._fetch(url);
    if (!Array.isArray(data)) throw new Error('Bad Binance response');
    return data.map(k => ({
      time:   k[0],
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  // ── Alpha Vantage (forex hourly) ──────────────────────────────────────────
  async _fetchAlphaVantage(from, to, limit) {
    if (!this.avApiKey) throw new Error('No Alpha Vantage key');
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=60min&outputsize=full&apikey=${this.avApiKey}`;
    const data = await this._fetch(url);
    const ts = data['Time Series FX (60min)'];
    if (!ts) throw new Error('AV rate limit or bad key');
    return Object.entries(ts).slice(0, limit).reverse().map(([time, v], i) => ({
      time:   new Date(time).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: 800 + Math.floor(Math.sin(i * 0.7) * 300 + Math.random() * 400),
    }));
  }

  // ── Alpha Vantage 1m (forex intraday) ────────────────────────────────────
  async _fetchAlphaVantage1m(from, to, limit) {
    if (!this.avApiKey) throw new Error('No Alpha Vantage key');
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=1min&outputsize=compact&apikey=${this.avApiKey}`;
    const data = await this._fetch(url);
    const ts = data['Time Series FX (1min)'];
    if (!ts) throw new Error('AV 1m rate limit');
    return Object.entries(ts).slice(0, limit).reverse().map(([time, v]) => ({
      time:   new Date(time).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: Math.floor(Math.random() * 500) + 100,
    }));
  }

  // ── Alpha Vantage daily (forex historical) ────────────────────────────────
  async _fetchAlphaVantageDaily(from, to, limit) {
    if (!this.avApiKey) throw new Error('No AV key');
    const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&outputsize=full&apikey=${this.avApiKey}`;
    const data = await this._fetch(url);
    const ts = data['Time Series FX (Daily)'];
    if (!ts) throw new Error('AV daily limit');
    return Object.entries(ts).slice(0, limit).reverse().map(([time, v]) => ({
      time:   new Date(time).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: 0,
    }));
  }

  // ── Yahoo Finance (futures) ───────────────────────────────────────────────
  async _fetchYahoo(ticker, interval, limit) {
    if (interval === '4h') {
      const raw = await this._fetchYahooRaw(ticker, '1h', limit * 4);
      return this._aggregate1Hto4H(raw, limit);
    }
    return this._fetchYahooRaw(ticker, interval, limit);
  }

  async _fetchYahooRaw(ticker, interval, limit, rangeOverride = null) {
    const ivMap = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': '1d' };
    const iv = ivMap[interval] || '1h';
    const range = rangeOverride || (
                  interval === '1d' ? '2y' :
                  interval === '1h' ? '60d' :
                  interval === '1m' ? '1d' :
                  interval === '5m' ? '5d' :
                  '5d');

    let data;
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const path = `/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${iv}&range=${range}`;
        data = await this._fetch(`https://${host}${path}`);
        if (data?.chart?.result?.[0]) break;
      } catch(e) {}
    }

    const res = data?.chart?.result?.[0];
    if (!res) throw new Error('Yahoo Finance: no data for ' + ticker);

    const ts     = res.timestamp;
    const quotes = res.indicators.quote[0];

    // Compute offset so OHLC indices align with sliced timestamps
    const offset = Math.max(0, ts.length - limit);
    return ts.slice(offset).map((t, idx) => {
      const i = offset + idx;
      const o = quotes.open[i], h = quotes.high[i], l = quotes.low[i], c = quotes.close[i];
      if (!o || !c) return null;
      return {
        time:   t * 1000,
        open:   parseFloat(o),
        high:   parseFloat(h || Math.max(o, c)),
        low:    parseFloat(l || Math.min(o, c)),
        close:  parseFloat(c),
        volume: quotes.volume?.[i] || 0,
      };
    }).filter(Boolean);
  }

  async _fetchYahooHistorical(ticker, interval, limit) {
    // For daily data use 2y range; for hourly use 6mo to get enough bars for backtesting.
    // Regular candle fetches use shorter ranges (faster), but historical fetches need depth.
    const iv    = interval === '1h' ? '1h' : '1d';
    const range = interval === '1h' ? '6mo' : '2y';
    return this._fetchYahooRaw(ticker, iv, limit, range);
  }

  _aggregate1Hto4H(candles1H, limit) {
    const result = [];
    for (let i = 0; i + 3 < candles1H.length; i += 4) {
      const g = candles1H.slice(i, i + 4);
      result.push({
        time:   g[0].time,
        open:   g[0].open,
        high:   Math.max(...g.map(c => c.high)),
        low:    Math.min(...g.map(c => c.low)),
        close:  g[g.length - 1].close,
        volume: g.reduce((a, c) => a + c.volume, 0),
      });
    }
    return result.slice(-limit);
  }

  // Group 1m bars into 5m bars (every 5 × 1m = 5 min)
  // Used by _scanOne to provide 5m context when primary data is 1m
  _aggregate1mto5m(candles1m, limit = 60) {
    const result = [];
    for (let i = 0; i + 4 < candles1m.length; i += 5) {
      const g = candles1m.slice(i, i + 5);
      result.push({
        time:   g[0].time,
        open:   g[0].open,
        high:   Math.max(...g.map(c => c.high)),
        low:    Math.min(...g.map(c => c.low)),
        close:  g[g.length - 1].close,
        volume: g.reduce((a, c) => a + c.volume, 0),
      });
    }
    return result.slice(-limit);
  }

  // Group 5m bars into 1H bars (every 12 × 5m = 60 min)
  _aggregate5mto1H(candles5m, limit = 30) {
    const result = [];
    for (let i = 0; i + 11 < candles5m.length; i += 12) {
      const g = candles5m.slice(i, i + 12);
      result.push({
        time:   g[0].time,
        open:   g[0].open,
        high:   Math.max(...g.map(c => c.high)),
        low:    Math.min(...g.map(c => c.low)),
        close:  g[g.length - 1].close,
        volume: g.reduce((a, c) => a + c.volume, 0),
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

  // ── Simulated candles fallback ────────────────────────────────────────────
  _generateRealisticCandles(symbol, count, interval = '1h') {
    const base    = SEED_PRICES[symbol] || 1.0;
    const volFrac = SIM_VOLATILITY[symbol] || 0.001;
    const tfScale = { '1m': 0.05, '5m': 0.12, '15m': 0.25, '1h': 1.0, '4h': 1.8, '1d': 3.5 }[interval] || 1.0;
    const msPer   = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 }[interval] || 3600000;
    const vol     = base * volFrac * tfScale;

    let price = base;
    const drift = (Math.random() - 0.5) * 0.0002;
    const candles = [];
    const now = Date.now();

    for (let i = count; i >= 0; i--) {
      const change = (Math.random() - 0.495 + drift) * vol;
      const open   = price;
      price        = Math.max(price * 0.95, price + change);
      const wick   = Math.random() * vol * 0.4;
      candles.push({
        time:      now - i * msPer,
        open:      parseFloat(open.toFixed(5)),
        high:      parseFloat((Math.max(open, price) + wick).toFixed(5)),
        low:       parseFloat((Math.min(open, price) - wick).toFixed(5)),
        close:     parseFloat(price.toFixed(5)),
        volume:    Math.floor(Math.random() * 5000) + 500,
        simulated: true,
      });
    }
    return candles;
  }

  // ── Market hours ──────────────────────────────────────────────────────────
  static isEDT(now) {
    const year = now.getUTCFullYear(), m = now.getUTCMonth();
    if (m < 2 || m > 10) return false;
    if (m > 2 && m < 10) return true;
    if (m === 2) {
      const firstSun = (7 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7;
      return now >= new Date(Date.UTC(year, 2, 1 + firstSun + 7, 7));
    }
    const firstSun = (7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7;
    return now < new Date(Date.UTC(year, 10, 1 + firstSun, 6));
  }

  static etOffset(now) { return MarketData.isEDT(now) ? -4 : -5; }

  static toET(now) {
    const offset = MarketData.etOffset(now);
    const etDate = new Date(now.getTime() + offset * 3600000);
    return { hour: etDate.getUTCHours(), minute: etDate.getUTCMinutes(), day: etDate.getUTCDay(), date: etDate };
  }

  isFuturesMarketOpen() {
    const { hour, day } = MarketData.toET(new Date());
    if (day === 6) return false;
    if (day === 0 && hour < 18) return false;
    if (day === 5 && hour >= 17) return false;
    if (hour === 17) return false;
    return true;
  }

  minutesUntilEOD() {
    const { hour, minute, day } = MarketData.toET(new Date());
    if (day === 0 || day === 6 || (day === 5 && hour >= 17)) return null;
    const eod = 16 * 60 + 59;
    const cur = hour * 60 + minute;
    if (cur >= eod) return null;
    return eod - cur;
  }

  // ── Live price refresh (polling for non-crypto) ───────────────────────────
  async refreshPrices(symbols) {
    const cryptos  = symbols.filter(s => INSTRUMENTS[s]?.type === 'crypto');
    const futures  = symbols.filter(s => INSTRUMENTS[s]?.type === 'futures');

    await Promise.allSettled([
      ...cryptos.map(s => this._fetchBinance(INSTRUMENTS[s].binance, '1m', 1).then(candles => {
        if (candles.length > 0) this._emit(s, candles[candles.length - 1].close);
      }).catch(() => {})),
      ...futures.map(s => this._pollFuturesPrice(s).catch(() => {})),
    ]);

    return this.prices;
  }

  getPrice(symbol)   { return this.prices[symbol] || 0; }
  getPip(symbol)     { return INSTRUMENTS[symbol]?.pip || 0.0001; }
  getTickVal(symbol) { return INSTRUMENTS[symbol]?.tickVal || 10; }
  getDisplay(symbol) { return INSTRUMENTS[symbol]?.display || symbol; }
}

window.INSTRUMENTS = INSTRUMENTS;
window.marketData  = new MarketData();
