// aiAnalysis.js — Groq-powered AI market commentary & signal reasoning

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

class AIAnalyzer {
  constructor() {
    this.apiKey = '';
    this.cache  = {}; // signal.id -> analysis
    this.enabled = false;
  }

  setApiKey(key) {
    this.apiKey  = key;
    this.enabled = !!key;
  }

  async analyzeSignal(signal, challenge) {
    if (!this.enabled || !this.apiKey) {
      return this._offlineReasoning(signal, challenge);
    }
    if (this.cache[signal.id]) return this.cache[signal.id];

    const prompt = this._buildPrompt(signal, challenge);
    try {
      const result = await this._callGroq(prompt);
      this.cache[signal.id] = result;
      return result;
    } catch (e) {
      console.warn('Groq AI failed:', e.message);
      return this._offlineReasoning(signal, challenge);
    }
  }

  async _callGroq(userPrompt) {
    const body = {
      model: GROQ_MODEL,
      temperature: 0.4,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content: `You are an elite prop firm trading coach. Given a trading signal and challenge context, write a concise 2-3 sentence analysis explaining the setup quality, key risk factors, and what the trader should watch. Be direct, data-driven, and prop-firm aware. Never give generic advice. Focus on why this specific setup is or isn't ideal RIGHT NOW for someone protecting a prop firm challenge account.`,
        },
        { role: 'user', content: userPrompt },
      ],
    };

    const fn = window.electronAPI?.fetchPost;
    if (fn) {
      const res = await fn({
        url: GROQ_URL,
        body,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.choices?.[0]?.message?.content?.trim() || this._offlineReasoning({ reasons: [] });
    }
    throw new Error('No fetch method available');
  }

  _buildPrompt(signal, challenge) {
    const firm = challenge ? `${challenge.firm?.name} challenge (${challenge.profitPct?.toFixed(2)}% profit so far, ${challenge.drawdownProgress?.toFixed(1)}% drawdown used)` : 'unknown firm';
    return `Signal: ${signal.direction} ${signal.display} at ${signal.entry}
Stop Loss: ${signal.sl} | TP1: ${signal.tp1} | TP2: ${signal.tp2}
R:R Ratio: ${signal.rrRatio}:1 | Confidence: ${signal.confidence}%
RSI: ${signal.rsi} | MACD: ${signal.macd?.bullish ? 'bullish' : signal.macd?.bearish ? 'bearish' : 'neutral'} | Volume: ${signal.volume}
Key reasons: ${signal.reasons.join('; ')}
Prop firm context: ${firm}
Timeframe: ${signal.timeframe}

Write a concise trader's briefing for this setup.`;
  }

  // ── Offline reasoning (no API key needed) ─────────────────────────────────
  _offlineReasoning(signal, challenge) {
    const { direction, confidence, rsi, volume, reasons } = signal;
    const isBuy  = direction === 'BUY';
    const strength = confidence >= 80 ? 'strong' : confidence >= 70 ? 'moderate' : 'weak';

    let analysis = '';

    if (isBuy) {
      if (rsi < 35) analysis += `RSI at ${rsi} indicates deeply oversold conditions, increasing the probability of a mean-reversion bounce. `;
      else analysis += `Bullish momentum is building across multiple timeframe indicators. `;
    } else {
      if (rsi > 65) analysis += `RSI at ${rsi} signals overbought conditions with sellers likely to take control. `;
      else analysis += `Bearish momentum confirmed across multiple indicators with price showing weakness. `;
    }

    analysis += `Confluence score of ${confidence}% represents a ${strength} setup. `;

    if (volume === 'high') analysis += 'Above-average volume confirms the directional move — institutional participation likely. ';
    else if (volume === 'low') analysis += 'Low volume caution: consider waiting for volume confirmation before entering. ';

    if (challenge) {
      const risk = challenge.drawdownProgress;
      if (risk > 70) analysis += 'Account drawdown is elevated — consider using reduced position sizing.';
      else if (risk > 40) analysis += 'Moderate drawdown risk — stick to the calculated position size.';
      else analysis += 'Account health is good — this is a suitable setup given current challenge standing.';
    }

    return analysis;
  }
}

window.aiAnalyzer = new AIAnalyzer();
