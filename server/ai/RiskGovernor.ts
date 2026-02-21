import * as fs from 'fs';
import * as path from 'path';
import { AIMetricsSnapshot } from './types';
import { PolicyDecision, PolicyIntent, PolicySide } from './PolicyEngine';
import { DeterministicStateSnapshot } from './StateExtractor';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

type RiskGovernorConfig = {
  baseEntryPct: number;
  dailyLossCapPct: number;
  slippageSoftBps: number;
  slippageHardBps: number;
  reducePctOnToxic: number;
  reducePctOnHardRisk: number;
  storePath: string;
};

export interface GovernedDecision {
  intent: PolicyIntent;
  side: PolicySide;
  confidence: number;
  riskMultiplier: number;
  sizeMultiplier: number;
  reducePct: number | null;
  maxPositionNotional: number;
  reasons: string[];
}

export interface RiskGovernorInput {
  symbol: string;
  timestampMs: number;
  policy: PolicyDecision;
  deterministicState: DeterministicStateSnapshot;
  snapshot: AIMetricsSnapshot;
}

type DailyStartStore = {
  days: Record<string, Record<string, number>>;
};

class DailyEquityStore {
  private loaded = false;
  private cache: DailyStartStore = { days: {} };

  constructor(private readonly filePath: string) {}

  getOrInit(symbol: string, dayKey: string, equity: number): number {
    this.ensureLoaded();
    const normalized = String(symbol || '').toUpperCase();
    if (!this.cache.days[dayKey]) {
      this.cache.days[dayKey] = {};
    }
    if (!(this.cache.days[dayKey][normalized] > 0)) {
      this.cache.days[dayKey][normalized] = Math.max(0, Number(equity || 0));
      this.persist();
    }
    return this.cache.days[dayKey][normalized];
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) {
        this.cache = { days: {} };
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object') {
        this.cache = parsed as DailyStartStore;
      }
    } catch {
      this.cache = { days: {} };
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache), 'utf8');
    } catch {
      // Non-blocking persistence.
    }
  }
}

export class RiskGovernor {
  private readonly config: RiskGovernorConfig;
  private readonly store: DailyEquityStore;

  constructor(config?: Partial<RiskGovernorConfig>) {
    const cwd = process.cwd();
    const serverRoot = path.basename(cwd).toLowerCase() === 'server' ? cwd : path.join(cwd, 'server');
    const defaultPath = path.join(serverRoot, 'data', 'ai_day_start_equity.json');
    this.config = {
      baseEntryPct: clamp(Number(process.env.AI_BASE_ENTRY_PCT || 0.35), 0.25, 0.55),
      dailyLossCapPct: clamp(Number(process.env.AI_DAILY_LOSS_CAP_PCT || 0.03), 0.005, 0.5),
      slippageSoftBps: Math.max(1, Number(process.env.AI_SLIPPAGE_SOFT_BPS || 8)),
      slippageHardBps: Math.max(2, Number(process.env.AI_SLIPPAGE_HARD_BPS || 12)),
      reducePctOnToxic: clamp(Number(process.env.AI_TOXIC_REDUCE_PCT || 0.5), 0.1, 1),
      reducePctOnHardRisk: clamp(Number(process.env.AI_HARD_RISK_REDUCE_PCT || 0.35), 0.1, 1),
      storePath: String(process.env.AI_DAY_START_EQUITY_PATH || defaultPath),
      ...(config || {}),
    };
    this.store = new DailyEquityStore(this.config.storePath);
  }

  apply(input: RiskGovernorInput): GovernedDecision {
    const reasons: string[] = [];
    const policy = input.policy;
    const position = input.snapshot.position;
    const equity = Math.max(0, Number(input.snapshot.riskState.equity || 0));
    const startEquity = Math.max(0, this.getDayStartEquity(input.symbol, input.timestampMs, equity));
    const maxPositionNotional = Math.max(0, Number(input.snapshot.riskState.startingMarginUser || 0) * Math.max(1, Number(input.snapshot.riskState.leverage || 1)));
    const baseNotional = maxPositionNotional * this.config.baseEntryPct;

    const riskMultiplier = clamp(Number(policy.riskMultiplier || 0.2), 0.2, 1.2);
    const confidence = clamp(Number(policy.confidence || 0), 0, 1);
    const equityGrowthFactor = startEquity > 0 ? Math.max(0, (equity - startEquity) / startEquity) : 0;
    const concaveScale = clamp(Math.log(1 + (4 * equityGrowthFactor)) + 1, 0.5, 1.8);

    let intent: PolicyIntent = policy.intent;
    let side: PolicySide = policy.side;
    let reducePct: number | null = null;

    const volPct = Number(input.deterministicState.volatilityPercentile || 0);
    const slippageBps = Number(input.deterministicState.expectedSlippageBps || 0);
    const toxicityState = input.deterministicState.toxicityState;

    const dayLossPct = startEquity > 0 ? (equity - startEquity) / startEquity : 0;
    if (dayLossPct <= -Math.abs(this.config.dailyLossCapPct)) {
      reasons.push('DAILY_LOSS_CAP');
      if (position) {
        intent = 'REDUCE';
        reducePct = 0.5;
        side = position.side;
      } else {
        intent = 'HOLD';
        side = null;
      }
    }

    if (toxicityState === 'TOXIC') {
      reasons.push('TOXICITY_LIMIT');
      if (position) {
        intent = 'REDUCE';
        reducePct = this.config.reducePctOnToxic;
        side = position.side;
      } else {
        intent = 'HOLD';
        side = null;
      }
    }

    if (slippageBps > this.config.slippageHardBps) {
      reasons.push('SLIPPAGE_HARD_LIMIT');
      if (position) {
        intent = 'REDUCE';
        reducePct = Math.max(reducePct || 0, this.config.reducePctOnHardRisk);
        side = position.side;
      } else {
        intent = 'HOLD';
        side = null;
      }
    } else if (slippageBps > this.config.slippageSoftBps && (intent === 'ENTER' || intent === 'ADD')) {
      reasons.push('SLIPPAGE_SOFT_BLOCK');
      intent = 'HOLD';
      side = null;
    }

    if (volPct >= 95 && (intent === 'ENTER' || intent === 'ADD')) {
      reasons.push('VOL_HARD_LIMIT');
      if (position) {
        intent = 'REDUCE';
        reducePct = Math.max(reducePct || 0, this.config.reducePctOnHardRisk);
        side = position.side;
      } else {
        intent = 'HOLD';
        side = null;
      }
    }

    const riskHaircut = this.resolveRiskHaircut(input.deterministicState);
    const targetNotionalRaw = Math.max(0, baseNotional * concaveScale * riskMultiplier * riskHaircut);
    const currentNotional = position ? Math.max(0, position.qty * input.snapshot.market.price) : 0;

    let effectiveNotional = Math.min(maxPositionNotional, targetNotionalRaw);

    if (intent === 'ADD') {
      const remaining = Math.max(0, maxPositionNotional - currentNotional);
      effectiveNotional = Math.min(effectiveNotional, remaining);
      if (effectiveNotional <= 0) {
        reasons.push('MAX_NOTIONAL_REACHED');
        intent = 'HOLD';
        side = null;
      }
    }

    if (intent === 'ENTER' && maxPositionNotional <= 0) {
      reasons.push('INVALID_NOTIONAL_LIMIT');
      intent = 'HOLD';
      side = null;
    }

    if (intent === 'REDUCE') {
      if (!position) {
        intent = 'HOLD';
        side = null;
      } else {
        reducePct = clamp(Number(reducePct ?? 0.35), 0.1, 1);
        side = position.side;
      }
    }

    if (intent === 'EXIT') {
      if (!position) {
        intent = 'HOLD';
        side = null;
      } else {
        side = position.side;
      }
    }

    const sizeMultiplier = baseNotional > 0 ? clamp(effectiveNotional / baseNotional, 0.05, 4) : 0;

    return {
      intent,
      side,
      confidence,
      riskMultiplier,
      sizeMultiplier: Number(sizeMultiplier.toFixed(6)),
      reducePct: reducePct == null ? null : Number(clamp(reducePct, 0.1, 1).toFixed(6)),
      maxPositionNotional: Number(maxPositionNotional.toFixed(6)),
      reasons,
    };
  }

  private resolveRiskHaircut(state: DeterministicStateSnapshot): number {
    let haircut = 1;

    if (state.volatilityPercentile >= 90 && state.volatilityPercentile < 95) {
      haircut *= 0.5;
    }

    if (state.toxicityState === 'AGGRESSIVE') {
      haircut *= 0.65;
    }

    if (state.executionState === 'WIDENING_SPREAD') {
      haircut *= 0.75;
    }

    return clamp(haircut, 0.1, 1);
  }

  private getDayStartEquity(symbol: string, timestampMs: number, fallbackEquity: number): number {
    const dayKey = this.toDayKey(timestampMs);
    return this.store.getOrInit(symbol, dayKey, fallbackEquity);
  }

  private toDayKey(timestampMs: number): string {
    const d = new Date(timestampMs > 0 ? timestampMs : Date.now());
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
