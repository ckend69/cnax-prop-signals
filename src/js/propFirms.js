// propFirms.js — Prop firm challenge presets & rule definitions

const PROP_FIRMS = {
  ftmo: {
    name: 'FTMO',
    logo: 'FTMO',
    color: '#3b82f6',
    type: 'forex',
    markets: ['forex', 'indices', 'commodities', 'crypto'],
    phases: [
      {
        name: 'Phase 1 — Challenge',
        profitTargetPct: 10,
        maxLossPct: 10,
        dailyLossPct: 5,
        minDays: 4,
        maxDays: null,
        bestDayRule: false,
        consistencyRule: null,
        notes: 'Daily loss calculated from prior day balance at midnight CET. Includes swaps & commissions.',
      },
      {
        name: 'Phase 2 — Verification',
        profitTargetPct: 5,
        maxLossPct: 10,
        dailyLossPct: 5,
        minDays: 4,
        maxDays: null,
        bestDayRule: false,
        consistencyRule: null,
        notes: 'Same drawdown rules as Phase 1.',
      },
    ],
    accounts: [10000, 25000, 50000, 100000, 200000],
    profitSplit: 90,
    drawdownType: 'balance',  // calculated from balance, not trailing
  },

  apex: {
    name: 'Apex Trader Funding',
    logo: 'APEX',
    color: '#f59e0b',
    type: 'futures',
    markets: ['futures'],
    phases: [
      {
        name: 'Evaluation',
        profitTargetPct: null,    // dollar-based, see accounts
        maxLossPct: null,         // trailing drawdown, see accounts
        dailyLossPct: null,       // no daily loss limit
        minDays: 7,
        maxDays: null,
        consistencyRule: 30,      // no single day > 30% of total profits
        notes: 'Trailing drawdown based on peak open equity. Stops trailing once threshold is locked. EOD close required by 4:59 PM ET.',
      },
    ],
    accounts: [
      { size: 25000,  trailingDrawdown: 1500,  profitTarget: 1500  },
      { size: 50000,  trailingDrawdown: 2500,  profitTarget: 3000  },
      { size: 75000,  trailingDrawdown: 2750,  profitTarget: 4500  },
      { size: 100000, trailingDrawdown: 3000,  profitTarget: 6000  },
      { size: 150000, trailingDrawdown: 5000,  profitTarget: 9000  },
      { size: 250000, trailingDrawdown: 6500,  profitTarget: 15000 },
      { size: 300000, trailingDrawdown: 7500,  profitTarget: 20000 },
    ],
    profitSplit: 100,   // 100% first $25K, 90% after
    drawdownType: 'trailing',
    paRules: {
      consistencyPct: 30,     // no day > 30% of total profit
      maxOpenLossPct: 30,     // open loss cannot exceed 30% of profit balance
      maxRR: 5,               // 5:1 max risk:reward
      noHedging: true,
      contractScaling: true,  // start at 50% contracts
    },
  },

  tft: {
    name: 'The Funded Trader',
    logo: 'TFT',
    color: '#8b5cf6',
    type: 'forex',
    markets: ['forex', 'crypto', 'indices'],
    challenges: {
      standard: {
        name: 'Standard (2-Phase)',
        phases: [
          { name: 'Phase 1', profitTargetPct: 10, maxLossPct: 10, dailyLossPct: 5, minDays: 3 },
          { name: 'Phase 2', profitTargetPct: 5,  maxLossPct: 10, dailyLossPct: 5, minDays: 3 },
        ],
      },
      rapid: {
        name: 'Rapid (1-Phase)',
        phases: [
          { name: 'Phase 1', profitTargetPct: 8, maxLossPct: 8, dailyLossPct: 5, minDays: 3 },
        ],
      },
      knight: {
        name: 'Knight Pro (1-Phase)',
        phases: [
          { name: 'Phase 1', profitTargetPct: 10, maxLossPct: 10, dailyLossPct: 3, minDays: 3 },
        ],
      },
      royal: {
        name: 'Royal Pro (2-Phase)',
        phases: [
          { name: 'Phase 1', profitTargetPct: 8, maxLossPct: 10, dailyLossPct: 5, minDays: 3 },
          { name: 'Phase 2', profitTargetPct: 4, maxLossPct: 10, dailyLossPct: 5, minDays: 3 },
        ],
      },
    },
    accounts: [5000, 10000, 25000, 50000, 100000, 200000],
    profitSplit: 80,
    drawdownType: 'balance',
    softBreachPolicy: { maxBreaches: 3, action: 'pause_day' },
    resetTime: '17:00 EST',
  },

  myfundedfx: {
    name: 'MyFundedFX',
    logo: 'MFFX',
    color: '#10b981',
    type: 'forex',
    markets: ['forex', 'indices', 'commodities', 'crypto'],
    phases: [
      { name: 'Phase 1', profitTargetPct: 10, maxLossPct: 10, dailyLossPct: 5, minDays: 5 },
      { name: 'Phase 2', profitTargetPct: 5,  maxLossPct: 10, dailyLossPct: 5, minDays: 5 },
    ],
    accounts: [10000, 25000, 50000, 100000, 200000],
    profitSplit: 80,
    drawdownType: 'balance',
  },

  e8funding: {
    name: 'E8 Funding',
    logo: 'E8',
    color: '#ef4444',
    type: 'forex',
    markets: ['forex', 'indices', 'commodities', 'crypto'],
    phases: [
      { name: 'Phase 1', profitTargetPct: 8, maxLossPct: 8, dailyLossPct: 4, minDays: 3 },
      { name: 'Phase 2', profitTargetPct: 5, maxLossPct: 8, dailyLossPct: 4, minDays: 3 },
    ],
    accounts: [25000, 50000, 100000, 250000],
    profitSplit: 80,
    drawdownType: 'equity',
  },

  topstep: {
    name: 'TopstepTrader',
    logo: 'TST',
    color: '#06b6d4',
    type: 'futures',
    markets: ['futures'],
    phases: [
      {
        name: 'Trading Combine',
        profitTargetPct: null,
        maxLossPct: null,
        dailyLossPct: null,
        minDays: 10,
        notes: 'Trailing drawdown, no daily loss limit. 3-day grace after loss. Must trade 10 out of 15 days.',
      },
    ],
    accounts: [
      { size: 50000,  trailingDrawdown: 2000, profitTarget: 3000  },
      { size: 100000, trailingDrawdown: 3000, profitTarget: 6000  },
      { size: 150000, trailingDrawdown: 4500, profitTarget: 9000  },
    ],
    profitSplit: 90,
    drawdownType: 'trailing',
  },

  custom: {
    name: 'Custom / Other',
    logo: 'CSTM',
    color: '#64748b',
    type: 'forex',
    markets: ['forex', 'futures', 'crypto', 'indices'],
    phases: [
      { name: 'Challenge', profitTargetPct: 10, maxLossPct: 10, dailyLossPct: 5, minDays: 5 },
    ],
    accounts: [10000, 25000, 50000, 100000],
    profitSplit: 80,
    drawdownType: 'balance',
    isCustom: true,
  },
};

// ── Challenge State Management ──────────────────────────────────────────────
class ChallengeState {
  constructor() {
    this.firmKey = 'ftmo';
    this.accountSize = 10000;
    this.currentPhase = 0;
    this.startingBalance = 10000;
    this.currentBalance = 10000;
    this.peakBalance = 10000;
    this.dailyStartBalance = 10000;
    this.dailyPnL = 0;
    this.totalPnL = 0;
    this.tradingDays = 0;
    this.trades = [];
    this.startDate = new Date();
    this.challengeType = 'standard';
  }

  get firm() { return PROP_FIRMS[this.firmKey]; }

  get phase() {
    const f = this.firm;
    if (f.phases) return f.phases[this.currentPhase];
    if (f.challenges) return f.challenges[this.challengeType]?.phases[this.currentPhase];
    return null;
  }

  get profitTargetPct() { return this.phase?.profitTargetPct || 10; }
  get maxLossPct()      { return this.phase?.maxLossPct      || 10; }
  get dailyLossPct()    { return this.phase?.dailyLossPct    || 5;  }

  get profitTargetAmt()  { return this.accountSize * (this.profitTargetPct / 100); }
  get maxLossAmt()       { return this.accountSize * (this.maxLossPct / 100); }
  get dailyLossAmt()     { return this.accountSize * (this.dailyLossPct / 100); }

  get maxDrawdownFloor() { return this.accountSize - this.maxLossAmt; }

  // For dollar-based firms (Apex), override from selected account preset
  get apexAccount() {
    if (this.firmKey !== 'apex') return null;
    return PROP_FIRMS.apex.accounts.find(a => a.size === this.accountSize)
      || PROP_FIRMS.apex.accounts[1];
  }

  get profitPct()      { return ((this.currentBalance - this.accountSize) / this.accountSize) * 100; }
  get drawdownPct()    { return ((this.accountSize - this.currentBalance) / this.accountSize) * 100; }
  get dailyLossUsed()  { return Math.max(0, this.dailyStartBalance - this.currentBalance); }
  get dailyLossPctUsed() { return (this.dailyLossUsed / this.accountSize) * 100; }

  get profitProgress() { return Math.min(100, (this.profitPct / this.profitTargetPct) * 100); }
  get drawdownProgress() { return Math.min(100, (this.drawdownPct / this.maxLossPct) * 100); }
  get dailyProgress()  { return Math.min(100, (this.dailyLossPctUsed / this.dailyLossPct) * 100); }

  get isBreached() {
    if (this.firmKey === 'apex') {
      const preset = this.apexAccount;
      if (!preset) return false;
      return (this.currentBalance < this.peakBalance - preset.trailingDrawdown) ||
             (this.currentBalance < this.accountSize - preset.trailingDrawdown);
    }
    return this.currentBalance < this.maxDrawdownFloor ||
           this.dailyLossUsed > this.dailyLossAmt;
  }

  get dailyBreached() {
    return this.dailyLossUsed >= this.dailyLossAmt;
  }

  get status() {
    if (this.isBreached) return 'BREACHED';
    if (this.profitPct >= this.profitTargetPct) return 'PASSED';
    if (this.dailyBreached) return 'DAILY_LIMIT';
    if (this.drawdownProgress > 80) return 'DANGER';
    if (this.drawdownProgress > 50) return 'WARNING';
    return 'ACTIVE';
  }

  // How much we can risk per trade to stay safe
  get safeRiskPerTrade() {
    const maxLossRemaining = this.currentBalance - this.maxDrawdownFloor;
    const dailyRemaining   = this.dailyLossAmt - this.dailyLossUsed;
    const usable           = Math.min(maxLossRemaining, dailyRemaining);
    // Risk max 2% of usable remaining room per trade
    return Math.max(0, usable * 0.15);
  }

  addTrade(pnl) {
    this.trades.push({ pnl, time: new Date(), balance: this.currentBalance + pnl });
    this.currentBalance += pnl;
    this.dailyPnL += pnl;
    this.totalPnL += pnl;
    if (this.currentBalance > this.peakBalance) this.peakBalance = this.currentBalance;
  }
}

window.PROP_FIRMS = PROP_FIRMS;
window.ChallengeState = ChallengeState;
