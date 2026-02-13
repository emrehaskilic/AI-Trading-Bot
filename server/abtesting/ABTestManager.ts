import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { StrategySignal } from '../strategy/StrategyEngine';
import { AlertService } from '../notifications/AlertService';
import { ABTestComparison, ABTestSessionSnapshot, ABTestStartInput, ABTestStrategyProfile } from './types';

interface ActiveSession {
  sessionId: string;
  startedAt: number;
  symbols: string[];
  status: 'RUNNING' | 'STOPPED';
  sessionA: ABTestStrategyProfile;
  sessionB: ABTestStrategyProfile;
  engineA: DryRunSessionService;
  engineB: DryRunSessionService;
}

function applySignalProfile(signal: StrategySignal, profile: ABTestStrategyProfile): StrategySignal | null {
  const multiplier = Number.isFinite(profile.signalScoreMultiplier) ? Number(profile.signalScoreMultiplier) : 1;
  const minScore = Number.isFinite(profile.signalMinScore) ? Number(profile.signalMinScore) : 0;
  const adjustedScore = signal.score * multiplier;
  if (adjustedScore < minScore) return null;
  return { ...signal, score: adjustedScore };
}

export class ABTestManager {
  private session: ActiveSession | null = null;

  constructor(private readonly alertService?: AlertService) {}

  start(input: ABTestStartInput): ABTestSessionSnapshot {
    const engineA = new DryRunSessionService(this.alertService);
    const engineB = new DryRunSessionService(this.alertService);

    const base = {
      symbols: input.symbols,
      walletBalanceStartUsdt: input.walletBalanceStartUsdt,
      initialMarginUsdt: input.initialMarginUsdt,
      leverage: input.leverage,
      heartbeatIntervalMs: input.heartbeatIntervalMs,
      debugAggressiveEntry: false,
    };

    engineA.start({
      ...base,
      initialMarginUsdt: input.sessionA.initialMarginUsdt ?? base.initialMarginUsdt,
      leverage: input.sessionA.leverage ?? base.leverage,
      runId: input.runId ? `${input.runId}-A` : undefined,
    });

    engineB.start({
      ...base,
      initialMarginUsdt: input.sessionB.initialMarginUsdt ?? base.initialMarginUsdt,
      leverage: input.sessionB.leverage ?? base.leverage,
      runId: input.runId ? `${input.runId}-B` : undefined,
    });

    this.session = {
      sessionId: input.runId || `abtest-${Date.now()}`,
      startedAt: Date.now(),
      symbols: input.symbols,
      status: 'RUNNING',
      sessionA: input.sessionA,
      sessionB: input.sessionB,
      engineA,
      engineB,
    };

    return this.getSnapshot();
  }

  stop(): ABTestSessionSnapshot | null {
    if (!this.session) return null;
    this.session.engineA.stop();
    this.session.engineB.stop();
    this.session.status = 'STOPPED';
    return this.getSnapshot();
  }

  ingestDepthEvent(event: {
    symbol: string;
    eventTimestampMs: number;
    orderBook: any;
    markPrice?: number;
  }): void {
    if (!this.session || this.session.status !== 'RUNNING') return;
    this.session.engineA.ingestDepthEvent(event);
    this.session.engineB.ingestDepthEvent(event);
  }

  submitStrategySignal(symbol: string, signal: StrategySignal, timestampMs?: number): void {
    if (!this.session || this.session.status !== 'RUNNING') return;
    const signalA = applySignalProfile(signal, this.session.sessionA);
    const signalB = applySignalProfile(signal, this.session.sessionB);
    if (signalA) this.session.engineA.submitStrategySignal(symbol, signalA, timestampMs);
    if (signalB) this.session.engineB.submitStrategySignal(symbol, signalB, timestampMs);
  }

  getSnapshot(): ABTestSessionSnapshot {
    if (!this.session) {
      return {
        sessionId: 'none',
        status: 'STOPPED',
        startedAt: 0,
        symbols: [],
        sessionA: { name: 'A' },
        sessionB: { name: 'B' },
      };
    }
    const statusA = this.session.engineA.getStatus();
    const statusB = this.session.engineB.getStatus();
    return {
      sessionId: this.session.sessionId,
      status: this.session.status,
      startedAt: this.session.startedAt,
      symbols: this.session.symbols,
      sessionA: this.session.sessionA,
      sessionB: this.session.sessionB,
      performanceA: statusA.summary.performance,
      performanceB: statusB.summary.performance,
    };
  }

  getComparison(): ABTestComparison | null {
    if (!this.session) return null;
    const statusA = this.session.engineA.getStatus();
    const statusB = this.session.engineB.getStatus();
    const fallback = {
      totalPnL: 0,
      winCount: 0,
      lossCount: 0,
      totalTrades: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      pnlCurve: [],
    };
    const perfA = statusA.summary.performance ?? fallback;
    const perfB = statusB.summary.performance ?? fallback;

    const winner = perfA.totalPnL === perfB.totalPnL
      ? 'TIE'
      : perfA.totalPnL > perfB.totalPnL
      ? this.session.sessionA.name
      : this.session.sessionB.name;

    return {
      sessionId: this.session.sessionId,
      strategyA: this.session.sessionA.name,
      strategyB: this.session.sessionB.name,
      pnlA: perfA.totalPnL,
      pnlB: perfB.totalPnL,
      winRateA: perfA.winRate,
      winRateB: perfB.winRate,
      sharpeA: perfA.sharpeRatio,
      sharpeB: perfB.sharpeRatio,
      winner,
    };
  }
}
