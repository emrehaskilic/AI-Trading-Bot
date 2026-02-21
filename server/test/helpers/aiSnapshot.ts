import { AIMetricsSnapshot } from '../../ai/types';

type SnapshotOverrides = Partial<
  Omit<
    AIMetricsSnapshot,
    | 'decision'
    | 'riskState'
    | 'executionState'
    | 'market'
    | 'trades'
    | 'liquidityMetrics'
    | 'passiveFlowMetrics'
    | 'derivativesMetrics'
    | 'toxicityMetrics'
    | 'regimeMetrics'
    | 'openInterest'
    | 'absorption'
  >
> & {
  decision?: Partial<AIMetricsSnapshot['decision']>;
  riskState?: Partial<AIMetricsSnapshot['riskState']>;
  executionState?: Partial<AIMetricsSnapshot['executionState']>;
  market?: Partial<AIMetricsSnapshot['market']>;
  trades?: Partial<AIMetricsSnapshot['trades']>;
  liquidityMetrics?: Partial<AIMetricsSnapshot['liquidityMetrics']>;
  passiveFlowMetrics?: Partial<AIMetricsSnapshot['passiveFlowMetrics']>;
  derivativesMetrics?: Partial<AIMetricsSnapshot['derivativesMetrics']>;
  toxicityMetrics?: Partial<AIMetricsSnapshot['toxicityMetrics']>;
  regimeMetrics?: Partial<AIMetricsSnapshot['regimeMetrics']>;
  openInterest?: Partial<AIMetricsSnapshot['openInterest']>;
  absorption?: Partial<AIMetricsSnapshot['absorption']>;
};

export function buildAIMetricsSnapshot(overrides?: SnapshotOverrides): AIMetricsSnapshot {
  const base: AIMetricsSnapshot = {
    symbol: 'BTCUSDT',
    timestampMs: Date.now(),
    decision: {
      regime: 'TR',
      dfs: 0.2,
      dfsPercentile: 0.5,
      volLevel: 0.4,
      gatePassed: true,
      thresholds: {
        longEntry: 0.85,
        longBreak: 0.55,
        shortEntry: 0.15,
        shortBreak: 0.45,
      },
    },
    blockedReasons: [],
    riskState: {
      equity: 5_000,
      leverage: 10,
      startingMarginUser: 200,
      marginInUse: 300,
      drawdownPct: 0,
      dailyLossLock: false,
      cooldownMsRemaining: 0,
    },
    executionState: {
      lastAction: 'NONE',
      holdStreak: 0,
      lastAddMsAgo: null,
      lastFlipMsAgo: null,
    },
    market: {
      price: 60_000,
      vwap: 59_950,
      spreadPct: 0.0007,
      delta1s: 90,
      delta5s: 140,
      deltaZ: 1.8,
      cvdSlope: 35_000,
      obiWeighted: 0.5,
      obiDeep: 0.35,
      obiDivergence: 0.1,
    },
    trades: {
      printsPerSecond: 6,
      tradeCount: 20,
      aggressiveBuyVolume: 180,
      aggressiveSellVolume: 95,
      burstCount: 3,
      burstSide: 'buy',
    },
    liquidityMetrics: {
      microPrice: 60_000,
      imbalanceCurve: {
        level1: 0.52,
        level5: 0.51,
        level10: 0.5,
        level20: 0.5,
        level50: 0.49,
      },
      bookSlopeBid: 1,
      bookSlopeAsk: 1,
      bookConvexity: 0.04,
      liquidityWallScore: 0.2,
      voidGapScore: 0.1,
      expectedSlippageBuy: 4,
      expectedSlippageSell: 4,
      resiliencyMs: 1200,
      effectiveSpread: 0.02,
      realizedSpreadShortWindow: 0.02,
    },
    passiveFlowMetrics: {
      bidAddRate: 12,
      askAddRate: 11,
      bidCancelRate: 7,
      askCancelRate: 8,
      depthDeltaDecomposition: {
        addVolume: 100,
        cancelVolume: 70,
        tradeRelatedVolume: 10,
        netDepthDelta: 20,
      },
      queueDeltaBestBid: 2,
      queueDeltaBestAsk: -1,
      spoofScore: 0.1,
      refreshRate: 0.2,
    },
    derivativesMetrics: {
      markLastDeviationPct: 0.01,
      indexLastDeviationPct: 0.01,
      perpBasis: 0.0002,
      perpBasisZScore: 0.2,
      liquidationProxyScore: 0.2,
    },
    toxicityMetrics: {
      vpinApprox: 0.3,
      signedVolumeRatio: 0.6,
      priceImpactPerSignedNotional: 0.00002,
      tradeToBookRatio: 0.04,
      burstPersistenceScore: 0.45,
    },
    regimeMetrics: {
      realizedVol1m: 0.2,
      realizedVol5m: 0.3,
      realizedVol15m: 0.5,
      volOfVol: 0.03,
      microATR: 0.1,
      chopScore: 0.35,
      trendinessScore: 0.62,
    },
    crossMarketMetrics: null,
    enableCrossMarketConfirmation: false,
    openInterest: {
      oiChangePct: 0.25,
    },
    absorption: {
      value: 0,
      side: null,
    },
    volatility: 110,
    position: null,
  };

  return {
    ...base,
    ...(overrides || {}),
    decision: { ...base.decision, ...(overrides?.decision || {}) },
    riskState: { ...base.riskState, ...(overrides?.riskState || {}) },
    executionState: { ...base.executionState, ...(overrides?.executionState || {}) },
    market: { ...base.market, ...(overrides?.market || {}) },
    trades: { ...base.trades, ...(overrides?.trades || {}) },
    liquidityMetrics: { ...base.liquidityMetrics, ...(overrides?.liquidityMetrics || {}) },
    passiveFlowMetrics: { ...base.passiveFlowMetrics, ...(overrides?.passiveFlowMetrics || {}) },
    derivativesMetrics: { ...base.derivativesMetrics, ...(overrides?.derivativesMetrics || {}) },
    toxicityMetrics: { ...base.toxicityMetrics, ...(overrides?.toxicityMetrics || {}) },
    regimeMetrics: { ...base.regimeMetrics, ...(overrides?.regimeMetrics || {}) },
    openInterest: { ...base.openInterest, ...(overrides?.openInterest || {}) },
    absorption: { ...base.absorption, ...(overrides?.absorption || {}) },
  };
}
