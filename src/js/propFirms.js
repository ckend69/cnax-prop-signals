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
        notes: 'Daily loss calculated from prior day balance at midnight CET. Includes swaps & commissions.',
      },
      {
        name: 'Phase 2 — Verification',
        profitTargetPct: 5,
        maxLossPct: 10,
        dailyLossPct: 5,
        minDays: 4,
        maxDays: null,
        notes: 'Same drawdown rules as Phase 1.',
      },
    ],
    accounts: [10000, 25000, 50000, 100000, 200000],
    profitSplit: 90,
    drawdownType: 'balance',
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
        profitTargetPct: null,    // dollar-based — see accounts presets
        maxLossPct: null,         // trailing DD — see accounts presets
        dailyLossPct: null,       // no traditional daily loss limit
        minDays: 7,
        maxDays: null,
        consistencyRule: 30,      // no single day > 30% of total profit (PA funded rule)
        notes: 'Trailing drawdown based on peak open equity (including open P&L). EOD close required by 4:59 PM ET. No hedging. Contract scaling applies on funded accounts.',
      },
    ],
    // trailingDrawdown = maximum dollars you can drop from your peak equity
    // Once floor reaches accountSize the drawdown locks — you cannot breach below starting balance
    accounts: [
      { size: 25000,  trailingDrawdown: 1500,  profitTarget: 1500  },
      { size: 50000,  trailingDrawdown: 2500,  profitTarget: 3000  },
      { size: 75000,  trailingDrawdown: 2750,  profitTarget: 4500  },
      { size: 100000, trailingDrawdown: 3000,  profitTarget: 6000  },
      { size: 150000, trailingDrawdown: 5000,  profitTarget: 9000  },
      { size: 250000, trailingDrawdown: 6500,  profitTarget: 15000 },
      { size: 300000, trailingDrawdown: 7500,  profitTarget: 20000 },
    ],
    profitSplit: 90,
    drawdownType: 'trailing',
    paRules: {
      consistencyPct: 30,     // no single day > 30% of total profit
      noHedging: true,
      contractScaling: true,  // start at 50% contracts on funded accounts
    },
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
        notes: 'Trailing drawdown based on peak equity. 3-day grace after loss. Must trade 10 of 15 days.',
      },
    ],
    accounts: [
      { size: 50000,  trailingDrawdown: 2000, profitTarget: 3000 },
      { size: 100000, trailingDrawdown: 3000, profitTarget: 6000 },
      { size: 150000, trailingDrawdown: 4500, profitTarget: 9000 },
    ],
    profitSplit: 90,
    drawdownType: 'trailing',
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
    this.firmKey            = 'apex';          // Default to Apex Trader Funding
    this.accountSize        = 25000;           // Default: $25K Apex account
    this.currentPhase       = 0;
    this.startingBalance    = 25000;
    this.currentBalance     = 25000;
    this.peakBalance        = 25000;           // Highest equity ever (includes open P&L)
    this.dailyStartBalance  = 25000;           // Balance at start of current trading session
    this.dailyPnL           = 0;
    this.totalPnL           = 0;
    this.tradingDays        = 0;
    this.trades             = [];
    this.startDate          = new Date();
    this.challengeType      = 'standard';
    this.openTradesPnL      = 0;               // Unrealized P&L from open positions
  }

  get firm() { return PROP_FIRMS[this.firmKey]; }

  get phase() {
    const f = this.firm;
    if (f.phases) return f.phases[this.currentPhase];
    if (f.challenges) return f.challenges[this.challengeType]?.phases[this.currentPhase];
    return null;
  }

  // ── Apex / trailing-DD account preset ────────────────────────────────────
  get apexAccount() {
    const firm = PROP_FIRMS[this.firmKey];
    if (!firm || firm.drawdownType !== 'trailing') return null;
    const accts = Array.isArray(firm.accounts) ? firm.accounts : [];
    return accts.find(a => a.size === this.accountSize) || accts[0] || null;
  }

  get isTrailingFirm() {
    return PROP_FIRMS[this.firmKey]?.drawdownType === 'trailing';
  }

  // ── Trailing drawdown floor ────────────────────────────────────────────────
  // Floor = peakBalance - trailingDD, but never lower than (startingBalance - trailingDD).
  // Once floor reaches startingBalance, you can no longer breach below it (floor "locks").
  get trailingFloor() {
    const preset = this.apexAccount;
    if (!preset) return 0;
    const rawFloor = this.peakBalance - preset.trailingDrawdown;
    return Math.max(this.startingBalance - preset.trailingDrawdown, rawFloor);
  }

  // Dollars remaining before hitting the trailing floor
  get trailingRoomRemaining() {
    return Math.max(0, this.currentBalance - this.trailingFloor);
  }

  // Percentage of trailing DD cushion consumed (0–100)
  get trailingUsedPct() {
    const preset = this.apexAccount;
    if (!preset || preset.trailingDrawdown === 0) return 0;
    const ddUsed = Math.max(0, this.peakBalance - this.currentBalance);
    return Math.min(100, (ddUsed / preset.trailingDrawdown) * 100);
  }

  // ── Standard percentage helpers (non-trailing firms) ─────────────────────
  get profitTargetPct()  { return this.phase?.profitTargetPct || 10; }
  get maxLossPct()       { return this.phase?.maxLossPct      || 10; }
  get dailyLossPct()     { return this.phase?.dailyLossPct    || 5;  }

  get profitTargetAmt() {
    if (this.isTrailingFirm) return this.apexAccount?.profitTarget || 0;
    return this.startingBalance * (this.profitTargetPct / 100);
  }
  get maxLossAmt()       { return this.startingBalance * (this.maxLossPct / 100); }
  get dailyLossAmt()     { return this.startingBalance * (this.dailyLossPct / 100); }
  get maxDrawdownFloor() { return this.startingBalance - this.maxLossAmt; }

  // ── P&L getters ───────────────────────────────────────────────────────────
  get profitAmt()           { return this.currentBalance - this.startingBalance; }
  get profitPct()           { return (this.profitAmt / this.startingBalance) * 100; }
  get drawdownPct()         { return Math.max(0, (this.startingBalance - this.currentBalance) / this.startingBalance * 100); }
  get dailyLossUsed()       { return Math.max(0, this.dailyStartBalance - this.currentBalance); }
  get dailyLossPctUsed()    { return (this.dailyLossUsed / this.startingBalance) * 100; }
  get hasDailyLimit()       { return !this.isTrailingFirm; }

  // ── Progress bars (0–100) ─────────────────────────────────────────────────
  get profitProgress() {
    const target = this.profitTargetAmt;
    if (!target) return 0;
    return Math.min(100, (this.profitAmt / target) * 100);
  }

  get drawdownProgress() {
    if (this.isTrailingFirm) return this.trailingUsedPct;
    return Math.min(100, (this.drawdownPct / this.maxLossPct) * 100);
  }

  get dailyProgress() {
    if (this.isTrailingFirm) return 0;  // No daily limit for Apex
    return Math.min(100, (this.dailyLossPctUsed / this.dailyLossPct) * 100);
  }

  // ── Apex consistency rule (funded account rule — 30% per day max) ─────────
  // The most profit any single day should represent is 30% of total profits.
  // FIX: divide by the max allowed amount, not by 30% of profit (which was the same value,
  // making the formula always return 100% once today >= 30% of total).
  get apexConsistencyPct() {
    if (this.firmKey !== 'apex' || this.profitAmt <= 0) return 0;
    const todayProfit = Math.max(0, this.dailyPnL);
    return Math.min(100, (todayProfit / Math.max(0.01, this.apexConsistencyMaxAllowed)) * 100);
  }

  get apexConsistencyMaxAllowed() {
    if (this.firmKey !== 'apex' || this.profitAmt <= 0) return 0;
    return this.profitAmt * 0.30;
  }

  // ── EOD minutes remaining ─────────────────────────────────────────────────
  // Returns minutes until end-of-day (4:59 PM ET) via marketData helper, or null.
  get eodMinutesRemaining() {
    return window.marketData?.minutesUntilEOD?.() || null;
  }

  // ── Contract scaling factor ───────────────────────────────────────────────
  // Apex funded accounts start at 50% contracts until the trader proves consistency.
  // Returns 0.5 for funded Apex accounts (totalPnL > 0), 1.0 for all others.
  get contractScalingFactor() {
    if (this.firmKey === 'apex' && this.totalPnL > 0) return 0.5;
    return 1.0;
  }

  // ── Breach / status ───────────────────────────────────────────────────────
  // FIX: trailing firms must include openTradesPnL in breach check because
  // Apex's trailing drawdown tracks peak open equity — unrealized losses count.
  get isBreached() {
    if (this.isTrailingFirm) {
      return this.currentBalance + this.openTradesPnL <= this.trailingFloor;
    }
    return this.currentBalance < this.maxDrawdownFloor || this.dailyLossUsed > this.dailyLossAmt;
  }

  get dailyBreached() {
    if (this.isTrailingFirm) return false;
    return this.dailyLossUsed >= this.dailyLossAmt;
  }

  get status() {
    if (this.isBreached) return 'BREACHED';
    if (this.profitAmt >= this.profitTargetAmt && this.profitTargetAmt > 0) return 'PASSED';
    if (!this.isTrailingFirm && this.dailyBreached) return 'DAILY_LIMIT';
    if (this.drawdownProgress > 80) return 'DANGER';
    if (this.drawdownProgress > 50) return 'WARNING';
    return 'ACTIVE';
  }

  // ── Safe risk per trade ────────────────────────────────────────────────────
  // Returns max dollar amount to risk on one trade to stay challenge-safe.
  // Uses 15% of remaining cushion — conservative but not overly restrictive.
  get safeRiskPerTrade() {
    if (this.isTrailingFirm) {
      return Math.max(0, this.trailingRoomRemaining * 0.15);
    }
    const maxLossRemaining = this.currentBalance - this.maxDrawdownFloor;
    const dailyRemaining   = this.dailyLossAmt - this.dailyLossUsed;
    const usable           = Math.min(maxLossRemaining, Math.max(0, dailyRemaining));
    return Math.max(0, usable * 0.15);
  }

  // ── Open trade P&L management ─────────────────────────────────────────────
  // updateOpenPnL: update the unrealized P&L for currently open positions.
  // Also advances peakBalance if the current equity (balance + open P&L) is a new high —
  // this is required because Apex's trailing drawdown tracks peak OPEN equity.
  updateOpenPnL(pnl) {
    this.openTradesPnL = pnl;
    const openEquity = this.currentBalance + this.openTradesPnL;
    if (openEquity > this.peakBalance) this.peakBalance = openEquity;
  }

  // resetOpenPnL: zero out unrealized P&L (call when all open positions close).
  resetOpenPnL() {
    this.openTradesPnL = 0;
  }

  // ── Trade recording ────────────────────────────────────────────────────────
  // FIX: reset openTradesPnL when a trade closes, because the position is no
  // longer open and the unrealized P&L has been realised into currentBalance.
  addTrade(pnl) {
    this.trades.push({ pnl, time: new Date(), balance: this.currentBalance + pnl });
    this.currentBalance += pnl;
    this.dailyPnL       += pnl;
    this.totalPnL       += pnl;
    if (this.currentBalance > this.peakBalance) this.peakBalance = this.currentBalance;
    this.resetOpenPnL();
  }

  // Call at 5pm ET (end of futures session) to reset daily counters
  resetDay() {
    this.dailyStartBalance = this.currentBalance;
    this.dailyPnL = 0;
    this.tradingDays++;
  }
}

window.PROP_FIRMS     = PROP_FIRMS;
window.ChallengeState = ChallengeState;
