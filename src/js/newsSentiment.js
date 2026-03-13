// newsSentiment.js — Market news fetching, sentiment scoring, ForexFactory calendar, and price reaction analysis

// Alpha Vantage doesn't have futures tickers — use tracking ETF proxies so
// the NEWS_SENTIMENT endpoint returns relevant articles for each contract.
const AV_FUTURES_PROXY = {
  'ES': 'SPY',  'MES': 'SPY',
  'NQ': 'QQQ',  'MNQ': 'QQQ',
  'YM': 'DIA',
  'RTY': 'IWM',
  'CL': 'USO',
  'GC': 'GLD',
  'SI': 'SLV',
  'NG': 'UNG',
};

// Maps instruments to their Finnhub/news category keywords
const NEWS_TOPICS = {
  'EURUSD': ['EUR', 'euro', 'ECB', 'European Central Bank'],
  'GBPUSD': ['GBP', 'pound', 'Bank of England', 'BoE', 'Brexit'],
  'USDJPY': ['JPY', 'yen', 'Bank of Japan', 'BOJ'],
  'GBPJPY': ['GBP', 'pound', 'JPY', 'yen'],
  'XAUUSD': ['gold', 'XAU', 'precious metals', 'safe haven'],
  'AUDUSD': ['AUD', 'Australian dollar', 'RBA'],
  'USDCAD': ['CAD', 'Canadian dollar', 'oil', 'Bank of Canada'],
  'ES':     ['S&P 500', 'SPX', 'S&P', 'stocks', 'equities', 'Federal Reserve', 'Fed', 'inflation', 'CPI'],
  'NQ':     ['Nasdaq', 'tech stocks', 'technology', 'AI', 'semiconductor'],
  'YM':     ['Dow Jones', 'DJIA', 'blue chip'],
  'RTY':    ['Russell 2000', 'small cap'],
  'CL':     ['crude oil', 'WTI', 'OPEC', 'oil supply', 'petroleum'],
  'GC':     ['gold', 'XAU', 'precious metals', 'inflation hedge'],
  'MNQ':    ['Nasdaq', 'tech stocks'],
  'MES':    ['S&P 500', 'SPX'],
  'BTCUSDT':['Bitcoin', 'BTC', 'crypto', 'cryptocurrency'],
  'ETHUSDT':['Ethereum', 'ETH', 'crypto', 'DeFi'],
  'SOLUSDT':['Solana', 'SOL', 'crypto'],
};

// Positive/negative keywords for rule-based sentiment scoring
const POSITIVE_WORDS = new Set([
  'rise', 'rises', 'rose', 'surge', 'surges', 'gain', 'gains', 'rally', 'rallies',
  'bullish', 'strong', 'strength', 'recovery', 'rebounds', 'rebound', 'up',
  'positive', 'beat', 'beats', 'better', 'higher', 'growth', 'boost', 'buy',
  'upgrade', 'outperform', 'record', 'high', 'optimistic', 'hawkish',
]);

const NEGATIVE_WORDS = new Set([
  'fall', 'falls', 'fell', 'drop', 'drops', 'plunge', 'plunges', 'slide', 'slides',
  'bearish', 'weak', 'weakness', 'selloff', 'sell-off', 'decline', 'declines', 'down',
  'negative', 'miss', 'misses', 'worse', 'lower', 'contraction', 'fear', 'risk',
  'downgrade', 'underperform', 'crash', 'low', 'pessimistic', 'dovish', 'recession',
  'inflation', 'tariff', 'tariffs', 'war', 'geopolitical', 'uncertainty',
]);

// High-impact economic event keywords
const HIGH_IMPACT_WORDS = new Set([
  'NFP', 'non-farm payroll', 'CPI', 'inflation', 'Federal Reserve', 'Fed', 'FOMC',
  'interest rate', 'rate decision', 'GDP', 'unemployment', 'jobs report',
  'ECB', 'Bank of England', 'Bank of Japan', 'earnings', 'beat', 'miss',
  'war', 'sanction', 'crisis', 'emergency', 'catastrophe',
]);

class NewsSentiment {
  constructor() {
    this.finnhubKey   = '';        // optional — Finnhub free tier
    this.cache        = {};        // symbol -> { articles, score, ts }
    this.CACHE_TTL    = 15 * 60 * 1000;  // 15 min news cache
    this.marketNews   = [];        // global market news items
    this.lastUpdate   = null;
  }

  setFinnhubKey(key) { this.finnhubKey = key.trim(); }

  // ── Fetch and score news for a symbol ────────────────────────────────────
  async getNewsSentiment(symbol) {
    const now    = Date.now();
    const cached = this.cache[symbol];
    if (cached && (now - cached.ts) < this.CACHE_TTL) return cached;

    let articles = [];
    try {
      if (this.finnhubKey) {
        articles = await this._fetchFinnhub(symbol);
      } else {
        // Fallback: fetch from Alpha Vantage news if AV key exists
        if (window.marketData?.avApiKey) {
          articles = await this._fetchAlphaVantageNews(symbol);
        }
      }
    } catch(e) {
      console.warn(`News fetch failed for ${symbol}:`, e.message);
    }

    const scored = this._scoreArticles(articles, symbol);
    const result = {
      symbol,
      articles: scored.articles.slice(0, 5),
      score:    scored.score,       // -100 to +100
      label:    this._scoreLabel(scored.score),
      impact:   scored.impact,      // 'high' | 'medium' | 'low'
      summary:  scored.summary,
      ts:       now,
    };

    this.cache[symbol] = result;
    return result;
  }

  // ── Fetch from Finnhub (free tier: 60 req/min) ───────────────────────────
  async _fetchFinnhub(symbol) {
    const inst    = window.INSTRUMENTS?.[symbol];
    if (!inst) return [];

    // Determine Finnhub category
    let category = 'general';
    if (inst.type === 'forex')   category = 'forex';
    if (inst.type === 'crypto')  category = 'crypto';
    if (inst.type === 'futures') category = 'general';

    const from  = new Date(Date.now() - 48 * 3600000).toISOString().split('T')[0];
    const to    = new Date().toISOString().split('T')[0];
    const url   = `https://finnhub.io/api/v1/news?category=${category}&token=${this.finnhubKey}`;

    const data = await window.marketData._fetch(url);
    if (!Array.isArray(data)) return [];

    const topics = NEWS_TOPICS[symbol] || [];
    return data.filter(a => {
      const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
      return topics.some(t => text.includes(t.toLowerCase()));
    }).slice(0, 10).map(a => ({
      headline: a.headline,
      summary:  a.summary || '',
      source:   a.source,
      time:     a.datetime * 1000,
      url:      a.url,
    }));
  }

  // ── Fetch from Alpha Vantage News Sentiment (premium endpoint) ────────────
  async _fetchAlphaVantageNews(symbol) {
    const avKey = window.marketData?.avApiKey;
    if (!avKey) return [];

    const inst  = window.INSTRUMENTS?.[symbol];
    const topics = NEWS_TOPICS[symbol];
    if (!topics) return [];

    // AV NEWS_SENTIMENT endpoint — free with premium key
    // Futures: use ETF proxies since AV doesn't index futures symbols directly
    const tickers = inst?.type === 'crypto'  ? symbol.replace('USDT', '') :
                    inst?.type === 'forex'    ? `FOREX:${inst.av}${inst.quote}` :
                    inst?.type === 'futures'  ? (AV_FUTURES_PROXY[symbol] || 'SPY') :
                    symbol;

    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${tickers}&sort=LATEST&limit=10&apikey=${avKey}`;

    try {
      const data  = await window.marketData._fetch(url);
      const feed  = data?.feed;
      if (!Array.isArray(feed)) return [];
      return feed.map(a => ({
        headline: a.title,
        summary:  a.summary || '',
        source:   a.source,
        time:     new Date(a.time_published).getTime(),
        score:    parseFloat(a.overall_sentiment_score || 0),
        label:    a.overall_sentiment_label || 'Neutral',
      }));
    } catch(e) {
      return [];
    }
  }

  // ── Rule-based sentiment scoring ──────────────────────────────────────────
  _scoreArticles(articles, symbol) {
    const topics = (NEWS_TOPICS[symbol] || []).map(t => t.toLowerCase());
    let totalScore   = 0;
    let totalWeight  = 0;
    let hasHighImpact = false;
    const scored = [];

    for (const art of articles) {
      const text    = ((art.headline || '') + ' ' + (art.summary || '')).toLowerCase();
      const words   = text.split(/\W+/);

      // Check for high-impact events
      const isHighImpact = [...HIGH_IMPACT_WORDS].some(w => text.includes(w.toLowerCase()));
      if (isHighImpact) hasHighImpact = true;

      // Check relevance
      const isRelevant = topics.some(t => text.includes(t));
      if (!isRelevant && articles.length > 3) continue;

      // Score words
      let pos = 0, neg = 0;
      for (const word of words) {
        if (POSITIVE_WORDS.has(word)) pos++;
        if (NEGATIVE_WORDS.has(word)) neg++;
      }

      // Use pre-computed score if available (from AV)
      let rawScore = art.score !== undefined ? art.score * 100 :
                     (pos - neg) / Math.max(1, pos + neg) * 100;

      const weight = isHighImpact ? 2 : 1;
      totalScore  += rawScore * weight;
      totalWeight += weight;

      // Recency decay: articles > 6h old have less weight
      const ageHours = (Date.now() - (art.time || 0)) / 3600000;
      const recency  = ageHours < 1 ? 1.0 : ageHours < 6 ? 0.8 : 0.5;

      scored.push({
        ...art,
        sentScore: parseFloat(rawScore.toFixed(1)),
        sentLabel: rawScore > 15 ? 'Bullish' : rawScore < -15 ? 'Bearish' : 'Neutral',
        highImpact: isHighImpact,
        recency,
      });
    }

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const summary    = this._buildSummary(scored, symbol, finalScore);

    return {
      articles: scored,
      score:    parseFloat(Math.max(-100, Math.min(100, finalScore)).toFixed(1)),
      impact:   hasHighImpact ? 'high' : scored.length >= 3 ? 'medium' : 'low',
      summary,
    };
  }

  _scoreLabel(score) {
    if (score >=  30) return 'Strongly Bullish';
    if (score >=  10) return 'Mildly Bullish';
    if (score <= -30) return 'Strongly Bearish';
    if (score <= -10) return 'Mildly Bearish';
    return 'Neutral';
  }

  _buildSummary(articles, symbol, score) {
    if (articles.length === 0) {
      return 'No recent news found. Market likely trading on technicals.';
    }
    const display  = window.INSTRUMENTS?.[symbol]?.display || symbol;
    const label    = this._scoreLabel(score);
    const highImps = articles.filter(a => a.highImpact);
    if (highImps.length > 0) {
      return `High-impact events in the news for ${display}. Sentiment: ${label}. Key: ${highImps[0].headline?.slice(0, 80) || ''}`;
    }
    return `${articles.length} recent articles found for ${display}. Aggregate sentiment: ${label}.`;
  }

  // ── Analyze how market historically reacts to similar news ────────────────
  analyzeNewsReaction(sentimentScore, candles1m) {
    if (!candles1m || candles1m.length < 5) return null;

    // Compute recent price momentum (last 5 min vs 15 min ago)
    const last  = candles1m[candles1m.length - 1].close;
    const ago5  = candles1m[Math.max(0, candles1m.length - 5)].close;
    const ago15 = candles1m[Math.max(0, candles1m.length - 15)].close;

    const move5m  = ((last - ago5)  / ago5  * 100);
    const move15m = ((last - ago15) / ago15 * 100);

    // Determine if price is reacting to news sentiment direction
    const newsDir = sentimentScore > 10 ? 'bullish' : sentimentScore < -10 ? 'bearish' : 'neutral';
    const priceDir = move5m > 0.02 ? 'bullish' : move5m < -0.02 ? 'bearish' : 'neutral';

    const aligned    = newsDir !== 'neutral' && newsDir === priceDir;
    const diverging  = newsDir !== 'neutral' && newsDir !== priceDir && priceDir !== 'neutral';

    return {
      newsDirection:  newsDir,
      priceDirection: priceDir,
      move5m:         parseFloat(move5m.toFixed(4)),
      move15m:        parseFloat(move15m.toFixed(4)),
      aligned,
      diverging,
      // Divergence = potential mean reversion opportunity
      insight: diverging
        ? `Price moving against ${newsDir} sentiment — potential mean-reversion setup`
        : aligned
          ? `Price confirming ${newsDir} news sentiment — trend continuation bias`
          : 'Neutral news environment — price action driven by technicals',
    };
  }

  // ── Global market news (macro events, economic calendar) ─────────────────
  async getMarketNews() {
    const now = Date.now();
    if (this.lastUpdate && now - this.lastUpdate < this.CACHE_TTL) {
      return this.marketNews;
    }

    try {
      if (this.finnhubKey) {
        const data = await window.marketData._fetch(
          `https://finnhub.io/api/v1/news?category=general&token=${this.finnhubKey}`
        );
        if (Array.isArray(data)) {
          this.marketNews = data.slice(0, 8).map(a => ({
            headline:  a.headline,
            source:    a.source,
            time:      a.datetime * 1000,
            sentiment: this._quickScore(a.headline + ' ' + (a.summary || '')),
          }));
        }
      }
    } catch(e) {}

    this.lastUpdate = now;
    return this.marketNews;
  }

  _quickScore(text) {
    const words = text.toLowerCase().split(/\W+/);
    let pos = 0, neg = 0;
    for (const w of words) {
      if (POSITIVE_WORDS.has(w)) pos++;
      if (NEGATIVE_WORDS.has(w)) neg++;
    }
    const score = (pos - neg) / Math.max(1, pos + neg) * 100;
    return this._scoreLabel(score);
  }
}

window.newsSentiment = new NewsSentiment();

// ── ForexFactory calendar support ─────────────────────────────────────────────
// Country currency codes → instruments that care about that country's events
const FF_COUNTRY_MAP = {
  'USD': ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','XAUUSD','ES','NQ','YM','RTY','CL','GC','MNQ','MES','BTCUSDT','ETHUSDT','SOLUSDT'],
  'EUR': ['EURUSD'],
  'GBP': ['GBPUSD','GBPJPY'],
  'JPY': ['USDJPY','GBPJPY'],
  'AUD': ['AUDUSD'],
  'CAD': ['USDCAD'],
  'XAU': ['XAUUSD','GC'],
  'CNY': ['BTCUSDT','ETHUSDT','SOLUSDT'],  // China PMI moves crypto
  'CNH': ['BTCUSDT'],
};

// Augment NewsSentiment with ForexFactory methods
Object.assign(NewsSentiment.prototype, {

  // ── Fetch this week's ForexFactory calendar (cached 5 min) ───────────────
  async getForexFactoryCalendar() {
    const now = Date.now();
    if (this._ffCache && now - this._ffCache.ts < 5 * 60 * 1000) {
      return this._ffCache.events;
    }

    try {
      const data = await window.marketData._fetch(
        'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
      );
      if (!Array.isArray(data)) return [];

      const events = data.map(e => ({
        title:    e.title   || '',
        country:  (e.country || '').toUpperCase(),
        date:     e.date    || '',
        time:     e.time    || '',
        impact:   e.impact  || 'Low',      // 'High' | 'Medium' | 'Low' | 'Holiday'
        forecast: e.forecast || '',
        previous: e.previous || '',
        actual:   e.actual   || '',
        ts:       this._ffParseTime(e.date, e.time),
      }));

      this._ffCache = { events, ts: now };
      return events;
    } catch(e) {
      console.warn('ForexFactory fetch failed:', e.message);
      return this._ffCache?.events || [];
    }
  },

  // ── Parse FF date/time string to unix ms ──────────────────────────────────
  _ffParseTime(date, time) {
    try {
      // FF format: date = "01-13-2025", time = "8:30am" (ET) or "All Day"
      if (!date || !time || time === 'All Day' || time === 'Tentative') {
        return new Date(date || Date.now()).getTime();
      }
      // Convert to UTC by assuming Eastern Time (UTC-5 / UTC-4 DST)
      // We just want approximate time for "upcoming in N hours" logic
      const dt = new Date(`${date} ${time} EST`);
      return isNaN(dt.getTime()) ? Date.now() : dt.getTime();
    } catch { return Date.now(); }
  },

  // ── Get upcoming events for a symbol within hoursAhead ───────────────────
  async getUpcomingEvents(symbol, hoursAhead = 24) {
    const events = await this.getForexFactoryCalendar();
    const now    = Date.now();
    const cutoff = now + hoursAhead * 3600000;

    // Which countries matter for this symbol?
    const relevantCountries = new Set();
    for (const [country, instruments] of Object.entries(FF_COUNTRY_MAP)) {
      if (instruments.includes(symbol)) relevantCountries.add(country);
    }
    if (relevantCountries.size === 0) return [];

    return events
      .filter(e => {
        if (!relevantCountries.has(e.country)) return false;
        if (e.ts < now - 3600000) return false;   // skip events > 1h in past
        if (e.ts > cutoff) return false;
        return e.impact === 'High' || e.impact === 'Medium';
      })
      .sort((a, b) => a.ts - b.ts);
  },
});
