// aiAnalysis.js — Groq-powered AI signal analysis and reasoning

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

class AIAnalyzer {
  constructor() {
    this.apiKey  = '';
    // FIX: cache key was signal.id (timestamp-based) — never hit.
    // Now uses symbol+direction+confidence for stable hits.
    this.cache   = {};
    this.enabled = false;
  }

  setApiKey(key) {
    this.apiKey  = key.trim();
    this.enabled = !!this.apiKey;
  }

  async analyzeSignal(signal, challenge) {
    if (!this.enabled) return this._offlineReasoning(signal, challenge);

    // Stable cache key: symbol + direction + confidence bracket (not timestamp)
    const cacheKey = signal.symbol + '-' + signal.direction + '-' + Math.floor(signal.confidence / 5) * 5;
    if (this.cache[cacheKey]) return this.cache[cacheKey];

    try {
      const result = await this._callGroq(this._buildPrompt(signal, challenge));
      this.cache[cacheKey] = result;
      return result;
    } catch (e) {
      console.warn('Groq AI call failed:', e.message);
      return this._offlineReasoning(signal, challenge);
    }
  }

  // ── Build context-aware prompt ─────────────────────────────────────────────
  _buildPrompt(signal, challenge) {
    const firmName   = (challenge && challenge.firm && challenge.firm.name) ? challenge.firm.name : 'prop firm';
    const profitPct  = (challenge && challenge.profitPct) ? challenge.profitPct.toFixed(2) : '0.00';
    const ddProgress = (challenge && challenge.drawdownProgress) ? challenge.drawdownProgress.toFixed(1) : '0.0';
    const ddLabel    = (challenge && challenge.isTrailingFirm) ? 'trailing DD used' : 'max drawdown used';
    const trend4H    = signal.trend4H && signal.trend4H !== 'none' ? ('4H trend: ' + signal.trend4H) : '';
    const volReg     = signal.volRegime ? ('Volatility regime: ' + signal.volRegime) : '';

    let apexContext = '';
    if (challenge && challenge.firmKey === 'apex') {
      const preset = challenge.apexAccount;
      const room   = challenge.trailingRoomRemaining ? challenge.trailingRoomRemaining.toFixed(0) : '?';
      const target = (preset && preset.profitTarget) ? preset.profitTarget : '?';
      const days   = challenge.tradingDays || 0;
      apexContext  = '\nApex trailing floor: $' + room + ' remaining | Profit target: $' + target + ' | Trading days: ' + days + '/7';
      if (challenge.apexConsistencyPct > 0) {
        apexContext += ' | Daily consistency: ' + challenge.apexConsistencyPct.toFixed(0) + '% of 30% cap';
      }
    }

    return [
      'Signal: ' + signal.direction + ' ' + signal.display + ' @ ' + signal.entry,
      'SL: ' + signal.sl + ' | TP1: ' + signal.tp1 + ' | TP2: ' + signal.tp2,
      'R:R: ' + signal.rrRatio + ':1 | Confidence: ' + signal.confidence + '%',
      'RSI: ' + signal.rsi + ' | MACD: ' + (signal.macd && signal.macd.bullish ? 'bullish' : signal.macd && signal.macd.bearish ? 'bearish' : 'neutral') + ' | Volume: ' + signal.volume,
      trend4H,
      volReg,
      'Key factors: ' + signal.reasons.slice(0, 3).join('; '),
      'Challenge: ' + firmName + ' | Profit: ' + profitPct + '% | ' + ddProgress + '% ' + ddLabel + apexContext,
      '',
      'Write a concise 2-3 sentence trader briefing.',
    ].filter(Boolean).join('\n');
  }

  // ── Groq API call via Electron IPC ────────────────────────────────────────
  async _callGroq(userPrompt) {
    const body = {
      model: GROQ_MODEL,
      temperature: 0.30,
      max_tokens: 180,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise, data-driven prop firm trading coach. ' +
            'Analyze trading signals for traders running prop firm challenges (primarily Apex Trader Funding). ' +
            'Multi-timeframe confluence, trailing drawdown risk, and R:R quality are the key factors. ' +
            'Be direct. Reference specific numbers. No generic advice. No emojis. No disclaimers. ' +
            '2-3 sentences maximum in plain professional prose.',
        },
        { role: 'user', content: userPrompt },
      ],
    };

    const fn = window.electronAPI && window.electronAPI.fetchPost;
    if (!fn) throw new Error('Electron IPC not available');

    const res = await fn({ url: GROQ_URL, body, headers: { Authorization: 'Bearer ' + this.apiKey } });
    const text = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    return (text && text.trim()) ? text.trim() : this._offlineReasoning({ reasons: [] });
  }

  // ── Offline reasoning fallback (no API key required) ──────────────────────
  _offlineReasoning(signal, challenge) {
    if (!signal) return '';
    const { direction, confidence, rsi, volume, volRegime, trend4H, reasons } = signal;
    const isBuy    = direction === 'BUY';
    const strength = confidence >= 80 ? 'strong' : confidence >= 70 ? 'moderate' : 'borderline';
    let text = '';

    if (isBuy) {
      text += rsi < 35
        ? 'RSI at ' + rsi + ' indicates oversold conditions, elevating mean-reversion probability on the long side. '
        : 'Bullish momentum is aligned across multiple indicators, supporting a long entry. ';
    } else {
      text += rsi > 65
        ? 'RSI at ' + rsi + ' signals overbought conditions with downside pressure building. '
        : 'Bearish alignment across indicators suggests continued selling pressure. ';
    }

    if (trend4H && trend4H !== 'none' && trend4H !== 'neutral') {
      const aligned = (trend4H === 'bullish' && isBuy) || (trend4H === 'bearish' && !isBuy);
      text += aligned
        ? '4H trend confirms this direction — multi-timeframe confluence adds conviction. '
        : 'Note: this trade runs counter to the 4H ' + trend4H + ' trend — exercise extra caution. ';
    }

    text += 'Confluence score of ' + confidence + '% represents a ' + strength + ' setup';

    if (volRegime === 'high') {
      text += ' in an elevated-volatility environment — position sizing accounts for wider ATR.';
    } else if (volume === 'low') {
      text += '; low volume is a concern, consider waiting for volume confirmation.';
    } else {
      text += '.';
    }

    if (challenge) {
      if (challenge.isTrailingFirm) {
        const room = challenge.trailingRoomRemaining ? challenge.trailingRoomRemaining.toFixed(0) : null;
        if (room) {
          const pct = challenge.drawdownProgress || 0;
          if (pct > 70) {
            text += ' Trailing room is critically low ($' + room + ') — reduce size immediately.';
          } else if (pct > 40) {
            text += ' Trailing room is $' + room + ' — stick to the calculated position size.';
          } else {
            text += ' Trailing room is healthy ($' + room + '), account is well-positioned.';
          }
        }
      } else {
        const dd = challenge.drawdownProgress || 0;
        if (dd > 70) text += ' Account drawdown is elevated — use reduced position sizing.';
        else if (dd > 40) text += ' Moderate drawdown — stick to the calculated position size.';
      }
    }

    return text.trim();
  }
}

window.aiAnalyzer = new AIAnalyzer();
