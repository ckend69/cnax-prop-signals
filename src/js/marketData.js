// marketData.js — Market data fetching (Binance + Alpha Vantage + Yahoo)

const INSTRUMENTS = {
  // Forex
  'EURUSD': { type: 'forex', av: 'EUR', quote: 'USD', display: 'EUR/USD', pip: 0.0001 },
  'GBPUSD': { type: 'forex', av: 'GBP', quote: 'USD', display: 'GBP/USD', pip: 0.0001 },
  'USDJPY': { type: 'forex', av: 'USD', quote: 'JPY', display: 'USD/JPY', pip: 0.01   },
  'XAUUSD': { type: 'forex', av: 'XAU', quote: 'USD', display: 'XAU/USD', pip: 0.01   },
  'AUDUSD': { type: 'forex', av: 'AUD', quote: 'USD', display: 'AUD/USD', pip: 0.0001 },
  'USDCAD': { type: 'forex', av: 'USD', quote: 'CAD', display: 'USD/CAD', pip: 0.0001 },
  // Futures
  'ES':     { type: 'futures', yf: 'ES=F',  display: 'S&P 500 (ES)',  pip: 0.25 },
  'NQ':     { type: 'futures', yf: 'NQ=F',  display: 'Nasdaq (NQ)',   pip: 0.25 },
  'CL':     { type: 'futures', yf: 'CL=F',  display: 'Crude Oil (CL)', pip: 0.01 },
  'GC':     { type: 'futures', yf: 'GC=F',  display: 'Gold (GC)',     pip: 0.1  },
  // Crypto
  'BTCUSDT':{ type: 'crypto', binance: 'BTCUSDT', display: 'BTC/USDT', pip: 1    },
  'ETHUSDT':{ type: 'crypto', binance: 'ETHUSDT', display: 'ETH/USDT', pip: 0.1  },
  'SOLUSDT':{ type: 'crypto', binance: 'SOLUSDT', display: 'SOL/USDT', pip: 0.01 },
};

class MarketData {
  constructor() {
    this.avApiKey   = '';   // set from settings
    this.cache      = {};   // symbol -> { candles, ts }
    this.prices     = {};   // symbol -> current price
    this.CACHE_TTL  = 5 * 60 * 1000; // 5 min
  }

  setAlphaVantageKey(key) { this.avApiKey = key; }

  // ── Candle Fetching ────────────────────────────────────────────────────────

  async getCandles(symbol, interval = '1h', limit = 120) {
    const now = Date.now();
    const cached = this.cache[symbol];
    if (cached && now - cached.ts < this.CACHE_TTL) return cached.candles;

    const inst = INSTRUMENTS[symbol];
    if (!inst) throw new Error(`Unknown symbol: ${symbol}`);

    let candles;
    try {
      if (inst.type === 'crypto') {
        candles = await this._fetchBinance(inst.binance, interval, limit);
      } else if (inst.type === 'futures') {
        candles = await this._fetchYahoo(inst.yf, interval, limit);
      } else {
        candles = await this._fetchAlphaVantage(inst.av, inst.quote, limit);
      }
    } catch (e) {
      console.warn(`Market data fetch failed for ${symbol}:`, e.message);
      candles = this._generateRealisticCandles(symbol, limit);
    }

    this.cache[symbol] = { candles, ts: now };
    if (candles.length > 0) this.prices[symbol] = candles[candles.length - 1].close;
    return candles;
  }

  // ── Binance (Crypto — free, no key) ───────────────────────────────────────
  async _fetchBinance(pair, interval, limit) {
    const intMap = { '1h': '1h', '4h': '4h', '1d': '1d', '15m': '15m' };
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

  // ── Alpha Vantage (Forex — needs free API key) ─────────────────────────────
  async _fetchAlphaVantage(from, to, limit) {
    if (!this.avApiKey) throw new Error('No Alpha Vantage API key');
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=60min&outputsize=compact&apikey=${this.avApiKey}`;

    const data = await this._fetch(url);
    const ts = data['Time Series FX (60min)'];
    if (!ts) throw new Error('Alpha Vantage rate limit or bad key');

    return Object.entries(ts).slice(0, limit).reverse().map(([time, v]) => ({
      time:   new Date(time).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: 1000,
    }));
  }

  // ── Yahoo Finance (Futures — unofficial) ──────────────────────────────────
  async _fetchYahoo(ticker, interval, limit) {
    const ivMap = { '1h': '1h', '4h': '1h', '1d': '1d' };
    const range = interval === '1d' ? '3mo' : '5d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${ivMap[interval]||'1h'}&range=${range}`;

    const data = await this._fetch(url);
    const res  = data?.chart?.result?.[0];
    if (!res) throw new Error('Yahoo Finance error');

    const ts     = res.timestamp;
    const quotes = res.indicators.quote[0];

    return ts.slice(-limit).map((t, i) => ({
      time:   t * 1000,
      open:   quotes.open[i]  || 0,
      high:   quotes.high[i]  || 0,
      low:    quotes.low[i]   || 0,
      close:  quotes.close[i] || 0,
      volume: quotes.volume[i]|| 0,
    })).filter(c => c.close > 0);
  }

  // ── Fetch helper (uses Electron IPC to bypass CORS) ────────────────────────
  async _fetch(url) {
    if (window.electronAPI) return window.electronAPI.fetchUrl(url);
    const r = await fetch(url);
    return r.json();
  }

  // ── Realistic Simulated Candles (fallback) ─────────────────────────────────
  _generateRealisticCandles(symbol, count) {
    const SEED_PRICES = {
      EURUSD: 1.0842, GBPUSD: 1.2643, USDJPY: 149.85, XAUUSD: 2385.0,
      AUDUSD: 0.6521, USDCAD: 1.3612, ES: 5285, NQ: 18420, CL: 78.4,
      GC: 2385, BTCUSDT: 68000, ETHUSDT: 3520, SOLUSDT: 182,
    };
    const base = SEED_PRICES[symbol] || 1.0;
    const volatility = base * 0.0025; // 0.25% per candle

    let price = base;
    const candles = [];
    const now = Date.now();

    for (let i = count; i >= 0; i--) {
      const change = (Math.random() - 0.495) * volatility;
      const open   = price;
      price        = Math.max(price * 0.98, price + change);
      const high   = Math.max(open, price) + Math.random() * volatility * 0.5;
      const low    = Math.min(open, price) - Math.random() * volatility * 0.5;

      candles.push({
        time:   now - i * 3600000,
        open:   parseFloat(open.toFixed(5)),
        high:   parseFloat(high.toFixed(5)),
        low:    parseFloat(low.toFixed(5)),
        close:  parseFloat(price.toFixed(5)),
        volume: Math.floor(Math.random() * 5000) + 1000,
        simulated: true,
      });
    }
    return candles;
  }

  // ── Live Price Polling (Binance WebSocket emulation via REST) ─────────────
  async refreshPrices(symbols) {
    const cryptos = symbols.filter(s => INSTRUMENTS[s]?.type === 'crypto');
    if (cryptos.length > 0) {
      try {
        const pairs = cryptos.map(s => `"${INSTRUMENTS[s].binance.toLowerCase()}@ticker"`).join(',');
        for (const s of cryptos) {
          const url = `https://api.binance.com/api/v3/ticker/price?symbol=${INSTRUMENTS[s].binance}`;
          const data = await this._fetch(url);
          if (data?.price) this.prices[s] = parseFloat(data.price);
        }
      } catch(e) { /* use cached */ }
    }
    return this.prices;
  }

  getPrice(symbol) { return this.prices[symbol] || 0; }
  getPip(symbol)   { return INSTRUMENTS[symbol]?.pip || 0.0001; }
  getDisplay(symbol) { return INSTRUMENTS[symbol]?.display || symbol; }
}

window.INSTRUMENTS = INSTRUMENTS;
window.marketData = new MarketData();
