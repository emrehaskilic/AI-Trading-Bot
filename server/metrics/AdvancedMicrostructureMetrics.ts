import { FundingMetrics } from './FundingMonitor';
import { RegressionWindow, WindowStats, WindowSum } from './RollingWindow';

type TradeSide = 'buy' | 'sell';
type BookSide = 'bid' | 'ask';

const EPS = 1e-12;

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

export interface LiquidityMetrics {
  microPrice: number | null;
  imbalanceCurve: {
    level1: number;
    level5: number;
    level10: number;
    level20: number;
    level50: number;
  };
  bookSlopeBid: number;
  bookSlopeAsk: number;
  bookConvexity: number;
  liquidityWallScore: number;
  voidGapScore: number;
  expectedSlippageBuy: number;
  expectedSlippageSell: number;
  resiliencyMs: number;
  effectiveSpread: number;
  realizedSpreadShortWindow: number;
}

export interface PassiveFlowMetrics {
  bidAddRate: number;
  askAddRate: number;
  bidCancelRate: number;
  askCancelRate: number;
  depthDeltaDecomposition: {
    addVolume: number;
    cancelVolume: number;
    tradeRelatedVolume: number;
    netDepthDelta: number;
  };
  queueDeltaBestBid: number;
  queueDeltaBestAsk: number;
  spoofScore: number;
  refreshRate: number;
}

export interface DerivativesMetrics {
  markLastDeviationPct: number | null;
  indexLastDeviationPct: number | null;
  perpBasis: number | null;
  perpBasisZScore: number;
  liquidationProxyScore: number;
}

export interface ToxicityMetrics {
  vpinApprox: number;
  signedVolumeRatio: number;
  priceImpactPerSignedNotional: number;
  tradeToBookRatio: number;
  burstPersistenceScore: number;
}

export interface RegimeMetrics {
  realizedVol1m: number;
  realizedVol5m: number;
  realizedVol15m: number;
  volOfVol: number;
  microATR: number;
  chopScore: number;
  trendinessScore: number;
}

export interface CrossMarketMetrics {
  spotPerpDivergence: number | null;
  betaToBTC: number;
  betaToETH: number;
  crossVenueImbalanceDiff: number | null;
}

export interface AdvancedMicrostructureBundle {
  liquidityMetrics: LiquidityMetrics;
  passiveFlowMetrics: PassiveFlowMetrics;
  derivativesMetrics: DerivativesMetrics;
  toxicityMetrics: ToxicityMetrics;
  regimeMetrics: RegimeMetrics;
  crossMarketMetrics: CrossMarketMetrics | null;
  enableCrossMarketConfirmation: boolean;
}

export interface DepthSnapshotInput {
  timestampMs: number;
  bids: [number, number, number][];
  asks: [number, number, number][];
}

export interface TradeSnapshotInput {
  timestampMs: number;
  price: number;
  quantity: number;
  side: TradeSide;
  midPrice: number | null;
}

export interface DerivativesSnapshotInput {
  timestampMs: number;
  funding: FundingMetrics | null;
  openInterest: {
    currentOI: number | null;
    oiChangeAbs: number | null;
    oiChangePct: number | null;
    lastUpdated: number | null;
  } | null;
  lastPrice: number | null;
}

export interface SpotReferenceSnapshot {
  timestampMs: number;
  midPrice: number | null;
  imbalance10: number | null;
}

export interface CrossMarketReferenceInput {
  timestampMs: number;
  enableCrossMarketConfirmation: boolean;
  btcReturn: number | null;
  ethReturn: number | null;
  spotReference: SpotReferenceSnapshot | null;
}

type PendingRealizedSpread = { ts: number; side: TradeSide; tradePrice: number };
type PendingBurstCheck = { ts: number; side: TradeSide; midPriceAtBurst: number };
type RecentAggTrade = { ts: number; side: TradeSide; price: number; notional: number };
type RecentLargeAdd = { ts: number; side: BookSide; price: number; quantity: number };

const DEFAULT_LIQUIDITY_METRICS: LiquidityMetrics = {
  microPrice: null,
  imbalanceCurve: { level1: 0.5, level5: 0.5, level10: 0.5, level20: 0.5, level50: 0.5 },
  bookSlopeBid: 0,
  bookSlopeAsk: 0,
  bookConvexity: 0,
  liquidityWallScore: 0,
  voidGapScore: 0,
  expectedSlippageBuy: 0,
  expectedSlippageSell: 0,
  resiliencyMs: 0,
  effectiveSpread: 0,
  realizedSpreadShortWindow: 0,
};

const DEFAULT_DERIVATIVES: DerivativesMetrics = {
  markLastDeviationPct: null,
  indexLastDeviationPct: null,
  perpBasis: null,
  perpBasisZScore: 0,
  liquidationProxyScore: 0,
};

const DEFAULT_CROSS: CrossMarketMetrics = {
  spotPerpDivergence: null,
  betaToBTC: 0,
  betaToETH: 0,
  crossVenueImbalanceDiff: null,
};

export class AdvancedMicrostructureMetrics {
  private lastMidPrice: number | null = null;
  private lastTradePrice: number | null = null;
  private latestReturn: number | null = null;

  private readonly ret1mStats = new WindowStats(60_000, 40_000);
  private readonly ret5mStats = new WindowStats(300_000, 80_000);
  private readonly ret15mStats = new WindowStats(900_000, 120_000);
  private readonly volOfVolStats = new WindowStats(300_000, 80_000);
  private microAtr = 0;
  private readonly microAtrAlpha = 2 / (14 + 1);

  private returnEvents: Array<{ ts: number; value: number }> = [];
  private returnHead = 0;
  private midHistory: Array<{ ts: number; value: number }> = [];
  private midHead = 0;

  private prevBids = new Map<number, number>();
  private prevAsks = new Map<number, number>();
  private queueDeltaBestBid = 0;
  private queueDeltaBestAsk = 0;
  private depthDeltaDecomposition = { addVolume: 0, cancelVolume: 0, tradeRelatedVolume: 0, netDepthDelta: 0 };
  private readonly bidAddWindow = new WindowSum(30_000, 25_000);
  private readonly askAddWindow = new WindowSum(30_000, 25_000);
  private readonly bidCancelWindow = new WindowSum(30_000, 25_000);
  private readonly askCancelWindow = new WindowSum(30_000, 25_000);
  private readonly refreshEvents = new WindowSum(10_000, 10_000);

  private spoofAccumulator = 0;
  private spoofLastUpdateTs = 0;
  private largeAddEvents: RecentLargeAdd[] = [];
  private largeAddHead = 0;
  private addTimestampByPrice = new Map<string, number>();

  private recentAggTrades: RecentAggTrade[] = [];
  private recentAggHead = 0;

  private readonly buyVolumeWindow = new WindowSum(60_000, 30_000);
  private readonly sellVolumeWindow = new WindowSum(60_000, 30_000);
  private readonly signedNotionalWindow = new WindowSum(10_000, 30_000);
  private readonly tradedNotionalWindow = new WindowSum(10_000, 30_000);
  private readonly tradeNotionalStats = new WindowStats(60_000, 30_000);

  private avgTradeQtyEwma = 1;
  private vpinBuckets: Array<{ ts: number; imbalance: number }> = [];
  private vpinHead = 0;
  private vpinCurrentBuy = 0;
  private vpinCurrentSell = 0;
  private vpinCurrentVolume = 0;

  private burstStreakSide: TradeSide | null = null;
  private burstStreakCount = 0;
  private burstTriggeredInStreak = false;
  private pendingBursts: PendingBurstCheck[] = [];
  private pendingBurstHead = 0;
  private readonly burstOutcomeStats = new WindowStats(600_000, 30_000);

  private pendingRealizedSpreads: PendingRealizedSpread[] = [];
  private pendingRealizedHead = 0;
  private readonly effectiveSpreadStats = new WindowStats(10_000, 12_000);
  private readonly realizedSpreadStats = new WindowStats(30_000, 12_000);

  private lastDepthTotal10 = 0;
  private pendingResiliency: { startTs: number; baselineDepth: number } | null = null;
  private readonly resiliencyStats = new WindowStats(60_000, 4096);

  private readonly basisStats = new WindowStats(300_000, 30_000);
  private lastBasis: number | null = null;
  private markPrice: number | null = null;
  private indexPrice: number | null = null;
  private liquidationProxyAccumulator = 0;
  private liquidationProxyLastTs = 0;
  private lastLargeTradeTs = 0;
  private lastOiChangePct: number | null = null;
  private lastOiUpdateTs = 0;

  private currentTopDepthNotional10 = 0;
  private currentPerpImbalance10 = 0.5;
  private latestLiquidity: LiquidityMetrics = { ...DEFAULT_LIQUIDITY_METRICS };

  private crossEnabled = false;
  private readonly betaBtcRegression = new RegressionWindow(300_000, 30_000);
  private readonly betaEthRegression = new RegressionWindow(300_000, 30_000);
  private spotMidPrice: number | null = null;
  private spotImbalance10: number | null = null;

  private readonly baseQty = Math.max(0.001, Number(process.env.MICRO_BASE_QTY || 10));
  private readonly spoofWindowMs = Math.max(250, Number(process.env.SPOOF_WINDOW_MS || 2000));
  private readonly spoofHalfLifeMs = Math.max(500, Number(process.env.SPOOF_HALF_LIFE_MS || 5000));
  private readonly refreshWindowMs = Math.max(200, Number(process.env.REFRESH_WINDOW_MS || 1000));
  private readonly tradeRelatedWindowMs = Math.max(100, Number(process.env.PASSIVE_TRADE_LINK_MS || 300));
  private readonly tradeRelatedPriceTolerancePct = clamp(Number(process.env.PASSIVE_TRADE_LINK_PCT || 0.05) / 100, 0.00001, 0.01);
  private readonly largeAddMultiplier = Math.max(1.5, Number(process.env.LARGE_ADD_MULTIPLIER || 3));
  private readonly minLargeTradeNotional = Math.max(100, Number(process.env.MIN_LARGE_TRADE_NOTIONAL || 20_000));
  private readonly sweepDropPct = clamp(Number(process.env.RESILIENCY_SWEEP_DROP_PCT || 0.2), 0.05, 0.9);
  private readonly sweepRecoveryRatio = clamp(Number(process.env.RESILIENCY_RECOVERY_RATIO || 0.9), 0.5, 1.2);
  private readonly sweepMaxMs = Math.max(1000, Number(process.env.RESILIENCY_MAX_MS || 30_000));
  private readonly realizedSpreadDelayMs = Math.max(250, Number(process.env.REALIZED_SPREAD_WINDOW_MS || 5000));
  private readonly burstThresholdTrades = Math.max(2, Math.trunc(Number(process.env.BURST_THRESHOLD_TRADES || 6)));
  private readonly burstHorizonMs = Math.max(250, Number(process.env.BURST_HORIZON_MS || 3000));
  private readonly vpinTargetMultiplier = Math.max(5, Number(process.env.VPIN_TARGET_MULTIPLIER || 50));
  private readonly vpinWindowMs = Math.max(60_000, Number(process.env.VPIN_WINDOW_MS || 300_000));
  private readonly liquidationWindowMs = Math.max(500, Number(process.env.LIQUIDATION_PROXY_WINDOW_MS || 3000));
  private readonly liquidationOiDropPct = -Math.abs(Number(process.env.LIQUIDATION_PROXY_OI_DROP_PCT || 0.15));
  private readonly liquidationHalfLifeMs = Math.max(1000, Number(process.env.LIQUIDATION_PROXY_HALF_LIFE_MS || 20_000));

  constructor(private readonly symbol: string) {}

  public getLatestReturn(): number | null { return this.latestReturn; }

  public onDepthSnapshot(input: DepthSnapshotInput): void {
    const ts = Number.isFinite(input.timestampMs) ? Number(input.timestampMs) : Date.now();
    const bids = this.normalizeLevels(input.bids, true);
    const asks = this.normalizeLevels(input.asks, false);
    if (bids.length === 0 || asks.length === 0) return;

    const bestBid = bids[0][0];
    const bestAsk = asks[0][0];
    const mid = (bestBid > 0 && bestAsk > 0) ? ((bestBid + bestAsk) / 2) : null;

    if (mid && mid > 0) {
      this.updateMid(ts, mid);
      this.resolvePendingRealizedSpreads(ts, mid);
      this.resolvePendingBurstChecks(ts, mid);
    }

    this.currentTopDepthNotional10 = this.computeTopDepthNotional(bids, asks, 10);
    this.currentPerpImbalance10 = this.computeImbalanceRatio(bids, asks, 10);

    this.updateLiquidityMetrics(ts, bids, asks, bestBid, bestAsk, mid);
    this.updatePassiveFlowMetrics(ts, bids, asks);
    this.updateResiliency(ts, bids, asks);
  }

  public onTrade(input: TradeSnapshotInput): void {
    const ts = Number.isFinite(input.timestampMs) ? Number(input.timestampMs) : Date.now();
    const price = Number(input.price);
    const quantity = Number(input.quantity);
    if (!(price > 0 && quantity > 0)) return;
    const side: TradeSide = input.side === 'sell' ? 'sell' : 'buy';
    const notional = price * quantity;
    this.lastTradePrice = price;

    const mid = Number.isFinite(Number(input.midPrice)) && Number(input.midPrice) > 0
      ? Number(input.midPrice)
      : this.lastMidPrice;
    if (mid && mid > 0) {
      this.updateMid(ts, mid);
      const effectiveSpread = (2 * Math.abs(price - mid) / Math.max(mid, EPS)) * 100;
      this.effectiveSpreadStats.add(ts, effectiveSpread);
    }

    const signedNotional = side === 'buy' ? notional : -notional;
    this.signedNotionalWindow.add(ts, signedNotional);
    this.tradedNotionalWindow.add(ts, notional);
    this.tradeNotionalStats.add(ts, notional);
    if (side === 'buy') this.buyVolumeWindow.add(ts, quantity);
    if (side === 'sell') this.sellVolumeWindow.add(ts, quantity);

    this.pendingRealizedSpreads.push({ ts, side, tradePrice: price });
    this.trackRecentAggTrade(ts, side, price, notional);
    this.updateVpin(ts, side, quantity);
    this.updateBurstDetection(ts, side, mid || price);

    const avgNotional = Math.max(this.tradeNotionalStats.mean(ts), EPS);
    const largeTradeThreshold = Math.max(this.minLargeTradeNotional, avgNotional * 3);
    if (notional >= largeTradeThreshold) {
      this.lastLargeTradeTs = ts;
      this.applyLiquidationDecay(ts);
      this.tryTriggerLiquidationProxy(ts);
    }
  }

  public onDerivativesSnapshot(input: DerivativesSnapshotInput): void {
    const ts = Number.isFinite(input.timestampMs) ? Number(input.timestampMs) : Date.now();
    if (input.funding) {
      if (Number.isFinite(Number(input.funding.markPrice))) this.markPrice = Number(input.funding.markPrice);
      if (Number.isFinite(Number(input.funding.indexPrice))) this.indexPrice = Number(input.funding.indexPrice);
    }
    if (input.openInterest) {
      if (input.openInterest.oiChangePct != null && Number.isFinite(Number(input.openInterest.oiChangePct))) {
        this.lastOiChangePct = Number(input.openInterest.oiChangePct);
        this.lastOiUpdateTs = Number.isFinite(Number(input.openInterest.lastUpdated))
          ? Number(input.openInterest.lastUpdated)
          : ts;
      }
    }

    const perpPrice = this.resolvePerpPrice(input.lastPrice);
    if (perpPrice != null && this.indexPrice != null && this.indexPrice > 0) {
      const basis = (perpPrice - this.indexPrice) / this.indexPrice;
      this.lastBasis = basis;
      this.basisStats.add(ts, basis);
    }

    this.applyLiquidationDecay(ts);
    this.tryTriggerLiquidationProxy(ts);
  }

  public updateCrossMarket(input: CrossMarketReferenceInput): void {
    const ts = Number.isFinite(input.timestampMs) ? Number(input.timestampMs) : Date.now();
    this.crossEnabled = Boolean(input.enableCrossMarketConfirmation);
    if (input.spotReference) {
      if (Number.isFinite(Number(input.spotReference.midPrice))) this.spotMidPrice = Number(input.spotReference.midPrice);
      if (Number.isFinite(Number(input.spotReference.imbalance10))) this.spotImbalance10 = Number(input.spotReference.imbalance10);
    }
    if (!this.crossEnabled) return;
    if (this.latestReturn == null || !Number.isFinite(this.latestReturn)) return;

    if (Number.isFinite(Number(input.btcReturn))) {
      this.betaBtcRegression.add(ts, Number(input.btcReturn), this.latestReturn);
    }
    if (Number.isFinite(Number(input.ethReturn))) {
      this.betaEthRegression.add(ts, Number(input.ethReturn), this.latestReturn);
    }
  }

  public getMetrics(nowMs?: number): AdvancedMicrostructureBundle {
    const now = Number.isFinite(nowMs as number) ? Number(nowMs) : Date.now();

    this.applySpoofDecay(now);
    this.applyLiquidationDecay(now);
    this.pruneReturnEvents(now);
    this.pruneMidHistory(now);
    this.prunePendingRealized(now);
    this.prunePendingBursts(now);
    this.pruneVpinBuckets(now);

    const signedBuy = Math.max(0, this.buyVolumeWindow.sum(now));
    const signedSell = Math.max(0, this.sellVolumeWindow.sum(now));
    const signedTotal = signedBuy + signedSell;
    const signedVolumeRatio = signedTotal > 0 ? signedBuy / signedTotal : 0.5;

    const tradedNotional = this.tradedNotionalWindow.sum(now);
    const tradeToBookRatio = this.currentTopDepthNotional10 > EPS ? tradedNotional / this.currentTopDepthNotional10 : 0;
    const deltaMidPct = this.computeShortWindowMidMovePct(now, 10_000);
    const signedNotional = this.signedNotionalWindow.sum(now);
    const priceImpactPerSignedNotional = Math.abs(signedNotional) > EPS ? deltaMidPct / signedNotional : 0;

    const { chopScore, trendinessScore } = this.computeChopAndTrendiness(now, 60_000);
    const perpPrice = this.resolvePerpPrice(null);
    const markLastDeviationPct = (this.markPrice != null && perpPrice != null && perpPrice > 0)
      ? ((this.markPrice - perpPrice) / perpPrice) * 100
      : null;
    const indexLastDeviationPct = (this.indexPrice != null && perpPrice != null && perpPrice > 0)
      ? ((this.indexPrice - perpPrice) / perpPrice) * 100
      : null;
    const perpBasis = (perpPrice != null && this.indexPrice != null && this.indexPrice > 0)
      ? ((perpPrice - this.indexPrice) / this.indexPrice)
      : this.lastBasis;
    const perpBasisZScore = (perpBasis != null && Number.isFinite(perpBasis))
      ? this.basisStats.zScore(perpBasis, now)
      : 0;

    const derivativesMetrics: DerivativesMetrics = {
      ...DEFAULT_DERIVATIVES,
      markLastDeviationPct,
      indexLastDeviationPct,
      perpBasis,
      perpBasisZScore,
      liquidationProxyScore: this.liquidationProxyAccumulator,
    };

    const passiveFlowMetrics: PassiveFlowMetrics = {
      bidAddRate: this.bidAddWindow.sum(now) / 30,
      askAddRate: this.askAddWindow.sum(now) / 30,
      bidCancelRate: this.bidCancelWindow.sum(now) / 30,
      askCancelRate: this.askCancelWindow.sum(now) / 30,
      depthDeltaDecomposition: { ...this.depthDeltaDecomposition },
      queueDeltaBestBid: this.queueDeltaBestBid,
      queueDeltaBestAsk: this.queueDeltaBestAsk,
      spoofScore: this.spoofAccumulator,
      refreshRate: this.refreshEvents.sum(now) / 10,
    };

    const toxicityMetrics: ToxicityMetrics = {
      vpinApprox: this.computeVpin(now),
      signedVolumeRatio,
      priceImpactPerSignedNotional,
      tradeToBookRatio,
      burstPersistenceScore: this.burstOutcomeStats.mean(now),
    };

    const regimeMetrics: RegimeMetrics = {
      realizedVol1m: this.ret1mStats.rms(now) * 100,
      realizedVol5m: this.ret5mStats.rms(now) * 100,
      realizedVol15m: this.ret15mStats.rms(now) * 100,
      volOfVol: this.volOfVolStats.std(now),
      microATR: this.microAtr,
      chopScore,
      trendinessScore,
    };

    const crossMarketMetrics = this.crossEnabled ? this.computeCrossMarketMetrics(now, perpPrice) : null;

    const liquidityMetrics: LiquidityMetrics = {
      ...this.latestLiquidity,
      resiliencyMs: this.resiliencyStats.mean(now),
      effectiveSpread: this.effectiveSpreadStats.mean(now),
      realizedSpreadShortWindow: this.realizedSpreadStats.mean(now),
    };

    return {
      liquidityMetrics,
      passiveFlowMetrics,
      derivativesMetrics,
      toxicityMetrics,
      regimeMetrics,
      crossMarketMetrics,
      enableCrossMarketConfirmation: this.crossEnabled,
    };
  }

  private normalizeLevels(levels: [number, number, number][], bids: boolean): [number, number, number][] {
    const normalized = levels
      .filter((item) => Number.isFinite(item[0]) && Number.isFinite(item[1]) && item[1] > 0)
      .map((item) => [Number(item[0]), Number(item[1]), Number(item[2] || 0)] as [number, number, number]);
    normalized.sort((a, b) => bids ? b[0] - a[0] : a[0] - b[0]);
    return normalized.slice(0, 50);
  }

  private updateMid(ts: number, mid: number): void {
    if (!(mid > 0)) return;
    if (this.lastMidPrice != null && this.lastMidPrice > 0) {
      const logRet = Math.log(mid / this.lastMidPrice);
      if (Number.isFinite(logRet)) {
        this.latestReturn = logRet;
        this.ret1mStats.add(ts, logRet);
        this.ret5mStats.add(ts, logRet);
        this.ret15mStats.add(ts, logRet);
        this.returnEvents.push({ ts, value: logRet });
        this.pruneReturnEvents(ts);

        const absRetPct = Math.abs(logRet) * 100;
        if (this.microAtr <= 0) this.microAtr = absRetPct;
        else this.microAtr = (this.microAtr * (1 - this.microAtrAlpha)) + (absRetPct * this.microAtrAlpha);
        this.volOfVolStats.add(ts, this.ret1mStats.rms(ts) * 100);
      }
    }
    this.lastMidPrice = mid;
    this.midHistory.push({ ts, value: mid });
    this.pruneMidHistory(ts);
  }

  private updateLiquidityMetrics(
    ts: number,
    bids: [number, number, number][],
    asks: [number, number, number][],
    bestBid: number,
    bestAsk: number,
    mid: number | null
  ): void {
    const bestBidQty = bids[0]?.[1] || 0;
    const bestAskQty = asks[0]?.[1] || 0;
    const microPrice = (bestBid > 0 && bestAsk > 0 && (bestBidQty + bestAskQty) > 0)
      ? ((bestAsk * bestBidQty) + (bestBid * bestAskQty)) / (bestBidQty + bestAskQty)
      : null;

    this.latestLiquidity = {
      microPrice,
      imbalanceCurve: {
        level1: this.computeImbalanceRatio(bids, asks, 1),
        level5: this.computeImbalanceRatio(bids, asks, 5),
        level10: this.computeImbalanceRatio(bids, asks, 10),
        level20: this.computeImbalanceRatio(bids, asks, 20),
        level50: this.computeImbalanceRatio(bids, asks, 50),
      },
      bookSlopeBid: this.computeBookSlope(bids, bestBid, 'bid'),
      bookSlopeAsk: this.computeBookSlope(asks, bestAsk, 'ask'),
      bookConvexity: this.computeBookConvexity(bids, asks),
      liquidityWallScore: this.computeLiquidityWallScore(bids, asks),
      voidGapScore: this.computeVoidGapScore(bids, asks, mid),
      expectedSlippageBuy: this.simulateSlippage(asks, this.baseQty, bestAsk, 'buy'),
      expectedSlippageSell: this.simulateSlippage(bids, this.baseQty, bestBid, 'sell'),
      resiliencyMs: this.resiliencyStats.mean(ts),
      effectiveSpread: this.effectiveSpreadStats.mean(ts),
      realizedSpreadShortWindow: this.realizedSpreadStats.mean(ts),
    };
  }

  private updatePassiveFlowMetrics(ts: number, bids: [number, number, number][], asks: [number, number, number][]): void {
    const currentBids = new Map<number, number>();
    const currentAsks = new Map<number, number>();
    for (const [price, qty] of bids) currentBids.set(price, qty);
    for (const [price, qty] of asks) currentAsks.set(price, qty);

    const bidMedian = median(bids.map((x) => x[1]));
    const askMedian = median(asks.map((x) => x[1]));
    const bidLargeThreshold = Math.max(EPS, bidMedian * this.largeAddMultiplier);
    const askLargeThreshold = Math.max(EPS, askMedian * this.largeAddMultiplier);

    const bestBidPrice = bids[0]?.[0] ?? null;
    const bestAskPrice = asks[0]?.[0] ?? null;
    this.queueDeltaBestBid = bestBidPrice != null
      ? (currentBids.get(bestBidPrice) || 0) - (this.prevBids.get(bestBidPrice) || 0)
      : 0;
    this.queueDeltaBestAsk = bestAskPrice != null
      ? (currentAsks.get(bestAskPrice) || 0) - (this.prevAsks.get(bestAskPrice) || 0)
      : 0;

    let bidAdd = 0;
    let askAdd = 0;
    let bidCancel = 0;
    let askCancel = 0;
    let tradeRelated = 0;

    for (const [price, newQty] of currentBids.entries()) {
      const oldQty = this.prevBids.get(price) || 0;
      const delta = newQty - oldQty;
      if (delta > 0) {
        bidAdd += delta;
        this.registerAddEvent(ts, 'bid', price, delta, bidLargeThreshold);
      } else if (delta < 0) {
        const mag = Math.abs(delta);
        if (this.isLikelyTradeRelated(ts, 'bid', price)) tradeRelated += mag;
        else bidCancel += mag;
        this.registerCancelEvent(ts, 'bid', price, mag);
      }
    }
    for (const [price, oldQty] of this.prevBids.entries()) {
      if (currentBids.has(price)) continue;
      const mag = Math.abs(oldQty);
      if (this.isLikelyTradeRelated(ts, 'bid', price)) tradeRelated += mag;
      else bidCancel += mag;
      this.registerCancelEvent(ts, 'bid', price, mag);
    }

    for (const [price, newQty] of currentAsks.entries()) {
      const oldQty = this.prevAsks.get(price) || 0;
      const delta = newQty - oldQty;
      if (delta > 0) {
        askAdd += delta;
        this.registerAddEvent(ts, 'ask', price, delta, askLargeThreshold);
      } else if (delta < 0) {
        const mag = Math.abs(delta);
        if (this.isLikelyTradeRelated(ts, 'ask', price)) tradeRelated += mag;
        else askCancel += mag;
        this.registerCancelEvent(ts, 'ask', price, mag);
      }
    }
    for (const [price, oldQty] of this.prevAsks.entries()) {
      if (currentAsks.has(price)) continue;
      const mag = Math.abs(oldQty);
      if (this.isLikelyTradeRelated(ts, 'ask', price)) tradeRelated += mag;
      else askCancel += mag;
      this.registerCancelEvent(ts, 'ask', price, mag);
    }

    this.bidAddWindow.add(ts, bidAdd);
    this.askAddWindow.add(ts, askAdd);
    this.bidCancelWindow.add(ts, bidCancel);
    this.askCancelWindow.add(ts, askCancel);

    const adds = bidAdd + askAdd;
    const cancels = bidCancel + askCancel;
    this.depthDeltaDecomposition = {
      addVolume: adds,
      cancelVolume: cancels,
      tradeRelatedVolume: tradeRelated,
      netDepthDelta: adds - cancels - tradeRelated,
    };

    this.prevBids = currentBids;
    this.prevAsks = currentAsks;
    this.pruneLargeAddEvents(ts);
    this.pruneRecentTrades(ts);
    this.prunePriceRefreshMap(ts);
  }

  private updateResiliency(ts: number, bids: [number, number, number][], asks: [number, number, number][]): void {
    const topDepth10 = this.sumQty(bids, 10) + this.sumQty(asks, 10);
    const hasRecentLargeTrade = this.lastLargeTradeTs > 0 && (ts - this.lastLargeTradeTs) <= this.liquidationWindowMs;
    if (this.lastDepthTotal10 > EPS && topDepth10 > 0 && hasRecentLargeTrade) {
      const dropPct = (this.lastDepthTotal10 - topDepth10) / this.lastDepthTotal10;
      if (!this.pendingResiliency && dropPct >= this.sweepDropPct) {
        this.pendingResiliency = { startTs: ts, baselineDepth: this.lastDepthTotal10 };
      }
    }

    if (this.pendingResiliency) {
      const recovered = topDepth10 >= (this.pendingResiliency.baselineDepth * this.sweepRecoveryRatio);
      const elapsed = ts - this.pendingResiliency.startTs;
      if (recovered && elapsed >= 0) {
        this.resiliencyStats.add(ts, elapsed);
        this.pendingResiliency = null;
      } else if (elapsed > this.sweepMaxMs) {
        this.pendingResiliency = null;
      }
    }
    this.lastDepthTotal10 = topDepth10;
  }

  private trackRecentAggTrade(ts: number, side: TradeSide, price: number, notional: number): void {
    this.recentAggTrades.push({ ts, side, price, notional });
    this.pruneRecentTrades(ts);
  }

  private pruneRecentTrades(now: number): void {
    const cutoff = now - Math.max(this.tradeRelatedWindowMs, this.liquidationWindowMs, 10_000);
    while (this.recentAggHead < this.recentAggTrades.length && this.recentAggTrades[this.recentAggHead].ts < cutoff) {
      this.recentAggHead += 1;
    }
    if (this.recentAggHead > 0 && (this.recentAggHead >= 2048 || this.recentAggHead > (this.recentAggTrades.length >> 1))) {
      this.recentAggTrades = this.recentAggTrades.slice(this.recentAggHead);
      this.recentAggHead = 0;
    }
  }

  private isLikelyTradeRelated(ts: number, side: BookSide, price: number): boolean {
    const expectedAggressor: TradeSide = side === 'bid' ? 'sell' : 'buy';
    const cutoff = ts - this.tradeRelatedWindowMs;
    for (let i = this.recentAggTrades.length - 1; i >= this.recentAggHead; i -= 1) {
      const tr = this.recentAggTrades[i];
      if (tr.ts < cutoff) break;
      if (tr.side !== expectedAggressor) continue;
      const diffPct = Math.abs(tr.price - price) / Math.max(price, EPS);
      if (diffPct <= this.tradeRelatedPriceTolerancePct) return true;
    }
    return false;
  }

  private registerAddEvent(ts: number, side: BookSide, price: number, qtyDelta: number, largeThreshold: number): void {
    const key = `${side}:${price.toFixed(8)}`;
    const prevTs = this.addTimestampByPrice.get(key);
    if (prevTs != null && (ts - prevTs) <= this.refreshWindowMs) {
      this.refreshEvents.add(ts, 1);
    }
    this.addTimestampByPrice.set(key, ts);
    if (qtyDelta >= largeThreshold) {
      this.largeAddEvents.push({ ts, side, price, quantity: qtyDelta });
    }
  }

  private registerCancelEvent(ts: number, side: BookSide, price: number, qtyDelta: number): void {
    this.applySpoofDecay(ts);
    for (let i = this.largeAddEvents.length - 1; i >= this.largeAddHead; i -= 1) {
      const add = this.largeAddEvents[i];
      if (add.side !== side) continue;
      if (Math.abs(add.price - price) > EPS) continue;
      if ((ts - add.ts) > this.spoofWindowMs) continue;
      const ratio = qtyDelta / Math.max(add.quantity, EPS);
      if (ratio >= 0.6) this.spoofAccumulator += 1;
      this.largeAddEvents[i] = { ...this.largeAddEvents[i], quantity: 0 };
      break;
    }
  }

  private pruneLargeAddEvents(now: number): void {
    const cutoff = now - (this.spoofWindowMs + 1000);
    while (this.largeAddHead < this.largeAddEvents.length) {
      const item = this.largeAddEvents[this.largeAddHead];
      if (item.ts >= cutoff && item.quantity > 0) break;
      this.largeAddHead += 1;
    }
    if (this.largeAddHead > 0 && (this.largeAddHead >= 1024 || this.largeAddHead > (this.largeAddEvents.length >> 1))) {
      this.largeAddEvents = this.largeAddEvents.slice(this.largeAddHead);
      this.largeAddHead = 0;
    }
  }

  private prunePriceRefreshMap(now: number): void {
    if (this.addTimestampByPrice.size <= 400) return;
    const cutoff = now - Math.max(this.refreshWindowMs, this.spoofWindowMs, 60_000);
    for (const [key, ts] of this.addTimestampByPrice.entries()) {
      if (ts < cutoff) this.addTimestampByPrice.delete(key);
    }
  }

  private applySpoofDecay(now: number): void {
    if (this.spoofLastUpdateTs <= 0) {
      this.spoofLastUpdateTs = now;
      return;
    }
    const elapsed = Math.max(0, now - this.spoofLastUpdateTs);
    if (elapsed > 0) {
      this.spoofAccumulator *= Math.exp(-(elapsed / this.spoofHalfLifeMs));
    }
    this.spoofLastUpdateTs = now;
  }

  private applyLiquidationDecay(now: number): void {
    if (this.liquidationProxyLastTs <= 0) {
      this.liquidationProxyLastTs = now;
      return;
    }
    const elapsed = Math.max(0, now - this.liquidationProxyLastTs);
    if (elapsed > 0) {
      this.liquidationProxyAccumulator *= Math.exp(-(elapsed / this.liquidationHalfLifeMs));
    }
    this.liquidationProxyLastTs = now;
  }

  private tryTriggerLiquidationProxy(now: number): void {
    const largeTradeRecent = this.lastLargeTradeTs > 0 && (now - this.lastLargeTradeTs) <= this.liquidationWindowMs;
    const oiDropRecent = this.lastOiUpdateTs > 0 && (now - this.lastOiUpdateTs) <= this.liquidationWindowMs;
    const oiDropSpike = this.lastOiChangePct != null && this.lastOiChangePct <= this.liquidationOiDropPct;
    if (largeTradeRecent && oiDropRecent && oiDropSpike) {
      this.liquidationProxyAccumulator += 1;
    }
  }

  private updateVpin(ts: number, side: TradeSide, quantity: number): void {
    this.avgTradeQtyEwma = this.avgTradeQtyEwma <= EPS ? quantity : (this.avgTradeQtyEwma * 0.9) + (quantity * 0.1);
    const targetVolume = Math.max(1, this.avgTradeQtyEwma * this.vpinTargetMultiplier);
    let remaining = quantity;
    while (remaining > EPS) {
      const capacity = Math.max(EPS, targetVolume - this.vpinCurrentVolume);
      const take = Math.min(remaining, capacity);
      if (side === 'buy') this.vpinCurrentBuy += take;
      else this.vpinCurrentSell += take;
      this.vpinCurrentVolume += take;
      remaining -= take;
      if (this.vpinCurrentVolume >= targetVolume - EPS) {
        const imbalance = Math.abs(this.vpinCurrentBuy - this.vpinCurrentSell) / Math.max(this.vpinCurrentBuy + this.vpinCurrentSell, EPS);
        this.vpinBuckets.push({ ts, imbalance });
        this.vpinCurrentBuy = 0;
        this.vpinCurrentSell = 0;
        this.vpinCurrentVolume = 0;
      }
    }
    this.pruneVpinBuckets(ts);
  }

  private pruneVpinBuckets(now: number): void {
    const cutoff = now - this.vpinWindowMs;
    while (this.vpinHead < this.vpinBuckets.length && this.vpinBuckets[this.vpinHead].ts < cutoff) {
      this.vpinHead += 1;
    }
    if (this.vpinHead > 0 && (this.vpinHead >= 1024 || this.vpinHead > (this.vpinBuckets.length >> 1))) {
      this.vpinBuckets = this.vpinBuckets.slice(this.vpinHead);
      this.vpinHead = 0;
    }
  }

  private computeVpin(now: number): number {
    this.pruneVpinBuckets(now);
    const active = this.vpinBuckets.length - this.vpinHead;
    if (active <= 0) return 0;
    let sum = 0;
    for (let i = this.vpinHead; i < this.vpinBuckets.length; i += 1) sum += this.vpinBuckets[i].imbalance;
    return sum / active;
  }

  private updateBurstDetection(ts: number, side: TradeSide, mid: number): void {
    if (this.burstStreakSide === side) this.burstStreakCount += 1;
    else {
      this.burstStreakSide = side;
      this.burstStreakCount = 1;
      this.burstTriggeredInStreak = false;
    }

    if (!this.burstTriggeredInStreak && this.burstStreakCount >= this.burstThresholdTrades && mid > 0) {
      this.pendingBursts.push({ ts, side, midPriceAtBurst: mid });
      this.burstTriggeredInStreak = true;
    }
  }

  private resolvePendingBurstChecks(now: number, currentMid: number): void {
    const cutoff = now - this.burstHorizonMs;
    while (this.pendingBurstHead < this.pendingBursts.length) {
      const item = this.pendingBursts[this.pendingBurstHead];
      if (item.ts > cutoff) break;
      const success = item.side === 'buy'
        ? currentMid > item.midPriceAtBurst
        : currentMid < item.midPriceAtBurst;
      this.burstOutcomeStats.add(now, success ? 1 : 0);
      this.pendingBurstHead += 1;
    }
    this.prunePendingBursts(now);
  }

  private prunePendingBursts(now: number): void {
    const staleCutoff = now - (this.burstHorizonMs * 5);
    while (this.pendingBurstHead < this.pendingBursts.length && this.pendingBursts[this.pendingBurstHead].ts < staleCutoff) {
      this.pendingBurstHead += 1;
    }
    if (this.pendingBurstHead > 0 && (this.pendingBurstHead >= 512 || this.pendingBurstHead > (this.pendingBursts.length >> 1))) {
      this.pendingBursts = this.pendingBursts.slice(this.pendingBurstHead);
      this.pendingBurstHead = 0;
    }
  }

  private resolvePendingRealizedSpreads(now: number, currentMid: number): void {
    const cutoff = now - this.realizedSpreadDelayMs;
    while (this.pendingRealizedHead < this.pendingRealizedSpreads.length) {
      const item = this.pendingRealizedSpreads[this.pendingRealizedHead];
      if (item.ts > cutoff) break;
      if (item.tradePrice > 0) {
        const realized = item.side === 'buy'
          ? (2 * (currentMid - item.tradePrice) / item.tradePrice) * 100
          : (2 * (item.tradePrice - currentMid) / item.tradePrice) * 100;
        this.realizedSpreadStats.add(now, realized);
      }
      this.pendingRealizedHead += 1;
    }
    this.prunePendingRealized(now);
  }

  private prunePendingRealized(now: number): void {
    const staleCutoff = now - (this.realizedSpreadDelayMs * 4);
    while (this.pendingRealizedHead < this.pendingRealizedSpreads.length && this.pendingRealizedSpreads[this.pendingRealizedHead].ts < staleCutoff) {
      this.pendingRealizedHead += 1;
    }
    if (this.pendingRealizedHead > 0 && (this.pendingRealizedHead >= 1024 || this.pendingRealizedHead > (this.pendingRealizedSpreads.length >> 1))) {
      this.pendingRealizedSpreads = this.pendingRealizedSpreads.slice(this.pendingRealizedHead);
      this.pendingRealizedHead = 0;
    }
  }

  private pruneReturnEvents(now: number): void {
    const cutoff = now - 900_000;
    while (this.returnHead < this.returnEvents.length && this.returnEvents[this.returnHead].ts < cutoff) {
      this.returnHead += 1;
    }
    if (this.returnHead > 0 && (this.returnHead >= 4096 || this.returnHead > (this.returnEvents.length >> 1))) {
      this.returnEvents = this.returnEvents.slice(this.returnHead);
      this.returnHead = 0;
    }
  }

  private pruneMidHistory(now: number): void {
    const cutoff = now - 120_000;
    while (this.midHead < this.midHistory.length && this.midHistory[this.midHead].ts < cutoff) {
      this.midHead += 1;
    }
    if (this.midHead > 0 && (this.midHead >= 4096 || this.midHead > (this.midHistory.length >> 1))) {
      this.midHistory = this.midHistory.slice(this.midHead);
      this.midHead = 0;
    }
  }

  private computeImbalanceRatio(bids: [number, number, number][], asks: [number, number, number][], depth: number): number {
    const bidVol = this.sumQty(bids, depth);
    const askVol = this.sumQty(asks, depth);
    const denom = bidVol + askVol;
    if (denom <= EPS) return 0.5;
    return bidVol / denom;
  }

  private sumQty(levels: [number, number, number][], depth: number): number {
    const limit = Math.min(depth, levels.length);
    let total = 0;
    for (let i = 0; i < limit; i += 1) total += levels[i][1];
    return total;
  }

  private sumNotional(levels: [number, number, number][], depth: number): number {
    const limit = Math.min(depth, levels.length);
    let total = 0;
    for (let i = 0; i < limit; i += 1) total += (levels[i][0] * levels[i][1]);
    return total;
  }

  private computeTopDepthNotional(bids: [number, number, number][], asks: [number, number, number][], depth: number): number {
    return this.sumNotional(bids, depth) + this.sumNotional(asks, depth);
  }

  private computeBookSlope(levels: [number, number, number][], anchorPrice: number, side: BookSide): number {
    if (!(anchorPrice > 0) || levels.length < 2) return 0;
    let n = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    let cumulative = 0;
    const limit = Math.min(20, levels.length);
    for (let i = 0; i < limit; i += 1) {
      const [price, qty] = levels[i];
      cumulative += qty;
      const distance = side === 'bid'
        ? Math.max(0, (anchorPrice - price) / anchorPrice)
        : Math.max(0, (price - anchorPrice) / anchorPrice);
      n += 1;
      sumX += distance;
      sumY += cumulative;
      sumXX += distance * distance;
      sumXY += distance * cumulative;
    }
    if (n < 2) return 0;
    const denom = (n * sumXX) - (sumX * sumX);
    if (Math.abs(denom) <= EPS) return 0;
    return ((n * sumXY) - (sumX * sumY)) / denom;
  }

  private computeBookConvexity(bids: [number, number, number][], asks: [number, number, number][]): number {
    const b5 = this.sumQty(bids, 5);
    const b20 = this.sumQty(bids, 20);
    const b50 = this.sumQty(bids, 50);
    const a5 = this.sumQty(asks, 5);
    const a20 = this.sumQty(asks, 20);
    const a50 = this.sumQty(asks, 50);
    const bidConv = ((b50 - b20) - (b20 - b5)) / Math.max(Math.abs(b50), EPS);
    const askConv = ((a50 - a20) - (a20 - a5)) / Math.max(Math.abs(a50), EPS);
    return (bidConv + askConv) / 2;
  }

  private computeLiquidityWallScore(bids: [number, number, number][], asks: [number, number, number][]): number {
    const bidScore = this.maxZScore(bids.slice(0, 20).map((x) => x[1]));
    const askScore = this.maxZScore(asks.slice(0, 20).map((x) => x[1]));
    return bidScore >= askScore ? bidScore : -askScore;
  }

  private maxZScore(values: number[]): number {
    if (values.length <= 1) return 0;
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + ((value - mean) * (value - mean)), 0) / values.length;
    const std = Math.sqrt(Math.max(variance, 0));
    if (std <= EPS) return 0;
    let maxZ = 0;
    for (const value of values) {
      const z = (value - mean) / std;
      if (z > maxZ) maxZ = z;
    }
    return maxZ;
  }

  private computeVoidGapScore(bids: [number, number, number][], asks: [number, number, number][], mid: number | null): number {
    if (!(mid && mid > 0)) return 0;
    const gaps: number[] = [];
    for (let i = 1; i < Math.min(20, bids.length); i += 1) gaps.push(Math.abs(bids[i - 1][0] - bids[i][0]) / mid);
    for (let i = 1; i < Math.min(20, asks.length); i += 1) gaps.push(Math.abs(asks[i][0] - asks[i - 1][0]) / mid);
    if (gaps.length === 0) return 0;
    const med = Math.max(median(gaps), EPS);
    const maxGap = Math.max(...gaps);
    return Math.max(0, (maxGap / med) - 1);
  }

  private simulateSlippage(levels: [number, number, number][], baseQty: number, referencePrice: number, side: TradeSide): number {
    if (!(referencePrice > 0) || baseQty <= 0 || levels.length === 0) return 0;
    let remaining = baseQty;
    let filledQty = 0;
    let totalNotional = 0;
    for (const [price, qty] of levels) {
      if (remaining <= EPS) break;
      const take = Math.min(remaining, qty);
      filledQty += take;
      totalNotional += take * price;
      remaining -= take;
    }
    if (remaining > EPS) {
      const lastPrice = levels[levels.length - 1][0];
      const synthetic = side === 'buy' ? lastPrice * 1.0005 : lastPrice * 0.9995;
      totalNotional += remaining * synthetic;
      filledQty += remaining;
    }
    if (filledQty <= EPS) return 0;
    const avgPrice = totalNotional / filledQty;
    if (side === 'buy') return ((avgPrice - referencePrice) / referencePrice) * 100;
    return ((referencePrice - avgPrice) / referencePrice) * 100;
  }

  private computeShortWindowMidMovePct(now: number, windowMs: number): number {
    this.pruneMidHistory(now);
    if (this.midHistory.length - this.midHead < 2) return 0;
    const cutoff = now - windowMs;
    let start: number | null = null;
    for (let i = this.midHead; i < this.midHistory.length; i += 1) {
      if (this.midHistory[i].ts >= cutoff) {
        start = this.midHistory[i].value;
        break;
      }
    }
    const end = this.midHistory[this.midHistory.length - 1].value;
    if (!(start && start > 0 && end > 0)) return 0;
    return (end - start) / start;
  }

  private computeChopAndTrendiness(now: number, windowMs: number): { chopScore: number; trendinessScore: number } {
    const cutoff = now - windowMs;
    let lastSign = 0;
    let flips = 0;
    let count = 0;
    let net = 0;
    let totalAbs = 0;
    for (let i = this.returnEvents.length - 1; i >= this.returnHead; i -= 1) {
      const item = this.returnEvents[i];
      if (item.ts < cutoff) break;
      const ret = item.value;
      const sign = ret > 0 ? 1 : ret < 0 ? -1 : 0;
      if (sign !== 0) {
        if (lastSign !== 0 && sign !== lastSign) flips += 1;
        lastSign = sign;
      }
      count += 1;
      net += ret;
      totalAbs += Math.abs(ret);
    }
    if (count <= 1 || totalAbs <= EPS) return { chopScore: 0, trendinessScore: 0 };
    const alternation = flips / Math.max(1, count - 1);
    const trendiness = Math.abs(net) / totalAbs;
    return {
      chopScore: clamp(alternation * (1 - trendiness), 0, 1),
      trendinessScore: clamp(trendiness, 0, 1),
    };
  }

  private resolvePerpPrice(lastPrice: number | null): number | null {
    if (lastPrice != null && Number.isFinite(lastPrice) && lastPrice > 0) return lastPrice;
    if (this.lastMidPrice != null && this.lastMidPrice > 0) return this.lastMidPrice;
    if (this.lastTradePrice != null && this.lastTradePrice > 0) return this.lastTradePrice;
    return null;
  }

  private computeCrossMarketMetrics(now: number, perpPrice: number | null): CrossMarketMetrics {
    const betaToBTC = this.symbol.toUpperCase() === 'BTCUSDT' ? 1 : this.betaBtcRegression.slope(now);
    const betaToETH = this.symbol.toUpperCase() === 'ETHUSDT' ? 1 : this.betaEthRegression.slope(now);
    const spotPerpDivergence = (perpPrice != null && this.spotMidPrice != null && this.spotMidPrice > 0)
      ? ((perpPrice - this.spotMidPrice) / this.spotMidPrice) * 100
      : null;
    const crossVenueImbalanceDiff = this.spotImbalance10 != null
      ? this.currentPerpImbalance10 - this.spotImbalance10
      : null;
    return { ...DEFAULT_CROSS, spotPerpDivergence, betaToBTC, betaToETH, crossVenueImbalanceDiff };
  }
}
