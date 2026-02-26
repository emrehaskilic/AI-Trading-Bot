# AI Trading Bot - Metrik Envanteri

## 0) Baslik + Metadata

- Uretim tarihi: 2026-02-26T12:38:15.443Z
- Repo: AI-Trading-Bot
- Referans commit hash: e52ca7ea43f843422768dc4792177109a198f4b0
- Kapsam: Bu envanter yalnizca kod icindeki alan adlari ve referanslar taranarak uretilmistir.
- Decision mode notu: DECISION_MODE=off varsayilanidir; decision alanlari envantere NOOP/disabled default notuyla dahil edilmistir.

### Ozet Sayilar

- UI gorunen metrik sayisi: 101
- Payload-only metrik sayisi: 42
- Internal-only metrik sayisi: 541
- Typed payload surface metrik sayisi: 199

### Taranan Dosyalar

- server/ai/DecisionProvider.ts
- server/ai/NoopDecisionProvider.ts
- server/ai/RuntimeDecisionProvider.ts
- server/ai/types.ts
- server/index.ts
- server/metrics/AbsorptionDetector.ts
- server/metrics/AdvancedMicrostructureMetrics.ts
- server/metrics/CvdCalculator.ts
- server/metrics/ExecutionMetrics.ts
- server/metrics/FundingMonitor.ts
- server/metrics/FundingRateMonitor.ts
- server/metrics/HtfStructureMonitor.ts
- server/metrics/LatencyTracker.ts
- server/metrics/LegacyCalculator.ts
- server/metrics/MarketRegimeDetector.ts
- server/metrics/MetricsCalculator.ts
- server/metrics/OICalculator.ts
- server/metrics/OpenInterestMonitor.ts
- server/metrics/OrderbookIntegrityMonitor.ts
- server/metrics/OrderbookManager.ts
- server/metrics/PerformanceCalculator.ts
- server/metrics/PortfolioMetrics.ts
- server/metrics/RollingWindow.ts
- server/metrics/SessionVwapTracker.ts
- server/metrics/SignalPerformance.ts
- server/metrics/SpotReferenceMonitor.ts
- server/metrics/StrategyMetricsCollector.ts
- server/metrics/TimeAndSales.ts
- server/metrics/TradeMetrics.ts
- server/metrics/types.ts
- src/components/MobileSymbolCard.tsx
- src/components/SymbolRow.tsx
- src/components/panels/LeftStatsPanel.tsx
- src/components/panels/RightStatsPanel.tsx
- src/components/sections/OpenInterestSection.tsx
- src/types/metrics.ts

## 1) UI'da Gorunen Metrikler

### 1.1 Live Orderflow Metrics

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| legacyMetrics.deltaZ | raw | Legacy orderflow metriği: deltaZ | src/components/MobileSymbolCard.tsx:158 |
| legacyMetrics.obiDeep | price | Legacy orderflow metriği: obiDeep | src/components/MobileSymbolCard.tsx:150 |
| legacyMetrics.obiDivergence | price | Legacy orderflow metriği: obiDivergence | src/components/MobileSymbolCard.tsx:154 |
| legacyMetrics.obiWeighted | unknown | Legacy orderflow metriği: obiWeighted | src/components/MobileSymbolCard.tsx:146 |
| legacyMetrics.price | price | Legacy orderflow metriği: price | src/components/MobileSymbolCard.tsx:117 |
| state | raw | Telemetri alanı: state | src/components/MobileSymbolCard.tsx:131 |

### 1.2 Volume Analysis

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| timeAndSales.aggressiveBuyVolume | raw | Trade tape metriği: aggressiveBuyVolume | src/components/SymbolRow.tsx:414 |
| timeAndSales.aggressiveSellVolume | raw | Trade tape metriği: aggressiveSellVolume | src/components/SymbolRow.tsx:420 |
| timeAndSales.bidHitAskLiftRatio | price | Trade tape metriği: bidHitAskLiftRatio | src/components/panels/RightStatsPanel.tsx:24 |
| timeAndSales.consecutiveBurst.count | raw | Trade tape metriği: count | src/components/panels/RightStatsPanel.tsx:249 |
| timeAndSales.consecutiveBurst.side | raw | Trade tape metriği: side | src/components/panels/RightStatsPanel.tsx:249 |
| timeAndSales.largeTrades | unknown | Trade tape metriği: largeTrades | src/components/SymbolRow.tsx:454 |
| timeAndSales.midTrades | price | Trade tape metriği: midTrades | src/components/SymbolRow.tsx:450 |
| timeAndSales.printsPerSecond | unknown | Trade tape metriği: printsPerSecond | src/components/panels/RightStatsPanel.tsx:239 |
| timeAndSales.smallTrades | unknown | Trade tape metriği: smallTrades | src/components/SymbolRow.tsx:446 |
| timeAndSales.tradeCount | raw | Trade tape metriği: tradeCount | src/components/panels/RightStatsPanel.tsx:239 |

### 1.3 CVD

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| cvd.tf15m | unknown | CVD metriği: tf15m | src/components/SymbolRow.tsx:480 |
| cvd.tf1m | unknown | CVD metriği: tf1m | src/components/SymbolRow.tsx:478 |
| cvd.tf5m | unknown | CVD metriği: tf5m | src/components/SymbolRow.tsx:479 |
| legacyMetrics.cvdSession | unknown | Legacy orderflow metriği: cvdSession | src/components/panels/RightStatsPanel.tsx:112 |
| legacyMetrics.cvdSlope | raw | Legacy orderflow metriği: cvdSlope | src/components/MobileSymbolCard.tsx:162 |

### 1.4 Advanced Microstructure

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| crossMarketMetrics.betaToBTC | unknown | Cross-market metriği: betaToBTC | src/components/SymbolRow.tsx:685 |
| crossMarketMetrics.betaToETH | unknown | Cross-market metriği: betaToETH | src/components/SymbolRow.tsx:689 |
| crossMarketMetrics.crossVenueImbalanceDiff | unknown | Cross-market metriği: crossVenueImbalanceDiff | src/components/SymbolRow.tsx:693 |
| crossMarketMetrics.spotPerpDivergence | unknown | Cross-market metriği: spotPerpDivergence | src/components/SymbolRow.tsx:681 |
| derivativesMetrics.indexLastDeviationPct | pct | Türev piyasa metriği: indexLastDeviationPct | src/components/SymbolRow.tsx:202 |
| derivativesMetrics.liquidationProxyScore | raw | Türev piyasa metriği: liquidationProxyScore | src/components/SymbolRow.tsx:601 |
| derivativesMetrics.markLastDeviationPct | pct | Türev piyasa metriği: markLastDeviationPct | src/components/SymbolRow.tsx:201 |
| derivativesMetrics.perpBasis | raw | Türev piyasa metriği: perpBasis | src/components/MobileSymbolCard.tsx:213 |
| derivativesMetrics.perpBasisZScore | raw | Türev piyasa metriği: perpBasisZScore | src/components/SymbolRow.tsx:597 |
| liquidityMetrics.bookConvexity | unknown | Likidite metriği: bookConvexity | src/components/SymbolRow.tsx:537 |
| liquidityMetrics.effectiveSpread | raw | Likidite metriği: effectiveSpread | src/components/SymbolRow.tsx:635 |
| liquidityMetrics.expectedSlippageBuy | unknown | Likidite metriği: expectedSlippageBuy | src/components/SymbolRow.tsx:541 |
| liquidityMetrics.expectedSlippageSell | unknown | Likidite metriği: expectedSlippageSell | src/components/SymbolRow.tsx:545 |
| liquidityMetrics.liquidityWallScore | raw | Likidite metriği: liquidityWallScore | src/components/SymbolRow.tsx:529 |
| liquidityMetrics.microPrice | price | Likidite metriği: microPrice | src/components/MobileSymbolCard.tsx:209 |
| liquidityMetrics.resiliencyMs | raw | Likidite metriği: resiliencyMs | src/components/SymbolRow.tsx:605 |
| liquidityMetrics.voidGapScore | raw | Likidite metriği: voidGapScore | src/components/SymbolRow.tsx:533 |
| passiveFlowMetrics.askAddRate | price | Pasif akış metriği: askAddRate | src/components/SymbolRow.tsx:559 |
| passiveFlowMetrics.askCancelRate | price | Pasif akış metriği: askCancelRate | src/components/SymbolRow.tsx:567 |
| passiveFlowMetrics.bidAddRate | price | Pasif akış metriği: bidAddRate | src/components/SymbolRow.tsx:555 |
| passiveFlowMetrics.bidCancelRate | price | Pasif akış metriği: bidCancelRate | src/components/SymbolRow.tsx:563 |
| passiveFlowMetrics.refreshRate | unknown | Pasif akış metriği: refreshRate | src/components/SymbolRow.tsx:575 |
| passiveFlowMetrics.spoofScore | raw | Pasif akış metriği: spoofScore | src/components/MobileSymbolCard.tsx:223 |
| regimeMetrics.chopScore | raw | Rejim metriği: chopScore | src/components/MobileSymbolCard.tsx:229 |
| regimeMetrics.realizedVol15m | raw | Rejim metriği: realizedVol15m | src/components/SymbolRow.tsx:653 |
| regimeMetrics.realizedVol1m | raw | Rejim metriği: realizedVol1m | src/components/SymbolRow.tsx:645 |
| regimeMetrics.realizedVol5m | raw | Rejim metriği: realizedVol5m | src/components/SymbolRow.tsx:649 |
| regimeMetrics.trendinessScore | raw | Rejim metriği: trendinessScore | src/components/MobileSymbolCard.tsx:233 |
| regimeMetrics.volOfVol | raw | Rejim metriği: volOfVol | src/components/SymbolRow.tsx:657 |
| toxicityMetrics.burstPersistenceScore | raw | Toxicity metriği: burstPersistenceScore | src/components/SymbolRow.tsx:631 |
| toxicityMetrics.priceImpactPerSignedNotional | price | Toxicity metriği: priceImpactPerSignedNotional | src/components/SymbolRow.tsx:623 |
| toxicityMetrics.signedVolumeRatio | raw | Toxicity metriği: signedVolumeRatio | src/components/SymbolRow.tsx:619 |
| toxicityMetrics.tradeToBookRatio | raw | Toxicity metriği: tradeToBookRatio | src/components/SymbolRow.tsx:627 |
| toxicityMetrics.vpinApprox | unknown | Toxicity metriği: vpinApprox | src/components/MobileSymbolCard.tsx:219 |

### 1.5 Diger UI panelleri

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| advancedMetrics | unknown | Özet advanced skor alanı: advancedMetrics | src/components/SymbolRow.tsx:500 |
| aiBias | unknown | AI bias alanı: aiBias | src/components/MobileSymbolCard.tsx:32 |
| aiBias.confidence | unknown | AI bias alanı: confidence | src/components/MobileSymbolCard.tsx:39 |
| aiBias.reason | raw | AI bias alanı: reason | src/components/SymbolRow.tsx:136 |
| aiBias.side | raw | AI bias alanı: side | src/components/MobileSymbolCard.tsx:34 |
| aiTrend | raw | AI trend alanı: aiTrend | src/components/MobileSymbolCard.tsx:31 |
| aiTrend.intact | bool | AI trend alanı: intact | src/components/MobileSymbolCard.tsx:47 |
| asks | price | Orderbook ask seviyesi: asks | src/components/MobileSymbolCard.tsx:238 |
| bids | price | Orderbook bid seviyesi: bids | src/components/MobileSymbolCard.tsx:238 |
| cvd | unknown | CVD metriği: cvd | src/components/panels/RightStatsPanel.tsx:257 |
| funding.rate | unknown | Funding metriği: rate | src/components/panels/RightStatsPanel.tsx:306 |
| funding.timeToFundingMs | raw | Funding metriği: timeToFundingMs | src/components/panels/RightStatsPanel.tsx:307 |
| funding.trend | raw | Funding metriği: trend | src/components/panels/RightStatsPanel.tsx:308 |
| htf | unknown | HTF ham structure metriği: htf | src/components/MobileSymbolCard.tsx:30 |
| legacyMetrics | unknown | Legacy orderflow metriği: legacyMetrics | src/components/MobileSymbolCard.tsx:17 |
| legacyMetrics.delta1s | raw | Legacy orderflow metriği: delta1s | src/components/panels/RightStatsPanel.tsx:109 |
| legacyMetrics.delta5s | raw | Legacy orderflow metriği: delta5s | src/components/panels/RightStatsPanel.tsx:110 |
| openInterest | raw | Open interest metriği: openInterest | src/components/SymbolRow.tsx:741 |
| openInterest.oiChangeAbs | unknown | Open interest metriği: oiChangeAbs | src/components/SymbolRow.tsx:250 |
| openInterest.openInterest | raw | Open interest metriği: openInterest | src/components/SymbolRow.tsx:248 |
| openInterest.stabilityMsg | unknown | Open interest metriği: stabilityMsg | src/components/panels/RightStatsPanel.tsx:291 |
| sessionVwap | price | Session VWAP ham metriği: sessionVwap | src/components/MobileSymbolCard.tsx:29 |
| signalDisplay.candidate | unknown | Sinyal gösterim alanı: candidate | src/components/SymbolRow.tsx:730 |
| signalDisplay.vetoReason | raw | Sinyal gösterim alanı: vetoReason | src/components/SymbolRow.tsx:136 |
| snapshot.eventId | unknown | Snapshot metadata alanı: eventId | src/components/SymbolRow.tsx:705 |
| strategyPosition.side | raw | Strateji pozisyon alanı: side | src/components/MobileSymbolCard.tsx:33 |

### 1.6 Yeni: Session VWAP (UI)

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| sessionVwap.elapsedMs | raw | Session VWAP ham metriği: elapsedMs | src/components/MobileSymbolCard.tsx:102 |
| sessionVwap.name | raw | Session VWAP ham metriği: name | src/components/MobileSymbolCard.tsx:119 |
| sessionVwap.priceDistanceBps | bps | Session VWAP ham metriği: priceDistanceBps | src/components/MobileSymbolCard.tsx:119 |
| sessionVwap.sessionRangePct | pct | Session VWAP ham metriği: sessionRangePct | src/components/MobileSymbolCard.tsx:119 |
| sessionVwap.sessionStartMs | raw | Session VWAP ham metriği: sessionStartMs | src/components/MobileSymbolCard.tsx:167 |
| sessionVwap.value | unknown | Session VWAP ham metriği: value | src/components/MobileSymbolCard.tsx:119 |

### 1.7 Yeni: HTF (1H/4H) (UI)

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| htf.h1.atr | price | HTF ham structure metriği: atr | src/components/MobileSymbolCard.tsx:171 |
| htf.h1.barStartMs | raw | HTF ham structure metriği: barStartMs | src/components/panels/RightStatsPanel.tsx:131 |
| htf.h1.close | price | HTF ham structure metriği: close | src/components/MobileSymbolCard.tsx:192 |
| htf.h1.lastSwingHigh | price | HTF ham structure metriği: lastSwingHigh | src/components/MobileSymbolCard.tsx:194 |
| htf.h1.lastSwingLow | price | HTF ham structure metriği: lastSwingLow | src/components/MobileSymbolCard.tsx:194 |
| htf.h1.structureBreakDn | bool | HTF ham structure metriği: structureBreakDn | src/components/MobileSymbolCard.tsx:105 |
| htf.h1.structureBreakUp | bool | HTF ham structure metriği: structureBreakUp | src/components/MobileSymbolCard.tsx:105 |
| htf.h4.atr | price | HTF ham structure metriği: atr | src/components/MobileSymbolCard.tsx:176 |
| htf.h4.barStartMs | raw | HTF ham structure metriği: barStartMs | src/components/panels/RightStatsPanel.tsx:136 |
| htf.h4.close | price | HTF ham structure metriği: close | src/components/MobileSymbolCard.tsx:199 |
| htf.h4.lastSwingHigh | price | HTF ham structure metriği: lastSwingHigh | src/components/MobileSymbolCard.tsx:201 |
| htf.h4.lastSwingLow | price | HTF ham structure metriği: lastSwingLow | src/components/MobileSymbolCard.tsx:201 |
| htf.h4.structureBreakDn | bool | HTF ham structure metriği: structureBreakDn | src/components/MobileSymbolCard.tsx:106 |
| htf.h4.structureBreakUp | bool | HTF ham structure metriği: structureBreakUp | src/components/MobileSymbolCard.tsx:106 |

## 2) UI'da Dogrudan Gorunmeyen ama Payload'da Olanlar

### 2.1 Payload-only alanlar

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| absorption | unknown | Telemetri alanı: absorption | server/index.ts:1723 |
| advancedMetrics.breakoutScore | raw | Özet advanced skor alanı: breakoutScore | server/index.ts:1748 |
| advancedMetrics.sweepFadeScore | raw | Özet advanced skor alanı: sweepFadeScore | server/index.ts:1747 |
| advancedMetrics.volatilityIndex | raw | Özet advanced skor alanı: volatilityIndex | server/index.ts:1749 |
| bestAsk | price | Telemetri alanı: bestAsk | server/index.ts:1760 |
| bestBid | price | Telemetri alanı: bestBid | server/index.ts:1759 |
| crossMarketMetrics | unknown | Cross-market metriği: crossMarketMetrics | server/index.ts:1756 |
| cvd.tf15m.cvd | unknown | CVD metriği: cvd | server/index.ts:1720 |
| cvd.tf15m.delta | raw | CVD metriği: delta | server/index.ts:1720 |
| cvd.tf15m.state | raw | CVD metriği: state | server/index.ts:1720 |
| cvd.tf1m.cvd | unknown | CVD metriği: cvd | server/index.ts:1718 |
| cvd.tf1m.delta | raw | CVD metriği: delta | server/index.ts:1718 |
| cvd.tf1m.state | raw | CVD metriği: state | server/index.ts:1718 |
| cvd.tf5m.cvd | unknown | CVD metriği: cvd | server/index.ts:1719 |
| cvd.tf5m.delta | raw | CVD metriği: delta | server/index.ts:1719 |
| cvd.tf5m.state | raw | CVD metriği: state | server/index.ts:1719 |
| cvd.tradeCounts | raw | CVD metriği: tradeCounts | server/index.ts:1721 |
| derivativesMetrics | unknown | Türev piyasa metriği: derivativesMetrics | server/index.ts:1753 |
| enableCrossMarketConfirmation | unknown | Telemetri alanı: enableCrossMarketConfirmation | server/index.ts:1757 |
| event_time_ms | raw | Telemetri alanı: event_time_ms | server/index.ts:1714 |
| funding | unknown | Funding metriği: funding | server/index.ts:1725 |
| htf.h1 | unknown | HTF ham structure metriği: h1 | server/index.ts:1741 |
| htf.h4 | unknown | HTF ham structure metriği: h4 | server/index.ts:1742 |
| lastUpdateId | unknown | Telemetri alanı: lastUpdateId | server/index.ts:1763 |
| liquidityMetrics | unknown | Likidite metriği: liquidityMetrics | server/index.ts:1751 |
| midPrice | price | Orta fiyat alanı: midPrice | server/index.ts:1762 |
| orderbookIntegrity | unknown | Orderbook integrity alanı: orderbookIntegrity | server/index.ts:1744 |
| passiveFlowMetrics | unknown | Pasif akış metriği: passiveFlowMetrics | server/index.ts:1752 |
| regimeMetrics | unknown | Rejim metriği: regimeMetrics | server/index.ts:1755 |
| snapshot | unknown | Snapshot metadata alanı: snapshot | server/index.ts:1715 |
| spreadPct | pct | Telemetri alanı: spreadPct | server/index.ts:1761 |
| symbol | unknown | Telemetri alanı: symbol | server/index.ts:1712 |
| timeAndSales | unknown | Trade tape metriği: timeAndSales | server/index.ts:1716 |
| toxicityMetrics | unknown | Toxicity metriği: toxicityMetrics | server/index.ts:1754 |
| type | unknown | Telemetri alanı: type | server/index.ts:1711 |

### 2.2 Decision alanlari (NOOP/disabled default)

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| aiBias | unknown | AI bias alanı: aiBias | server/index.ts:1727 |
| aiTrend | raw | AI trend alanı: aiTrend | server/index.ts:1726 |
| signalDisplay | raw | Sinyal gösterim alanı: signalDisplay | server/index.ts:1745 |
| strategyPosition | unknown | Strateji pozisyon alanı: strategyPosition | server/index.ts:1728 |
| strategyPosition.addsUsed | unknown | Strateji pozisyon alanı: addsUsed | server/index.ts:1734 |
| strategyPosition.entryPrice | price | Strateji pozisyon alanı: entryPrice | server/index.ts:1732 |
| strategyPosition.qty | raw | Strateji pozisyon alanı: qty | server/index.ts:1731 |
| strategyPosition.side | raw | Strateji pozisyon alanı: side | server/index.ts:1730 |
| strategyPosition.timeInPositionMs | raw | Strateji pozisyon alanı: timeInPositionMs | server/index.ts:1735 |
| strategyPosition.unrealizedPnlPct | pct | Strateji pozisyon alanı: unrealizedPnlPct | server/index.ts:1733 |

## 3) AI Dry Run / LLM Karar Pipeline Metrikleri

DECISION_MODE=off varsayilanda karar motoru NOOP provider ile neutral alanlar dondurur; asagidaki alanlar tip/telemetry yuzeyinde tanimlidir.

### 3.1 AI/Decision tip yuzeyi

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| AIAddTrigger.deltaConfirm | bool | AI karar pipeline alani: AIAddTrigger.deltaConfirm | server/ai/types.ts:214 |
| AIAddTrigger.minUnrealizedPnlPct | pct | AI karar pipeline alani: AIAddTrigger.minUnrealizedPnlPct | server/ai/types.ts:211 |
| AIAddTrigger.obiSupportMin | unknown | AI karar pipeline alani: AIAddTrigger.obiSupportMin | server/ai/types.ts:213 |
| AIAddTrigger.trendIntact | bool | AI karar pipeline alani: AIAddTrigger.trendIntact | server/ai/types.ts:212 |
| AIBiasStatus.breakConfirm | unknown | AI karar pipeline alani: AIBiasStatus.breakConfirm | server/ai/types.ts:91 |
| AIBiasStatus.confidence | unknown | AI karar pipeline alani: AIBiasStatus.confidence | server/ai/types.ts:88 |
| AIBiasStatus.lockedByPosition | bool | AI karar pipeline alani: AIBiasStatus.lockedByPosition | server/ai/types.ts:90 |
| AIBiasStatus.reason | raw | AI karar pipeline alani: AIBiasStatus.reason | server/ai/types.ts:92 |
| AIBiasStatus.side | raw | AI karar pipeline alani: AIBiasStatus.side | server/ai/types.ts:87 |
| AIBiasStatus.source | raw | AI karar pipeline alani: AIBiasStatus.source | server/ai/types.ts:89 |
| AIBiasStatus.timestampMs | raw | AI karar pipeline alani: AIBiasStatus.timestampMs | server/ai/types.ts:93 |
| AIDecisionPlan.addRule | unknown | AI karar pipeline alani: AIDecisionPlan.addRule | server/ai/types.ts:226 |
| AIDecisionPlan.addTrigger | unknown | AI karar pipeline alani: AIDecisionPlan.addTrigger | server/ai/types.ts:227 |
| AIDecisionPlan.addTrigger.deltaConfirm | bool | Telemetri alanı: deltaConfirm | server/ai/types.ts:214 |
| AIDecisionPlan.addTrigger.minUnrealizedPnlPct | pct | Telemetri alanı: minUnrealizedPnlPct | server/ai/types.ts:211 |
| AIDecisionPlan.addTrigger.obiSupportMin | unknown | Telemetri alanı: obiSupportMin | server/ai/types.ts:213 |
| AIDecisionPlan.addTrigger.trendIntact | bool | Telemetri alanı: trendIntact | server/ai/types.ts:212 |
| AIDecisionPlan.confidence | unknown | AI karar pipeline alani: AIDecisionPlan.confidence | server/ai/types.ts:231 |
| AIDecisionPlan.entryStyle | unknown | AI karar pipeline alani: AIDecisionPlan.entryStyle | server/ai/types.ts:223 |
| AIDecisionPlan.explanationTags | unknown | AI karar pipeline alani: AIDecisionPlan.explanationTags | server/ai/types.ts:230 |
| AIDecisionPlan.intent | unknown | AI karar pipeline alani: AIDecisionPlan.intent | server/ai/types.ts:220 |
| AIDecisionPlan.invalidationHint | unknown | AI karar pipeline alani: AIDecisionPlan.invalidationHint | server/ai/types.ts:229 |
| AIDecisionPlan.maxAdds | unknown | AI karar pipeline alani: AIDecisionPlan.maxAdds | server/ai/types.ts:225 |
| AIDecisionPlan.nonce | unknown | AI karar pipeline alani: AIDecisionPlan.nonce | server/ai/types.ts:219 |
| AIDecisionPlan.reducePct | pct | AI karar pipeline alani: AIDecisionPlan.reducePct | server/ai/types.ts:228 |
| AIDecisionPlan.side | raw | AI karar pipeline alani: AIDecisionPlan.side | server/ai/types.ts:221 |
| AIDecisionPlan.sizeMultiplier | unknown | AI karar pipeline alani: AIDecisionPlan.sizeMultiplier | server/ai/types.ts:224 |
| AIDecisionPlan.urgency | unknown | AI karar pipeline alani: AIDecisionPlan.urgency | server/ai/types.ts:222 |
| AIDecisionPlan.version | unknown | AI karar pipeline alani: AIDecisionPlan.version | server/ai/types.ts:218 |
| AIDecisionTelemetry.addsCount | raw | AI karar pipeline alani: AIDecisionTelemetry.addsCount | server/ai/types.ts:69 |
| AIDecisionTelemetry.avgHoldTimeMs | raw | AI karar pipeline alani: AIDecisionTelemetry.avgHoldTimeMs | server/ai/types.ts:73 |
| AIDecisionTelemetry.edgeFilteredEntries | unknown | AI karar pipeline alani: AIDecisionTelemetry.edgeFilteredEntries | server/ai/types.ts:71 |
| AIDecisionTelemetry.feePct | pct | AI karar pipeline alani: AIDecisionTelemetry.feePct | server/ai/types.ts:74 |
| AIDecisionTelemetry.flipsCount | raw | AI karar pipeline alani: AIDecisionTelemetry.flipsCount | server/ai/types.ts:68 |
| AIDecisionTelemetry.forcedExits | unknown | AI karar pipeline alani: AIDecisionTelemetry.forcedExits | server/ai/types.ts:67 |
| AIDecisionTelemetry.guardrailBlocks | unknown | AI karar pipeline alani: AIDecisionTelemetry.guardrailBlocks | server/ai/types.ts:66 |
| AIDecisionTelemetry.holdOverrides | unknown | AI karar pipeline alani: AIDecisionTelemetry.holdOverrides | server/ai/types.ts:72 |
| AIDecisionTelemetry.invalidLLMResponses | unknown | AI karar pipeline alani: AIDecisionTelemetry.invalidLLMResponses | server/ai/types.ts:64 |
| AIDecisionTelemetry.probeEntries | unknown | AI karar pipeline alani: AIDecisionTelemetry.probeEntries | server/ai/types.ts:70 |
| AIDecisionTelemetry.repairCalls | unknown | AI karar pipeline alani: AIDecisionTelemetry.repairCalls | server/ai/types.ts:65 |
| AIDryRunConfig.apiKey | unknown | AI karar pipeline alani: AIDryRunConfig.apiKey | server/ai/types.ts:52 |
| AIDryRunConfig.decisionIntervalMs | raw | AI karar pipeline alani: AIDryRunConfig.decisionIntervalMs | server/ai/types.ts:54 |
| AIDryRunConfig.flipCooldownMs | raw | AI karar pipeline alani: AIDryRunConfig.flipCooldownMs | server/ai/types.ts:59 |
| AIDryRunConfig.localOnly | bool | AI karar pipeline alani: AIDryRunConfig.localOnly | server/ai/types.ts:57 |
| AIDryRunConfig.maxOutputTokens | unknown | AI karar pipeline alani: AIDryRunConfig.maxOutputTokens | server/ai/types.ts:56 |
| AIDryRunConfig.minAddGapMs | raw | AI karar pipeline alani: AIDryRunConfig.minAddGapMs | server/ai/types.ts:60 |
| AIDryRunConfig.minHoldMs | raw | AI karar pipeline alani: AIDryRunConfig.minHoldMs | server/ai/types.ts:58 |
| AIDryRunConfig.model | unknown | AI karar pipeline alani: AIDryRunConfig.model | server/ai/types.ts:53 |
| AIDryRunConfig.temperature | unknown | AI karar pipeline alani: AIDryRunConfig.temperature | server/ai/types.ts:55 |
| AIDryRunStatus.active | bool | AI karar pipeline alani: AIDryRunStatus.active | server/ai/types.ts:97 |
| AIDryRunStatus.apiKeySet | bool | AI karar pipeline alani: AIDryRunStatus.apiKeySet | server/ai/types.ts:102 |
| AIDryRunStatus.decisionIntervalMs | raw | AI karar pipeline alani: AIDryRunStatus.decisionIntervalMs | server/ai/types.ts:99 |
| AIDryRunStatus.lastError | unknown | AI karar pipeline alani: AIDryRunStatus.lastError | server/ai/types.ts:104 |
| AIDryRunStatus.localOnly | bool | AI karar pipeline alani: AIDryRunStatus.localOnly | server/ai/types.ts:103 |
| AIDryRunStatus.maxOutputTokens | unknown | AI karar pipeline alani: AIDryRunStatus.maxOutputTokens | server/ai/types.ts:101 |
| AIDryRunStatus.model | unknown | AI karar pipeline alani: AIDryRunStatus.model | server/ai/types.ts:98 |
| AIDryRunStatus.performance | unknown | AI karar pipeline alani: AIDryRunStatus.performance | server/ai/types.ts:107 |
| AIDryRunStatus.performance.avgLoss | unknown | Telemetri alanı: avgLoss | server/ai/types.ts:112 |
| AIDryRunStatus.performance.avgOutcome | unknown | Telemetri alanı: avgOutcome | server/ai/types.ts:110 |
| AIDryRunStatus.performance.avgWin | unknown | Telemetri alanı: avgWin | server/ai/types.ts:111 |
| AIDryRunStatus.performance.profitFactor | unknown | Telemetri alanı: profitFactor | server/ai/types.ts:113 |
| AIDryRunStatus.performance.samples | unknown | Telemetri alanı: samples | server/ai/types.ts:108 |
| AIDryRunStatus.performance.winRate | unknown | Telemetri alanı: winRate | server/ai/types.ts:109 |
| AIDryRunStatus.symbols | unknown | AI karar pipeline alani: AIDryRunStatus.symbols | server/ai/types.ts:105 |
| AIDryRunStatus.telemetry | unknown | AI karar pipeline alani: AIDryRunStatus.telemetry | server/ai/types.ts:106 |
| AIDryRunStatus.telemetry.addsCount | raw | Telemetri alanı: addsCount | server/ai/types.ts:69 |
| AIDryRunStatus.telemetry.avgHoldTimeMs | raw | Telemetri alanı: avgHoldTimeMs | server/ai/types.ts:73 |
| AIDryRunStatus.telemetry.edgeFilteredEntries | unknown | Telemetri alanı: edgeFilteredEntries | server/ai/types.ts:71 |
| AIDryRunStatus.telemetry.feePct | pct | Telemetri alanı: feePct | server/ai/types.ts:74 |
| AIDryRunStatus.telemetry.flipsCount | raw | Telemetri alanı: flipsCount | server/ai/types.ts:68 |
| AIDryRunStatus.telemetry.forcedExits | unknown | Telemetri alanı: forcedExits | server/ai/types.ts:67 |
| AIDryRunStatus.telemetry.guardrailBlocks | unknown | Telemetri alanı: guardrailBlocks | server/ai/types.ts:66 |
| AIDryRunStatus.telemetry.holdOverrides | unknown | Telemetri alanı: holdOverrides | server/ai/types.ts:72 |
| AIDryRunStatus.telemetry.invalidLLMResponses | unknown | Telemetri alanı: invalidLLMResponses | server/ai/types.ts:64 |
| AIDryRunStatus.telemetry.probeEntries | unknown | Telemetri alanı: probeEntries | server/ai/types.ts:70 |
| AIDryRunStatus.telemetry.repairCalls | unknown | Telemetri alanı: repairCalls | server/ai/types.ts:65 |
| AIDryRunStatus.temperature | unknown | AI karar pipeline alani: AIDryRunStatus.temperature | server/ai/types.ts:100 |
| AIForcedAction.intent | unknown | AI karar pipeline alani: AIForcedAction.intent | server/ai/types.ts:235 |
| AIForcedAction.reason | raw | AI karar pipeline alani: AIForcedAction.reason | server/ai/types.ts:237 |
| AIForcedAction.reducePct | pct | AI karar pipeline alani: AIForcedAction.reducePct | server/ai/types.ts:236 |
| AIMetricsSnapshot.absorption | unknown | AI karar pipeline alani: AIMetricsSnapshot.absorption | server/ai/types.ts:195 |
| AIMetricsSnapshot.absorption.side | raw | Telemetri alanı: side | server/ai/types.ts:197 |
| AIMetricsSnapshot.absorption.value | unknown | Telemetri alanı: value | server/ai/types.ts:196 |
| AIMetricsSnapshot.blockedReasons | raw | AI karar pipeline alani: AIMetricsSnapshot.blockedReasons | server/ai/types.ts:133 |
| AIMetricsSnapshot.crossMarketMetrics | unknown | AI karar pipeline alani: AIMetricsSnapshot.crossMarketMetrics | server/ai/types.ts:190 |
| AIMetricsSnapshot.decision | bool | AI karar pipeline alani: AIMetricsSnapshot.decision | server/ai/types.ts:120 |
| AIMetricsSnapshot.decision.dfs | unknown | Telemetri alanı: dfs | server/ai/types.ts:122 |
| AIMetricsSnapshot.decision.dfsPercentile | pct | Telemetri alanı: dfsPercentile | server/ai/types.ts:123 |
| AIMetricsSnapshot.decision.gatePassed | bool | Telemetri alanı: gatePassed | server/ai/types.ts:125 |
| AIMetricsSnapshot.decision.regime | unknown | Telemetri alanı: regime | server/ai/types.ts:121 |
| AIMetricsSnapshot.decision.thresholds | unknown | Telemetri alanı: thresholds | server/ai/types.ts:126 |
| AIMetricsSnapshot.decision.thresholds.longBreak | unknown | Telemetri alanı: longBreak | server/ai/types.ts:128 |
| AIMetricsSnapshot.decision.thresholds.longEntry | unknown | Telemetri alanı: longEntry | server/ai/types.ts:127 |
| AIMetricsSnapshot.decision.thresholds.shortBreak | unknown | Telemetri alanı: shortBreak | server/ai/types.ts:130 |
| AIMetricsSnapshot.decision.thresholds.shortEntry | unknown | Telemetri alanı: shortEntry | server/ai/types.ts:129 |
| AIMetricsSnapshot.decision.volLevel | raw | Telemetri alanı: volLevel | server/ai/types.ts:124 |
| AIMetricsSnapshot.derivativesMetrics | unknown | AI karar pipeline alani: AIMetricsSnapshot.derivativesMetrics | server/ai/types.ts:187 |
| AIMetricsSnapshot.enableCrossMarketConfirmation | bool | AI karar pipeline alani: AIMetricsSnapshot.enableCrossMarketConfirmation | server/ai/types.ts:191 |
| AIMetricsSnapshot.executionState | bool | AI karar pipeline alani: AIMetricsSnapshot.executionState | server/ai/types.ts:146 |
| AIMetricsSnapshot.executionState.bootstrapPhaseMsRemaining | unknown | Telemetri alanı: bootstrapPhaseMsRemaining | server/ai/types.ts:161 |
| AIMetricsSnapshot.executionState.bootstrapSeedStrength | unknown | Telemetri alanı: bootstrapSeedStrength | server/ai/types.ts:162 |
| AIMetricsSnapshot.executionState.bootstrapWarmupMsRemaining | unknown | Telemetri alanı: bootstrapWarmupMsRemaining | server/ai/types.ts:163 |
| AIMetricsSnapshot.executionState.holdStreak | unknown | Telemetri alanı: holdStreak | server/ai/types.ts:148 |
| AIMetricsSnapshot.executionState.lastAction | unknown | Telemetri alanı: lastAction | server/ai/types.ts:147 |
| AIMetricsSnapshot.executionState.lastAddMsAgo | unknown | Telemetri alanı: lastAddMsAgo | server/ai/types.ts:149 |
| AIMetricsSnapshot.executionState.lastFlipMsAgo | unknown | Telemetri alanı: lastFlipMsAgo | server/ai/types.ts:150 |
| AIMetricsSnapshot.executionState.lastTrendTakeProfitMsAgo | raw | Telemetri alanı: lastTrendTakeProfitMsAgo | server/ai/types.ts:160 |
| AIMetricsSnapshot.executionState.trendAgeMs | raw | Telemetri alanı: trendAgeMs | server/ai/types.ts:158 |
| AIMetricsSnapshot.executionState.trendBias | raw | Telemetri alanı: trendBias | server/ai/types.ts:155 |
| AIMetricsSnapshot.executionState.trendBreakConfirm | raw | Telemetri alanı: trendBreakConfirm | server/ai/types.ts:159 |
| AIMetricsSnapshot.executionState.trendIntact | bool | Telemetri alanı: trendIntact | server/ai/types.ts:157 |
| AIMetricsSnapshot.executionState.trendStrength | raw | Telemetri alanı: trendStrength | server/ai/types.ts:156 |
| AIMetricsSnapshot.executionState.winnerRMultiple | unknown | Telemetri alanı: winnerRMultiple | server/ai/types.ts:154 |
| AIMetricsSnapshot.executionState.winnerStopArmed | bool | Telemetri alanı: winnerStopArmed | server/ai/types.ts:151 |
| AIMetricsSnapshot.executionState.winnerStopPrice | price | Telemetri alanı: winnerStopPrice | server/ai/types.ts:153 |
| AIMetricsSnapshot.executionState.winnerStopType | unknown | Telemetri alanı: winnerStopType | server/ai/types.ts:152 |
| AIMetricsSnapshot.liquidityMetrics | unknown | AI karar pipeline alani: AIMetricsSnapshot.liquidityMetrics | server/ai/types.ts:185 |
| AIMetricsSnapshot.market | unknown | AI karar pipeline alani: AIMetricsSnapshot.market | server/ai/types.ts:165 |
| AIMetricsSnapshot.market.cvdSlope | raw | Telemetri alanı: cvdSlope | server/ai/types.ts:172 |
| AIMetricsSnapshot.market.delta1s | raw | Telemetri alanı: delta1s | server/ai/types.ts:169 |
| AIMetricsSnapshot.market.delta5s | raw | Telemetri alanı: delta5s | server/ai/types.ts:170 |
| AIMetricsSnapshot.market.deltaZ | raw | Telemetri alanı: deltaZ | server/ai/types.ts:171 |
| AIMetricsSnapshot.market.obiDeep | price | Telemetri alanı: obiDeep | server/ai/types.ts:174 |
| AIMetricsSnapshot.market.obiDivergence | price | Telemetri alanı: obiDivergence | server/ai/types.ts:175 |
| AIMetricsSnapshot.market.obiWeighted | unknown | Telemetri alanı: obiWeighted | server/ai/types.ts:173 |
| AIMetricsSnapshot.market.price | price | Telemetri alanı: price | server/ai/types.ts:166 |
| AIMetricsSnapshot.market.spreadPct | pct | Telemetri alanı: spreadPct | server/ai/types.ts:168 |
| AIMetricsSnapshot.market.vwap | price | Telemetri alanı: vwap | server/ai/types.ts:167 |
| AIMetricsSnapshot.openInterest | raw | AI karar pipeline alani: AIMetricsSnapshot.openInterest | server/ai/types.ts:192 |
| AIMetricsSnapshot.openInterest.oiChangePct | pct | Telemetri alanı: oiChangePct | server/ai/types.ts:193 |
| AIMetricsSnapshot.passiveFlowMetrics | unknown | AI karar pipeline alani: AIMetricsSnapshot.passiveFlowMetrics | server/ai/types.ts:186 |
| AIMetricsSnapshot.position | unknown | AI karar pipeline alani: AIMetricsSnapshot.position | server/ai/types.ts:200 |
| AIMetricsSnapshot.position.addsUsed | unknown | Telemetri alanı: addsUsed | server/ai/types.ts:205 |
| AIMetricsSnapshot.position.entryPrice | price | Telemetri alanı: entryPrice | server/ai/types.ts:203 |
| AIMetricsSnapshot.position.qty | raw | Telemetri alanı: qty | server/ai/types.ts:202 |
| AIMetricsSnapshot.position.side | raw | Telemetri alanı: side | server/ai/types.ts:201 |
| AIMetricsSnapshot.position.timeInPositionMs | raw | Telemetri alanı: timeInPositionMs | server/ai/types.ts:206 |
| AIMetricsSnapshot.position.unrealizedPnlPct | pct | Telemetri alanı: unrealizedPnlPct | server/ai/types.ts:204 |
| AIMetricsSnapshot.regimeMetrics | unknown | AI karar pipeline alani: AIMetricsSnapshot.regimeMetrics | server/ai/types.ts:189 |
| AIMetricsSnapshot.riskState | bool | AI karar pipeline alani: AIMetricsSnapshot.riskState | server/ai/types.ts:134 |
| AIMetricsSnapshot.riskState.cooldownMsRemaining | unknown | Telemetri alanı: cooldownMsRemaining | server/ai/types.ts:141 |
| AIMetricsSnapshot.riskState.dailyLossLock | bool | Telemetri alanı: dailyLossLock | server/ai/types.ts:140 |
| AIMetricsSnapshot.riskState.drawdownPct | pct | Telemetri alanı: drawdownPct | server/ai/types.ts:139 |
| AIMetricsSnapshot.riskState.equity | unknown | Telemetri alanı: equity | server/ai/types.ts:135 |
| AIMetricsSnapshot.riskState.leverage | unknown | Telemetri alanı: leverage | server/ai/types.ts:136 |
| AIMetricsSnapshot.riskState.liquidationProximityPct | pct | Telemetri alanı: liquidationProximityPct | server/ai/types.ts:144 |
| AIMetricsSnapshot.riskState.maintenanceMarginRatio | raw | Telemetri alanı: maintenanceMarginRatio | server/ai/types.ts:143 |
| AIMetricsSnapshot.riskState.marginHealth | unknown | Telemetri alanı: marginHealth | server/ai/types.ts:142 |
| AIMetricsSnapshot.riskState.marginInUse | unknown | Telemetri alanı: marginInUse | server/ai/types.ts:138 |
| AIMetricsSnapshot.riskState.startingMarginUser | unknown | Telemetri alanı: startingMarginUser | server/ai/types.ts:137 |
| AIMetricsSnapshot.symbol | unknown | AI karar pipeline alani: AIMetricsSnapshot.symbol | server/ai/types.ts:118 |
| AIMetricsSnapshot.timestampMs | raw | AI karar pipeline alani: AIMetricsSnapshot.timestampMs | server/ai/types.ts:119 |
| AIMetricsSnapshot.toxicityMetrics | unknown | AI karar pipeline alani: AIMetricsSnapshot.toxicityMetrics | server/ai/types.ts:188 |
| AIMetricsSnapshot.trades | unknown | AI karar pipeline alani: AIMetricsSnapshot.trades | server/ai/types.ts:177 |
| AIMetricsSnapshot.trades.aggressiveBuyVolume | raw | Telemetri alanı: aggressiveBuyVolume | server/ai/types.ts:180 |
| AIMetricsSnapshot.trades.aggressiveSellVolume | raw | Telemetri alanı: aggressiveSellVolume | server/ai/types.ts:181 |
| AIMetricsSnapshot.trades.burstCount | raw | Telemetri alanı: burstCount | server/ai/types.ts:182 |
| AIMetricsSnapshot.trades.burstSide | raw | Telemetri alanı: burstSide | server/ai/types.ts:183 |
| AIMetricsSnapshot.trades.printsPerSecond | unknown | Telemetri alanı: printsPerSecond | server/ai/types.ts:178 |
| AIMetricsSnapshot.trades.tradeCount | raw | Telemetri alanı: tradeCount | server/ai/types.ts:179 |
| AIMetricsSnapshot.volatility | raw | AI karar pipeline alani: AIMetricsSnapshot.volatility | server/ai/types.ts:199 |
| AITrendStatus.ageMs | raw | AI karar pipeline alani: AITrendStatus.ageMs | server/ai/types.ts:81 |
| AITrendStatus.breakConfirm | unknown | AI karar pipeline alani: AITrendStatus.breakConfirm | server/ai/types.ts:82 |
| AITrendStatus.intact | bool | AI karar pipeline alani: AITrendStatus.intact | server/ai/types.ts:80 |
| AITrendStatus.score | raw | AI karar pipeline alani: AITrendStatus.score | server/ai/types.ts:79 |
| AITrendStatus.side | raw | AI karar pipeline alani: AITrendStatus.side | server/ai/types.ts:78 |
| AITrendStatus.source | raw | AI karar pipeline alani: AITrendStatus.source | server/ai/types.ts:83 |
| DecisionProvider.mode | unknown | AI karar pipeline alani: DecisionProvider.mode | server/ai/DecisionProvider.ts:47 |
| DecisionProviderInput.aiBiasStatus | unknown | AI karar pipeline alani: DecisionProviderInput.aiBiasStatus | server/ai/DecisionProvider.ts:8 |
| DecisionProviderInput.aiTrendStatus | raw | AI karar pipeline alani: DecisionProviderInput.aiTrendStatus | server/ai/DecisionProvider.ts:7 |
| DecisionProviderInput.decision | unknown | AI karar pipeline alani: DecisionProviderInput.decision | server/ai/DecisionProvider.ts:6 |
| DecisionProviderInput.defaultVetoReason | raw | AI karar pipeline alani: DecisionProviderInput.defaultVetoReason | server/ai/DecisionProvider.ts:10 |
| DecisionProviderInput.nowMs | raw | AI karar pipeline alani: DecisionProviderInput.nowMs | server/ai/DecisionProvider.ts:5 |
| DecisionProviderInput.strategyPosition | unknown | AI karar pipeline alani: DecisionProviderInput.strategyPosition | server/ai/DecisionProvider.ts:9 |
| DecisionProviderInput.symbol | unknown | AI karar pipeline alani: DecisionProviderInput.symbol | server/ai/DecisionProvider.ts:4 |
| DecisionView.aiBias | bool | AI karar pipeline alani: DecisionView.aiBias | server/ai/DecisionProvider.ts:22 |
| DecisionView.aiBias.breakConfirm | unknown | Telemetri alanı: breakConfirm | server/ai/DecisionProvider.ts:27 |
| DecisionView.aiBias.confidence | unknown | Telemetri alanı: confidence | server/ai/DecisionProvider.ts:24 |
| DecisionView.aiBias.lockedByPosition | bool | Telemetri alanı: lockedByPosition | server/ai/DecisionProvider.ts:26 |
| DecisionView.aiBias.reason | raw | Telemetri alanı: reason | server/ai/DecisionProvider.ts:28 |
| DecisionView.aiBias.side | raw | Telemetri alanı: side | server/ai/DecisionProvider.ts:23 |
| DecisionView.aiBias.source | raw | Telemetri alanı: source | server/ai/DecisionProvider.ts:25 |
| DecisionView.aiBias.timestampMs | raw | Telemetri alanı: timestampMs | server/ai/DecisionProvider.ts:29 |
| DecisionView.aiTrend | bool | AI karar pipeline alani: DecisionView.aiTrend | server/ai/DecisionProvider.ts:14 |
| DecisionView.aiTrend.ageMs | raw | Telemetri alanı: ageMs | server/ai/DecisionProvider.ts:18 |
| DecisionView.aiTrend.breakConfirm | unknown | Telemetri alanı: breakConfirm | server/ai/DecisionProvider.ts:19 |
| DecisionView.aiTrend.intact | bool | Telemetri alanı: intact | server/ai/DecisionProvider.ts:17 |
| DecisionView.aiTrend.score | raw | Telemetri alanı: score | server/ai/DecisionProvider.ts:16 |
| DecisionView.aiTrend.side | raw | Telemetri alanı: side | server/ai/DecisionProvider.ts:15 |
| DecisionView.aiTrend.source | raw | Telemetri alanı: source | server/ai/DecisionProvider.ts:20 |
| DecisionView.signalDisplay | bool | AI karar pipeline alani: DecisionView.signalDisplay | server/ai/DecisionProvider.ts:31 |
| DecisionView.signalDisplay.actions | unknown | Telemetri alanı: actions | server/ai/DecisionProvider.ts:39 |
| DecisionView.signalDisplay.candidate | unknown | Telemetri alanı: candidate | server/ai/DecisionProvider.ts:36 |
| DecisionView.signalDisplay.candidate.entryPrice | price | Telemetri alanı: entryPrice | server/ai/DecisionProvider.ts:36 |
| DecisionView.signalDisplay.candidate.slPrice | price | Telemetri alanı: slPrice | server/ai/DecisionProvider.ts:36 |
| DecisionView.signalDisplay.candidate.tpPrice | price | Telemetri alanı: tpPrice | server/ai/DecisionProvider.ts:36 |
| DecisionView.signalDisplay.confidence | unknown | Telemetri alanı: confidence | server/ai/DecisionProvider.ts:34 |
| DecisionView.signalDisplay.dfsPercentile | pct | Telemetri alanı: dfsPercentile | server/ai/DecisionProvider.ts:38 |
| DecisionView.signalDisplay.gatePassed | bool | Telemetri alanı: gatePassed | server/ai/DecisionProvider.ts:41 |
| DecisionView.signalDisplay.reasons | raw | Telemetri alanı: reasons | server/ai/DecisionProvider.ts:40 |
| DecisionView.signalDisplay.regime | unknown | Telemetri alanı: regime | server/ai/DecisionProvider.ts:37 |
| DecisionView.signalDisplay.score | raw | Telemetri alanı: score | server/ai/DecisionProvider.ts:33 |
| DecisionView.signalDisplay.signal | raw | Telemetri alanı: signal | server/ai/DecisionProvider.ts:32 |
| DecisionView.signalDisplay.vetoReason | raw | Telemetri alanı: vetoReason | server/ai/DecisionProvider.ts:35 |
| DecisionView.suppressDryRunPosition | bool | AI karar pipeline alani: DecisionView.suppressDryRunPosition | server/ai/DecisionProvider.ts:43 |

## 4) Internal (UI ve payload disi) hesap metrikleri

### 4.1 Internal class/interface alanlari

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| AbsorptionDetector.maxWindowMs | raw | Internal class state: AbsorptionDetector.maxWindowMs | server/metrics/AbsorptionDetector.ts:35 |
| AbsorptionDetector.minRepeats | unknown | Internal class state: AbsorptionDetector.minRepeats | server/metrics/AbsorptionDetector.ts:36 |
| AbsorptionDetector.priceThreshold | price | Internal class state: AbsorptionDetector.priceThreshold | server/metrics/AbsorptionDetector.ts:37 |
| AbsorptionDetector.state | raw | Internal class state: AbsorptionDetector.state | server/metrics/AbsorptionDetector.ts:33 |
| AdvancedMicrostructureBundle.crossMarketMetrics | unknown | Internal/interface alanı: AdvancedMicrostructureBundle.crossMarketMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:99 |
| AdvancedMicrostructureBundle.derivativesMetrics | unknown | Internal/interface alanı: AdvancedMicrostructureBundle.derivativesMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:96 |
| AdvancedMicrostructureBundle.enableCrossMarketConfirmation | bool | Internal/interface alanı: AdvancedMicrostructureBundle.enableCrossMarketConfirmation | server/metrics/AdvancedMicrostructureMetrics.ts:100 |
| AdvancedMicrostructureBundle.liquidityMetrics | unknown | Internal/interface alanı: AdvancedMicrostructureBundle.liquidityMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:94 |
| AdvancedMicrostructureBundle.passiveFlowMetrics | unknown | Internal/interface alanı: AdvancedMicrostructureBundle.passiveFlowMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:95 |
| AdvancedMicrostructureBundle.regimeMetrics | unknown | Internal/interface alanı: AdvancedMicrostructureBundle.regimeMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:98 |
| AdvancedMicrostructureBundle.toxicityMetrics | unknown | Internal/interface alanı: AdvancedMicrostructureBundle.toxicityMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:97 |
| AdvancedMicrostructureMetrics.addTimestampByPrice | raw | Internal class state: AdvancedMicrostructureMetrics.addTimestampByPrice | server/metrics/AdvancedMicrostructureMetrics.ts:210 |
| AdvancedMicrostructureMetrics.askAddWindow | price | Internal class state: AdvancedMicrostructureMetrics.askAddWindow | server/metrics/AdvancedMicrostructureMetrics.ts:201 |
| AdvancedMicrostructureMetrics.askCancelWindow | price | Internal class state: AdvancedMicrostructureMetrics.askCancelWindow | server/metrics/AdvancedMicrostructureMetrics.ts:203 |
| AdvancedMicrostructureMetrics.avgTradeQtyEwma | raw | Internal class state: AdvancedMicrostructureMetrics.avgTradeQtyEwma | server/metrics/AdvancedMicrostructureMetrics.ts:221 |
| AdvancedMicrostructureMetrics.baseQty | raw | Internal class state: AdvancedMicrostructureMetrics.baseQty | server/metrics/AdvancedMicrostructureMetrics.ts:264 |
| AdvancedMicrostructureMetrics.basisStats | raw | Internal class state: AdvancedMicrostructureMetrics.basisStats | server/metrics/AdvancedMicrostructureMetrics.ts:244 |
| AdvancedMicrostructureMetrics.betaBtcRegression | unknown | Internal class state: AdvancedMicrostructureMetrics.betaBtcRegression | server/metrics/AdvancedMicrostructureMetrics.ts:259 |
| AdvancedMicrostructureMetrics.betaEthRegression | unknown | Internal class state: AdvancedMicrostructureMetrics.betaEthRegression | server/metrics/AdvancedMicrostructureMetrics.ts:260 |
| AdvancedMicrostructureMetrics.bidAddWindow | price | Internal class state: AdvancedMicrostructureMetrics.bidAddWindow | server/metrics/AdvancedMicrostructureMetrics.ts:200 |
| AdvancedMicrostructureMetrics.bidCancelWindow | price | Internal class state: AdvancedMicrostructureMetrics.bidCancelWindow | server/metrics/AdvancedMicrostructureMetrics.ts:202 |
| AdvancedMicrostructureMetrics.burstHorizonMs | raw | Internal class state: AdvancedMicrostructureMetrics.burstHorizonMs | server/metrics/AdvancedMicrostructureMetrics.ts:277 |
| AdvancedMicrostructureMetrics.burstOutcomeStats | unknown | Internal class state: AdvancedMicrostructureMetrics.burstOutcomeStats | server/metrics/AdvancedMicrostructureMetrics.ts:233 |
| AdvancedMicrostructureMetrics.burstStreakCount | raw | Internal class state: AdvancedMicrostructureMetrics.burstStreakCount | server/metrics/AdvancedMicrostructureMetrics.ts:229 |
| AdvancedMicrostructureMetrics.burstStreakSide | raw | Internal class state: AdvancedMicrostructureMetrics.burstStreakSide | server/metrics/AdvancedMicrostructureMetrics.ts:228 |
| AdvancedMicrostructureMetrics.burstThresholdTrades | unknown | Internal class state: AdvancedMicrostructureMetrics.burstThresholdTrades | server/metrics/AdvancedMicrostructureMetrics.ts:276 |
| AdvancedMicrostructureMetrics.burstTriggeredInStreak | unknown | Internal class state: AdvancedMicrostructureMetrics.burstTriggeredInStreak | server/metrics/AdvancedMicrostructureMetrics.ts:230 |
| AdvancedMicrostructureMetrics.buyVolumeWindow | raw | Internal class state: AdvancedMicrostructureMetrics.buyVolumeWindow | server/metrics/AdvancedMicrostructureMetrics.ts:215 |
| AdvancedMicrostructureMetrics.computeCrossMarketMetrics().betaToBTC | unknown | Telemetri alanı: betaToBTC | server/metrics/AdvancedMicrostructureMetrics.ts:1090 |
| AdvancedMicrostructureMetrics.computeCrossMarketMetrics().betaToETH | unknown | Telemetri alanı: betaToETH | server/metrics/AdvancedMicrostructureMetrics.ts:1090 |
| AdvancedMicrostructureMetrics.computeCrossMarketMetrics().crossVenueImbalanceDiff | unknown | Telemetri alanı: crossVenueImbalanceDiff | server/metrics/AdvancedMicrostructureMetrics.ts:1090 |
| AdvancedMicrostructureMetrics.computeCrossMarketMetrics().spotPerpDivergence | unknown | Telemetri alanı: spotPerpDivergence | server/metrics/AdvancedMicrostructureMetrics.ts:1090 |
| AdvancedMicrostructureMetrics.crossEnabled | unknown | Internal class state: AdvancedMicrostructureMetrics.crossEnabled | server/metrics/AdvancedMicrostructureMetrics.ts:258 |
| AdvancedMicrostructureMetrics.currentPerpImbalance10 | unknown | Internal class state: AdvancedMicrostructureMetrics.currentPerpImbalance10 | server/metrics/AdvancedMicrostructureMetrics.ts:255 |
| AdvancedMicrostructureMetrics.currentTopDepthNotional10 | raw | Internal class state: AdvancedMicrostructureMetrics.currentTopDepthNotional10 | server/metrics/AdvancedMicrostructureMetrics.ts:254 |
| AdvancedMicrostructureMetrics.depthDeltaDecomposition | raw | Internal class state: AdvancedMicrostructureMetrics.depthDeltaDecomposition | server/metrics/AdvancedMicrostructureMetrics.ts:199 |
| AdvancedMicrostructureMetrics.effectiveSpreadStats | raw | Internal class state: AdvancedMicrostructureMetrics.effectiveSpreadStats | server/metrics/AdvancedMicrostructureMetrics.ts:237 |
| AdvancedMicrostructureMetrics.getMetrics().crossMarketMetrics | unknown | Telemetri alanı: crossMarketMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:486 |
| AdvancedMicrostructureMetrics.getMetrics().derivativesMetrics | unknown | Telemetri alanı: derivativesMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:483 |
| AdvancedMicrostructureMetrics.getMetrics().enableCrossMarketConfirmation | unknown | Telemetri alanı: enableCrossMarketConfirmation | server/metrics/AdvancedMicrostructureMetrics.ts:487 |
| AdvancedMicrostructureMetrics.getMetrics().liquidityMetrics | unknown | Telemetri alanı: liquidityMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:481 |
| AdvancedMicrostructureMetrics.getMetrics().passiveFlowMetrics | unknown | Telemetri alanı: passiveFlowMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:482 |
| AdvancedMicrostructureMetrics.getMetrics().regimeMetrics | unknown | Telemetri alanı: regimeMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:485 |
| AdvancedMicrostructureMetrics.getMetrics().toxicityMetrics | unknown | Telemetri alanı: toxicityMetrics | server/metrics/AdvancedMicrostructureMetrics.ts:484 |
| AdvancedMicrostructureMetrics.indexPrice | price | Internal class state: AdvancedMicrostructureMetrics.indexPrice | server/metrics/AdvancedMicrostructureMetrics.ts:247 |
| AdvancedMicrostructureMetrics.largeAddEvents | unknown | Internal class state: AdvancedMicrostructureMetrics.largeAddEvents | server/metrics/AdvancedMicrostructureMetrics.ts:208 |
| AdvancedMicrostructureMetrics.largeAddHead | unknown | Internal class state: AdvancedMicrostructureMetrics.largeAddHead | server/metrics/AdvancedMicrostructureMetrics.ts:209 |
| AdvancedMicrostructureMetrics.largeAddMultiplier | unknown | Internal class state: AdvancedMicrostructureMetrics.largeAddMultiplier | server/metrics/AdvancedMicrostructureMetrics.ts:270 |
| AdvancedMicrostructureMetrics.lastBasis | raw | Internal class state: AdvancedMicrostructureMetrics.lastBasis | server/metrics/AdvancedMicrostructureMetrics.ts:245 |
| AdvancedMicrostructureMetrics.lastDepthTotal10 | raw | Internal class state: AdvancedMicrostructureMetrics.lastDepthTotal10 | server/metrics/AdvancedMicrostructureMetrics.ts:240 |
| AdvancedMicrostructureMetrics.lastLargeTradeTs | unknown | Internal class state: AdvancedMicrostructureMetrics.lastLargeTradeTs | server/metrics/AdvancedMicrostructureMetrics.ts:250 |
| AdvancedMicrostructureMetrics.lastMidPrice | price | Internal class state: AdvancedMicrostructureMetrics.lastMidPrice | server/metrics/AdvancedMicrostructureMetrics.ts:179 |
| AdvancedMicrostructureMetrics.lastOiChangePct | pct | Internal class state: AdvancedMicrostructureMetrics.lastOiChangePct | server/metrics/AdvancedMicrostructureMetrics.ts:251 |
| AdvancedMicrostructureMetrics.lastOiUpdateTs | unknown | Internal class state: AdvancedMicrostructureMetrics.lastOiUpdateTs | server/metrics/AdvancedMicrostructureMetrics.ts:252 |
| AdvancedMicrostructureMetrics.lastTradePrice | price | Internal class state: AdvancedMicrostructureMetrics.lastTradePrice | server/metrics/AdvancedMicrostructureMetrics.ts:180 |
| AdvancedMicrostructureMetrics.latestLiquidity | unknown | Internal class state: AdvancedMicrostructureMetrics.latestLiquidity | server/metrics/AdvancedMicrostructureMetrics.ts:256 |
| AdvancedMicrostructureMetrics.latestReturn | unknown | Internal class state: AdvancedMicrostructureMetrics.latestReturn | server/metrics/AdvancedMicrostructureMetrics.ts:181 |
| AdvancedMicrostructureMetrics.liquidationHalfLifeMs | raw | Internal class state: AdvancedMicrostructureMetrics.liquidationHalfLifeMs | server/metrics/AdvancedMicrostructureMetrics.ts:282 |
| AdvancedMicrostructureMetrics.liquidationOiDropPct | pct | Internal class state: AdvancedMicrostructureMetrics.liquidationOiDropPct | server/metrics/AdvancedMicrostructureMetrics.ts:281 |
| AdvancedMicrostructureMetrics.liquidationProxyAccumulator | unknown | Internal class state: AdvancedMicrostructureMetrics.liquidationProxyAccumulator | server/metrics/AdvancedMicrostructureMetrics.ts:248 |
| AdvancedMicrostructureMetrics.liquidationProxyLastTs | unknown | Internal class state: AdvancedMicrostructureMetrics.liquidationProxyLastTs | server/metrics/AdvancedMicrostructureMetrics.ts:249 |
| AdvancedMicrostructureMetrics.liquidationWindowMs | raw | Internal class state: AdvancedMicrostructureMetrics.liquidationWindowMs | server/metrics/AdvancedMicrostructureMetrics.ts:280 |
| AdvancedMicrostructureMetrics.markPrice | price | Internal class state: AdvancedMicrostructureMetrics.markPrice | server/metrics/AdvancedMicrostructureMetrics.ts:246 |
| AdvancedMicrostructureMetrics.microAtr | price | Internal class state: AdvancedMicrostructureMetrics.microAtr | server/metrics/AdvancedMicrostructureMetrics.ts:187 |
| AdvancedMicrostructureMetrics.microAtrAlpha | price | Internal class state: AdvancedMicrostructureMetrics.microAtrAlpha | server/metrics/AdvancedMicrostructureMetrics.ts:188 |
| AdvancedMicrostructureMetrics.midHead | price | Internal class state: AdvancedMicrostructureMetrics.midHead | server/metrics/AdvancedMicrostructureMetrics.ts:193 |
| AdvancedMicrostructureMetrics.midHistory | price | Internal class state: AdvancedMicrostructureMetrics.midHistory | server/metrics/AdvancedMicrostructureMetrics.ts:192 |
| AdvancedMicrostructureMetrics.minLargeTradeNotional | raw | Internal class state: AdvancedMicrostructureMetrics.minLargeTradeNotional | server/metrics/AdvancedMicrostructureMetrics.ts:271 |
| AdvancedMicrostructureMetrics.pendingBurstHead | unknown | Internal class state: AdvancedMicrostructureMetrics.pendingBurstHead | server/metrics/AdvancedMicrostructureMetrics.ts:232 |
| AdvancedMicrostructureMetrics.pendingBursts | unknown | Internal class state: AdvancedMicrostructureMetrics.pendingBursts | server/metrics/AdvancedMicrostructureMetrics.ts:231 |
| AdvancedMicrostructureMetrics.pendingRealizedHead | unknown | Internal class state: AdvancedMicrostructureMetrics.pendingRealizedHead | server/metrics/AdvancedMicrostructureMetrics.ts:236 |
| AdvancedMicrostructureMetrics.pendingRealizedSpreads | raw | Internal class state: AdvancedMicrostructureMetrics.pendingRealizedSpreads | server/metrics/AdvancedMicrostructureMetrics.ts:235 |
| AdvancedMicrostructureMetrics.pendingResiliency | unknown | Internal class state: AdvancedMicrostructureMetrics.pendingResiliency | server/metrics/AdvancedMicrostructureMetrics.ts:241 |
| AdvancedMicrostructureMetrics.prevAsks | price | Internal class state: AdvancedMicrostructureMetrics.prevAsks | server/metrics/AdvancedMicrostructureMetrics.ts:196 |
| AdvancedMicrostructureMetrics.prevBids | price | Internal class state: AdvancedMicrostructureMetrics.prevBids | server/metrics/AdvancedMicrostructureMetrics.ts:195 |
| AdvancedMicrostructureMetrics.queueDeltaBestAsk | price | Internal class state: AdvancedMicrostructureMetrics.queueDeltaBestAsk | server/metrics/AdvancedMicrostructureMetrics.ts:198 |
| AdvancedMicrostructureMetrics.queueDeltaBestBid | price | Internal class state: AdvancedMicrostructureMetrics.queueDeltaBestBid | server/metrics/AdvancedMicrostructureMetrics.ts:197 |
| AdvancedMicrostructureMetrics.realizedSpreadDelayMs | raw | Internal class state: AdvancedMicrostructureMetrics.realizedSpreadDelayMs | server/metrics/AdvancedMicrostructureMetrics.ts:275 |
| AdvancedMicrostructureMetrics.realizedSpreadStats | raw | Internal class state: AdvancedMicrostructureMetrics.realizedSpreadStats | server/metrics/AdvancedMicrostructureMetrics.ts:238 |
| AdvancedMicrostructureMetrics.recentAggHead | unknown | Internal class state: AdvancedMicrostructureMetrics.recentAggHead | server/metrics/AdvancedMicrostructureMetrics.ts:213 |
| AdvancedMicrostructureMetrics.recentAggTrades | unknown | Internal class state: AdvancedMicrostructureMetrics.recentAggTrades | server/metrics/AdvancedMicrostructureMetrics.ts:212 |
| AdvancedMicrostructureMetrics.refreshEvents | unknown | Internal class state: AdvancedMicrostructureMetrics.refreshEvents | server/metrics/AdvancedMicrostructureMetrics.ts:204 |
| AdvancedMicrostructureMetrics.refreshWindowMs | raw | Internal class state: AdvancedMicrostructureMetrics.refreshWindowMs | server/metrics/AdvancedMicrostructureMetrics.ts:267 |
| AdvancedMicrostructureMetrics.resiliencyStats | unknown | Internal class state: AdvancedMicrostructureMetrics.resiliencyStats | server/metrics/AdvancedMicrostructureMetrics.ts:242 |
| AdvancedMicrostructureMetrics.ret15mStats | unknown | Internal class state: AdvancedMicrostructureMetrics.ret15mStats | server/metrics/AdvancedMicrostructureMetrics.ts:185 |
| AdvancedMicrostructureMetrics.ret1mStats | unknown | Internal class state: AdvancedMicrostructureMetrics.ret1mStats | server/metrics/AdvancedMicrostructureMetrics.ts:183 |
| AdvancedMicrostructureMetrics.ret5mStats | unknown | Internal class state: AdvancedMicrostructureMetrics.ret5mStats | server/metrics/AdvancedMicrostructureMetrics.ts:184 |
| AdvancedMicrostructureMetrics.returnEvents | unknown | Internal class state: AdvancedMicrostructureMetrics.returnEvents | server/metrics/AdvancedMicrostructureMetrics.ts:190 |
| AdvancedMicrostructureMetrics.returnHead | unknown | Internal class state: AdvancedMicrostructureMetrics.returnHead | server/metrics/AdvancedMicrostructureMetrics.ts:191 |
| AdvancedMicrostructureMetrics.sellVolumeWindow | raw | Internal class state: AdvancedMicrostructureMetrics.sellVolumeWindow | server/metrics/AdvancedMicrostructureMetrics.ts:216 |
| AdvancedMicrostructureMetrics.signedNotionalWindow | raw | Internal class state: AdvancedMicrostructureMetrics.signedNotionalWindow | server/metrics/AdvancedMicrostructureMetrics.ts:217 |
| AdvancedMicrostructureMetrics.spoofAccumulator | unknown | Internal class state: AdvancedMicrostructureMetrics.spoofAccumulator | server/metrics/AdvancedMicrostructureMetrics.ts:206 |
| AdvancedMicrostructureMetrics.spoofHalfLifeMs | raw | Internal class state: AdvancedMicrostructureMetrics.spoofHalfLifeMs | server/metrics/AdvancedMicrostructureMetrics.ts:266 |
| AdvancedMicrostructureMetrics.spoofLastUpdateTs | unknown | Internal class state: AdvancedMicrostructureMetrics.spoofLastUpdateTs | server/metrics/AdvancedMicrostructureMetrics.ts:207 |
| AdvancedMicrostructureMetrics.spoofWindowMs | raw | Internal class state: AdvancedMicrostructureMetrics.spoofWindowMs | server/metrics/AdvancedMicrostructureMetrics.ts:265 |
| AdvancedMicrostructureMetrics.spotImbalance10 | unknown | Internal class state: AdvancedMicrostructureMetrics.spotImbalance10 | server/metrics/AdvancedMicrostructureMetrics.ts:262 |
| AdvancedMicrostructureMetrics.spotMidPrice | price | Internal class state: AdvancedMicrostructureMetrics.spotMidPrice | server/metrics/AdvancedMicrostructureMetrics.ts:261 |
| AdvancedMicrostructureMetrics.sweepDropPct | pct | Internal class state: AdvancedMicrostructureMetrics.sweepDropPct | server/metrics/AdvancedMicrostructureMetrics.ts:272 |
| AdvancedMicrostructureMetrics.sweepMaxMs | raw | Internal class state: AdvancedMicrostructureMetrics.sweepMaxMs | server/metrics/AdvancedMicrostructureMetrics.ts:274 |
| AdvancedMicrostructureMetrics.sweepRecoveryRatio | raw | Internal class state: AdvancedMicrostructureMetrics.sweepRecoveryRatio | server/metrics/AdvancedMicrostructureMetrics.ts:273 |
| AdvancedMicrostructureMetrics.tradedNotionalWindow | raw | Internal class state: AdvancedMicrostructureMetrics.tradedNotionalWindow | server/metrics/AdvancedMicrostructureMetrics.ts:218 |
| AdvancedMicrostructureMetrics.tradeNotionalStats | raw | Internal class state: AdvancedMicrostructureMetrics.tradeNotionalStats | server/metrics/AdvancedMicrostructureMetrics.ts:219 |
| AdvancedMicrostructureMetrics.tradeRelatedPriceTolerancePct | pct | Internal class state: AdvancedMicrostructureMetrics.tradeRelatedPriceTolerancePct | server/metrics/AdvancedMicrostructureMetrics.ts:269 |
| AdvancedMicrostructureMetrics.tradeRelatedWindowMs | raw | Internal class state: AdvancedMicrostructureMetrics.tradeRelatedWindowMs | server/metrics/AdvancedMicrostructureMetrics.ts:268 |
| AdvancedMicrostructureMetrics.volOfVolStats | raw | Internal class state: AdvancedMicrostructureMetrics.volOfVolStats | server/metrics/AdvancedMicrostructureMetrics.ts:186 |
| AdvancedMicrostructureMetrics.vpinBuckets | unknown | Internal class state: AdvancedMicrostructureMetrics.vpinBuckets | server/metrics/AdvancedMicrostructureMetrics.ts:222 |
| AdvancedMicrostructureMetrics.vpinCurrentBuy | unknown | Internal class state: AdvancedMicrostructureMetrics.vpinCurrentBuy | server/metrics/AdvancedMicrostructureMetrics.ts:224 |
| AdvancedMicrostructureMetrics.vpinCurrentSell | unknown | Internal class state: AdvancedMicrostructureMetrics.vpinCurrentSell | server/metrics/AdvancedMicrostructureMetrics.ts:225 |
| AdvancedMicrostructureMetrics.vpinCurrentVolume | raw | Internal class state: AdvancedMicrostructureMetrics.vpinCurrentVolume | server/metrics/AdvancedMicrostructureMetrics.ts:226 |
| AdvancedMicrostructureMetrics.vpinHead | unknown | Internal class state: AdvancedMicrostructureMetrics.vpinHead | server/metrics/AdvancedMicrostructureMetrics.ts:223 |
| AdvancedMicrostructureMetrics.vpinTargetMultiplier | unknown | Internal class state: AdvancedMicrostructureMetrics.vpinTargetMultiplier | server/metrics/AdvancedMicrostructureMetrics.ts:278 |
| AdvancedMicrostructureMetrics.vpinWindowMs | raw | Internal class state: AdvancedMicrostructureMetrics.vpinWindowMs | server/metrics/AdvancedMicrostructureMetrics.ts:279 |
| BufferedDepthUpdate.a | unknown | Internal/interface alanı: BufferedDepthUpdate.a | server/metrics/OrderbookManager.ts:24 |
| BufferedDepthUpdate.b | unknown | Internal/interface alanı: BufferedDepthUpdate.b | server/metrics/OrderbookManager.ts:23 |
| BufferedDepthUpdate.eventTimeMs | raw | Internal/interface alanı: BufferedDepthUpdate.eventTimeMs | server/metrics/OrderbookManager.ts:25 |
| BufferedDepthUpdate.pu | unknown | Internal/interface alanı: BufferedDepthUpdate.pu | server/metrics/OrderbookManager.ts:22 |
| BufferedDepthUpdate.receiptTimeMs | raw | Internal/interface alanı: BufferedDepthUpdate.receiptTimeMs | server/metrics/OrderbookManager.ts:26 |
| BufferedDepthUpdate.u | unknown | Internal/interface alanı: BufferedDepthUpdate.u | server/metrics/OrderbookManager.ts:21 |
| BufferedDepthUpdate.U | unknown | Internal/interface alanı: BufferedDepthUpdate.U | server/metrics/OrderbookManager.ts:20 |
| CrossMarketMetrics.betaToBTC | unknown | Internal/interface alanı: CrossMarketMetrics.betaToBTC | server/metrics/AdvancedMicrostructureMetrics.ts:88 |
| CrossMarketMetrics.betaToETH | unknown | Internal/interface alanı: CrossMarketMetrics.betaToETH | server/metrics/AdvancedMicrostructureMetrics.ts:89 |
| CrossMarketMetrics.crossVenueImbalanceDiff | unknown | Internal/interface alanı: CrossMarketMetrics.crossVenueImbalanceDiff | server/metrics/AdvancedMicrostructureMetrics.ts:90 |
| CrossMarketMetrics.spotPerpDivergence | unknown | Internal/interface alanı: CrossMarketMetrics.spotPerpDivergence | server/metrics/AdvancedMicrostructureMetrics.ts:87 |
| CrossMarketReferenceInput.btcReturn | unknown | Internal/interface alanı: CrossMarketReferenceInput.btcReturn | server/metrics/AdvancedMicrostructureMetrics.ts:138 |
| CrossMarketReferenceInput.enableCrossMarketConfirmation | bool | Internal/interface alanı: CrossMarketReferenceInput.enableCrossMarketConfirmation | server/metrics/AdvancedMicrostructureMetrics.ts:137 |
| CrossMarketReferenceInput.ethReturn | unknown | Internal/interface alanı: CrossMarketReferenceInput.ethReturn | server/metrics/AdvancedMicrostructureMetrics.ts:139 |
| CrossMarketReferenceInput.spotReference | unknown | Internal/interface alanı: CrossMarketReferenceInput.spotReference | server/metrics/AdvancedMicrostructureMetrics.ts:140 |
| CrossMarketReferenceInput.timestampMs | raw | Internal/interface alanı: CrossMarketReferenceInput.timestampMs | server/metrics/AdvancedMicrostructureMetrics.ts:136 |
| CvdCalculator.stores | unknown | Internal class state: CvdCalculator.stores | server/metrics/CvdCalculator.ts:31 |
| CvdMetrics.cvd | unknown | Internal/interface alanı: CvdMetrics.cvd | server/metrics/CvdCalculator.ts:15 |
| CvdMetrics.delta | raw | Internal/interface alanı: CvdMetrics.delta | server/metrics/CvdCalculator.ts:16 |
| CvdMetrics.timeframe | unknown | Internal/interface alanı: CvdMetrics.timeframe | server/metrics/CvdCalculator.ts:14 |
| DepthApplyResult.applied | bool | Internal/interface alanı: DepthApplyResult.applied | server/metrics/OrderbookManager.ts:55 |
| DepthApplyResult.buffered | bool | Internal/interface alanı: DepthApplyResult.buffered | server/metrics/OrderbookManager.ts:57 |
| DepthApplyResult.dropped | bool | Internal/interface alanı: DepthApplyResult.dropped | server/metrics/OrderbookManager.ts:56 |
| DepthApplyResult.gapDetected | bool | Internal/interface alanı: DepthApplyResult.gapDetected | server/metrics/OrderbookManager.ts:58 |
| DepthApplyResult.ok | bool | Internal/interface alanı: DepthApplyResult.ok | server/metrics/OrderbookManager.ts:54 |
| DepthCache.asks | price | Internal/interface alanı: DepthCache.asks | server/metrics/OrderbookManager.ts:8 |
| DepthCache.bids | price | Internal/interface alanı: DepthCache.bids | server/metrics/OrderbookManager.ts:7 |
| DepthCache.lastUpdateId | unknown | Internal/interface alanı: DepthCache.lastUpdateId | server/metrics/OrderbookManager.ts:6 |
| DepthSnapshotInput.asks | price | Internal/interface alanı: DepthSnapshotInput.asks | server/metrics/AdvancedMicrostructureMetrics.ts:106 |
| DepthSnapshotInput.bids | price | Internal/interface alanı: DepthSnapshotInput.bids | server/metrics/AdvancedMicrostructureMetrics.ts:105 |
| DepthSnapshotInput.timestampMs | raw | Internal/interface alanı: DepthSnapshotInput.timestampMs | server/metrics/AdvancedMicrostructureMetrics.ts:104 |
| DerivativesMetrics.indexLastDeviationPct | pct | Internal/interface alanı: DerivativesMetrics.indexLastDeviationPct | server/metrics/AdvancedMicrostructureMetrics.ts:62 |
| DerivativesMetrics.liquidationProxyScore | raw | Internal/interface alanı: DerivativesMetrics.liquidationProxyScore | server/metrics/AdvancedMicrostructureMetrics.ts:65 |
| DerivativesMetrics.markLastDeviationPct | pct | Internal/interface alanı: DerivativesMetrics.markLastDeviationPct | server/metrics/AdvancedMicrostructureMetrics.ts:61 |
| DerivativesMetrics.perpBasis | raw | Internal/interface alanı: DerivativesMetrics.perpBasis | server/metrics/AdvancedMicrostructureMetrics.ts:63 |
| DerivativesMetrics.perpBasisZScore | raw | Internal/interface alanı: DerivativesMetrics.perpBasisZScore | server/metrics/AdvancedMicrostructureMetrics.ts:64 |
| DerivativesSnapshotInput.funding | unknown | Internal/interface alanı: DerivativesSnapshotInput.funding | server/metrics/AdvancedMicrostructureMetrics.ts:119 |
| DerivativesSnapshotInput.lastPrice | price | Internal/interface alanı: DerivativesSnapshotInput.lastPrice | server/metrics/AdvancedMicrostructureMetrics.ts:126 |
| DerivativesSnapshotInput.openInterest | raw | Internal/interface alanı: DerivativesSnapshotInput.openInterest | server/metrics/AdvancedMicrostructureMetrics.ts:120 |
| DerivativesSnapshotInput.timestampMs | raw | Internal/interface alanı: DerivativesSnapshotInput.timestampMs | server/metrics/AdvancedMicrostructureMetrics.ts:118 |
| DetectionState.bookSizes | unknown | Internal/interface alanı: DetectionState.bookSizes | server/metrics/AbsorptionDetector.ts:28 |
| DetectionState.firstPrice | price | Internal/interface alanı: DetectionState.firstPrice | server/metrics/AbsorptionDetector.ts:26 |
| DetectionState.lastPrice | price | Internal/interface alanı: DetectionState.lastPrice | server/metrics/AbsorptionDetector.ts:27 |
| DetectionState.lastUpdate | unknown | Internal/interface alanı: DetectionState.lastUpdate | server/metrics/AbsorptionDetector.ts:29 |
| DetectionState.price | price | Internal/interface alanı: DetectionState.price | server/metrics/AbsorptionDetector.ts:23 |
| DetectionState.repeatedCount | raw | Internal/interface alanı: DetectionState.repeatedCount | server/metrics/AbsorptionDetector.ts:25 |
| DetectionState.side | raw | Internal/interface alanı: DetectionState.side | server/metrics/AbsorptionDetector.ts:24 |
| DrawdownClusteringReport.averageDrawdownDuration | raw | Internal/interface alanı: DrawdownClusteringReport.averageDrawdownDuration | server/metrics/PortfolioMetrics.ts:10 |
| DrawdownClusteringReport.drawdownCount | raw | Internal/interface alanı: DrawdownClusteringReport.drawdownCount | server/metrics/PortfolioMetrics.ts:11 |
| DrawdownClusteringReport.maxDrawdown | unknown | Internal/interface alanı: DrawdownClusteringReport.maxDrawdown | server/metrics/PortfolioMetrics.ts:9 |
| ExecutionLog.filledPrice | price | Internal/interface alanı: ExecutionLog.filledPrice | server/metrics/ExecutionMetrics.ts:4 |
| ExecutionLog.quantity | unknown | Internal/interface alanı: ExecutionLog.quantity | server/metrics/ExecutionMetrics.ts:5 |
| ExecutionLog.requestedPrice | price | Internal/interface alanı: ExecutionLog.requestedPrice | server/metrics/ExecutionMetrics.ts:3 |
| ExecutionLog.side | raw | Internal/interface alanı: ExecutionLog.side | server/metrics/ExecutionMetrics.ts:2 |
| ExecutionLog.spreadBps | bps | Internal/interface alanı: ExecutionLog.spreadBps | server/metrics/ExecutionMetrics.ts:6 |
| FeeImpactReport.feeToGrossProfitRatio | raw | Internal/interface alanı: FeeImpactReport.feeToGrossProfitRatio | server/metrics/TradeMetrics.ts:27 |
| FeeImpactReport.grossProfit | unknown | Internal/interface alanı: FeeImpactReport.grossProfit | server/metrics/TradeMetrics.ts:25 |
| FeeImpactReport.netProfit | unknown | Internal/interface alanı: FeeImpactReport.netProfit | server/metrics/TradeMetrics.ts:26 |
| FeeImpactReport.totalFees | unknown | Internal/interface alanı: FeeImpactReport.totalFees | server/metrics/TradeMetrics.ts:24 |
| FlipFrequencyReport.flips | unknown | Internal/interface alanı: FlipFrequencyReport.flips | server/metrics/TradeMetrics.ts:31 |
| FlipFrequencyReport.flipsPerDay | unknown | Internal/interface alanı: FlipFrequencyReport.flipsPerDay | server/metrics/TradeMetrics.ts:33 |
| FlipFrequencyReport.flipsPerTrade | unknown | Internal/interface alanı: FlipFrequencyReport.flipsPerTrade | server/metrics/TradeMetrics.ts:32 |
| FundingMetrics.indexPrice | price | Internal/interface alanı: FundingMetrics.indexPrice | server/metrics/FundingMonitor.ts:17 |
| FundingMetrics.markPrice | price | Internal/interface alanı: FundingMetrics.markPrice | server/metrics/FundingMonitor.ts:16 |
| FundingMetrics.rate | unknown | Internal/interface alanı: FundingMetrics.rate | server/metrics/FundingMonitor.ts:12 |
| FundingMetrics.source | raw | Internal/interface alanı: FundingMetrics.source | server/metrics/FundingMonitor.ts:15 |
| FundingMetrics.symbol | unknown | Internal/interface alanı: FundingMetrics.symbol | server/metrics/FundingMonitor.ts:11 |
| FundingMetrics.timeToFundingMs | raw | Internal/interface alanı: FundingMetrics.timeToFundingMs | server/metrics/FundingMonitor.ts:13 |
| FundingMetrics.trend | raw | Internal/interface alanı: FundingMetrics.trend | server/metrics/FundingMonitor.ts:14 |
| FundingMonitor.intervalMs | raw | Internal class state: FundingMonitor.intervalMs | server/metrics/FundingMonitor.ts:26 |
| FundingMonitor.lastRate | unknown | Internal class state: FundingMonitor.lastRate | server/metrics/FundingMonitor.ts:23 |
| FundingMonitor.listeners | unknown | Internal class state: FundingMonitor.listeners | server/metrics/FundingMonitor.ts:24 |
| FundingMonitor.symbol | unknown | Internal class state: FundingMonitor.symbol | server/metrics/FundingMonitor.ts:25 |
| FundingMonitor.timer | unknown | Internal class state: FundingMonitor.timer | server/metrics/FundingMonitor.ts:29 |
| FundingRateInfo.fundingRate | unknown | Internal/interface alanı: FundingRateInfo.fundingRate | server/metrics/FundingRateMonitor.ts:3 |
| FundingRateInfo.fundingTime | unknown | Internal/interface alanı: FundingRateInfo.fundingTime | server/metrics/FundingRateMonitor.ts:4 |
| FundingRateInfo.nextFundingTime | unknown | Internal/interface alanı: FundingRateInfo.nextFundingTime | server/metrics/FundingRateMonitor.ts:5 |
| FundingRateInfo.symbol | unknown | Internal/interface alanı: FundingRateInfo.symbol | server/metrics/FundingRateMonitor.ts:2 |
| FundingRateMonitor.fundingRates | unknown | Internal class state: FundingRateMonitor.fundingRates | server/metrics/FundingRateMonitor.ts:9 |
| HtfFrameMetrics.atr | price | Internal/interface alanı: HtfFrameMetrics.atr | server/metrics/HtfStructureMonitor.ts:13 |
| HtfFrameMetrics.barStartMs | raw | Internal/interface alanı: HtfFrameMetrics.barStartMs | server/metrics/HtfStructureMonitor.ts:11 |
| HtfFrameMetrics.close | price | Internal/interface alanı: HtfFrameMetrics.close | server/metrics/HtfStructureMonitor.ts:12 |
| HtfFrameMetrics.lastSwingHigh | price | Internal/interface alanı: HtfFrameMetrics.lastSwingHigh | server/metrics/HtfStructureMonitor.ts:14 |
| HtfFrameMetrics.lastSwingLow | price | Internal/interface alanı: HtfFrameMetrics.lastSwingLow | server/metrics/HtfStructureMonitor.ts:15 |
| HtfFrameMetrics.structureBreakDn | bool | Internal/interface alanı: HtfFrameMetrics.structureBreakDn | server/metrics/HtfStructureMonitor.ts:17 |
| HtfFrameMetrics.structureBreakUp | bool | Internal/interface alanı: HtfFrameMetrics.structureBreakUp | server/metrics/HtfStructureMonitor.ts:16 |
| HtfSnapshot.h1 | unknown | Internal/interface alanı: HtfSnapshot.h1 | server/metrics/HtfStructureMonitor.ts:21 |
| HtfSnapshot.h4 | unknown | Internal/interface alanı: HtfSnapshot.h4 | server/metrics/HtfStructureMonitor.ts:22 |
| HtfStructureMonitor.config | unknown | Internal class state: HtfStructureMonitor.config | server/metrics/HtfStructureMonitor.ts:143 |
| HtfStructureMonitor.getSnapshot().h1 | unknown | Telemetri alanı: h1 | server/metrics/HtfStructureMonitor.ts:176 |
| HtfStructureMonitor.getSnapshot().h4 | unknown | Telemetri alanı: h4 | server/metrics/HtfStructureMonitor.ts:177 |
| HtfStructureMonitor.inFlight | unknown | Internal class state: HtfStructureMonitor.inFlight | server/metrics/HtfStructureMonitor.ts:145 |
| HtfStructureMonitor.metrics | unknown | Internal class state: HtfStructureMonitor.metrics | server/metrics/HtfStructureMonitor.ts:146 |
| HtfStructureMonitor.timer | unknown | Internal class state: HtfStructureMonitor.timer | server/metrics/HtfStructureMonitor.ts:144 |
| KlinePoint.close | price | Internal/interface alanı: KlinePoint.close | server/metrics/HtfStructureMonitor.ts:7 |
| KlinePoint.high | unknown | Internal/interface alanı: KlinePoint.high | server/metrics/HtfStructureMonitor.ts:5 |
| KlinePoint.low | unknown | Internal/interface alanı: KlinePoint.low | server/metrics/HtfStructureMonitor.ts:6 |
| KlinePoint.openTimeMs | raw | Internal/interface alanı: KlinePoint.openTimeMs | server/metrics/HtfStructureMonitor.ts:4 |
| LatencySnapshot.stages | unknown | Internal/interface alanı: LatencySnapshot.stages | server/metrics/LatencyTracker.ts:10 |
| LatencySnapshot.updatedAt | raw | Internal/interface alanı: LatencySnapshot.updatedAt | server/metrics/LatencyTracker.ts:9 |
| LatencyStats.avgMs | raw | Internal/interface alanı: LatencyStats.avgMs | server/metrics/LatencyTracker.ts:2 |
| LatencyStats.maxMs | raw | Internal/interface alanı: LatencyStats.maxMs | server/metrics/LatencyTracker.ts:4 |
| LatencyStats.p95Ms | raw | Internal/interface alanı: LatencyStats.p95Ms | server/metrics/LatencyTracker.ts:3 |
| LatencyStats.samples | unknown | Internal/interface alanı: LatencyStats.samples | server/metrics/LatencyTracker.ts:5 |
| LatencyTracker.samples | unknown | Internal class state: LatencyTracker.samples | server/metrics/LatencyTracker.ts:21 |
| LatencyTracker.snapshot().stages | unknown | Telemetri alanı: stages | server/metrics/LatencyTracker.ts:52 |
| LatencyTracker.snapshot().updatedAt | raw | Telemetri alanı: updatedAt | server/metrics/LatencyTracker.ts:51 |
| LatencyTracker.windowSize | unknown | Internal class state: LatencyTracker.windowSize | server/metrics/LatencyTracker.ts:22 |
| LegacyCalculator.computeMetrics().cvdSession | unknown | Telemetri alanı: cvdSession | server/metrics/LegacyCalculator.ts:245 |
| LegacyCalculator.computeMetrics().cvdSlope | raw | Telemetri alanı: cvdSlope | server/metrics/LegacyCalculator.ts:246 |
| LegacyCalculator.computeMetrics().delta1s | raw | Telemetri alanı: delta1s | server/metrics/LegacyCalculator.ts:242 |
| LegacyCalculator.computeMetrics().delta5s | raw | Telemetri alanı: delta5s | server/metrics/LegacyCalculator.ts:243 |
| LegacyCalculator.computeMetrics().deltaZ | raw | Telemetri alanı: deltaZ | server/metrics/LegacyCalculator.ts:244 |
| LegacyCalculator.computeMetrics().obiDeep | price | Telemetri alanı: obiDeep | server/metrics/LegacyCalculator.ts:240 |
| LegacyCalculator.computeMetrics().obiDivergence | price | Telemetri alanı: obiDivergence | server/metrics/LegacyCalculator.ts:241 |
| LegacyCalculator.computeMetrics().obiWeighted | unknown | Telemetri alanı: obiWeighted | server/metrics/LegacyCalculator.ts:239 |
| LegacyCalculator.computeMetrics().price | price | Telemetri alanı: price | server/metrics/LegacyCalculator.ts:238 |
| LegacyCalculator.computeMetrics().totalNotional | raw | Telemetri alanı: totalNotional | server/metrics/LegacyCalculator.ts:249 |
| LegacyCalculator.computeMetrics().totalVolume | raw | Telemetri alanı: totalVolume | server/metrics/LegacyCalculator.ts:248 |
| LegacyCalculator.computeMetrics().tradeCount | raw | Telemetri alanı: tradeCount | server/metrics/LegacyCalculator.ts:250 |
| LegacyCalculator.computeMetrics().vwap | price | Telemetri alanı: vwap | server/metrics/LegacyCalculator.ts:247 |
| LegacyCalculator.cvdHistory | unknown | Internal class state: LegacyCalculator.cvdHistory | server/metrics/LegacyCalculator.ts:65 |
| LegacyCalculator.cvdSession | unknown | Internal class state: LegacyCalculator.cvdSession | server/metrics/LegacyCalculator.ts:66 |
| LegacyCalculator.deltaHistory | raw | Internal class state: LegacyCalculator.deltaHistory | server/metrics/LegacyCalculator.ts:63 |
| LegacyCalculator.lastMidPrice | price | Internal class state: LegacyCalculator.lastMidPrice | server/metrics/LegacyCalculator.ts:73 |
| LegacyCalculator.oiMonitor | unknown | Internal class state: LegacyCalculator.oiMonitor | server/metrics/LegacyCalculator.ts:44 |
| LegacyCalculator.sessionVwapTracker | price | Internal class state: LegacyCalculator.sessionVwapTracker | server/metrics/LegacyCalculator.ts:45 |
| LegacyCalculator.totalNotional | raw | Internal class state: LegacyCalculator.totalNotional | server/metrics/LegacyCalculator.ts:68 |
| LegacyCalculator.totalVolume | raw | Internal class state: LegacyCalculator.totalVolume | server/metrics/LegacyCalculator.ts:67 |
| LegacyCalculator.trades | unknown | Internal class state: LegacyCalculator.trades | server/metrics/LegacyCalculator.ts:42 |
| LegacyCalculator.tradesHead | unknown | Internal class state: LegacyCalculator.tradesHead | server/metrics/LegacyCalculator.ts:43 |
| LegacyCalculator.volatilityHistory | raw | Internal class state: LegacyCalculator.volatilityHistory | server/metrics/LegacyCalculator.ts:71 |
| LegacyCalculator.volumeHistory | raw | Internal class state: LegacyCalculator.volumeHistory | server/metrics/LegacyCalculator.ts:72 |
| LegacyTrade.price | price | Internal/interface alanı: LegacyTrade.price | server/metrics/LegacyCalculator.ts:9 |
| LegacyTrade.quantity | unknown | Internal/interface alanı: LegacyTrade.quantity | server/metrics/LegacyCalculator.ts:10 |
| LegacyTrade.side | raw | Internal/interface alanı: LegacyTrade.side | server/metrics/LegacyCalculator.ts:11 |
| LegacyTrade.timestamp | raw | Internal/interface alanı: LegacyTrade.timestamp | server/metrics/LegacyCalculator.ts:12 |
| LiquidityMetrics.bookConvexity | unknown | Internal/interface alanı: LiquidityMetrics.bookConvexity | server/metrics/AdvancedMicrostructureMetrics.ts:33 |
| LiquidityMetrics.bookSlopeAsk | price | Internal/interface alanı: LiquidityMetrics.bookSlopeAsk | server/metrics/AdvancedMicrostructureMetrics.ts:32 |
| LiquidityMetrics.bookSlopeBid | price | Internal/interface alanı: LiquidityMetrics.bookSlopeBid | server/metrics/AdvancedMicrostructureMetrics.ts:31 |
| LiquidityMetrics.effectiveSpread | raw | Internal/interface alanı: LiquidityMetrics.effectiveSpread | server/metrics/AdvancedMicrostructureMetrics.ts:39 |
| LiquidityMetrics.expectedSlippageBuy | unknown | Internal/interface alanı: LiquidityMetrics.expectedSlippageBuy | server/metrics/AdvancedMicrostructureMetrics.ts:36 |
| LiquidityMetrics.expectedSlippageSell | unknown | Internal/interface alanı: LiquidityMetrics.expectedSlippageSell | server/metrics/AdvancedMicrostructureMetrics.ts:37 |
| LiquidityMetrics.imbalanceCurve | unknown | Internal/interface alanı: LiquidityMetrics.imbalanceCurve | server/metrics/AdvancedMicrostructureMetrics.ts:24 |
| LiquidityMetrics.liquidityWallScore | raw | Internal/interface alanı: LiquidityMetrics.liquidityWallScore | server/metrics/AdvancedMicrostructureMetrics.ts:34 |
| LiquidityMetrics.microPrice | price | Internal/interface alanı: LiquidityMetrics.microPrice | server/metrics/AdvancedMicrostructureMetrics.ts:23 |
| LiquidityMetrics.realizedSpreadShortWindow | raw | Internal/interface alanı: LiquidityMetrics.realizedSpreadShortWindow | server/metrics/AdvancedMicrostructureMetrics.ts:40 |
| LiquidityMetrics.resiliencyMs | raw | Internal/interface alanı: LiquidityMetrics.resiliencyMs | server/metrics/AdvancedMicrostructureMetrics.ts:38 |
| LiquidityMetrics.voidGapScore | raw | Internal/interface alanı: LiquidityMetrics.voidGapScore | server/metrics/AdvancedMicrostructureMetrics.ts:35 |
| MaeMfeReport.maePct | pct | Internal/interface alanı: MaeMfeReport.maePct | server/metrics/TradeMetrics.ts:37 |
| MaeMfeReport.mfePct | pct | Internal/interface alanı: MaeMfeReport.mfePct | server/metrics/TradeMetrics.ts:38 |
| MonitorConfig.atrPeriod | price | Internal/interface alanı: MonitorConfig.atrPeriod | server/metrics/HtfStructureMonitor.ts:28 |
| MonitorConfig.barsLimit | unknown | Internal/interface alanı: MonitorConfig.barsLimit | server/metrics/HtfStructureMonitor.ts:27 |
| MonitorConfig.intervalMs | raw | Internal/interface alanı: MonitorConfig.intervalMs | server/metrics/HtfStructureMonitor.ts:26 |
| MonitorConfig.swingLookback | price | Internal/interface alanı: MonitorConfig.swingLookback | server/metrics/HtfStructureMonitor.ts:29 |
| OICalculator.lastPollTs | unknown | Internal class state: OICalculator.lastPollTs | server/metrics/OICalculator.ts:20 |
| OICalculator.metrics | unknown | Internal class state: OICalculator.metrics | server/metrics/OICalculator.ts:12 |
| OICalculator.restBaseUrl | unknown | Internal class state: OICalculator.restBaseUrl | server/metrics/OICalculator.ts:11 |
| OICalculator.symbol | unknown | Internal class state: OICalculator.symbol | server/metrics/OICalculator.ts:10 |
| OIPanelMetrics.currentOI | unknown | Internal/interface alanı: OIPanelMetrics.currentOI | server/metrics/OICalculator.ts:2 |
| OIPanelMetrics.lastUpdated | raw | Internal/interface alanı: OIPanelMetrics.lastUpdated | server/metrics/OICalculator.ts:6 |
| OIPanelMetrics.oiChangeAbs | unknown | Internal/interface alanı: OIPanelMetrics.oiChangeAbs | server/metrics/OICalculator.ts:3 |
| OIPanelMetrics.oiChangePct | pct | Internal/interface alanı: OIPanelMetrics.oiChangePct | server/metrics/OICalculator.ts:4 |
| OIPanelMetrics.stabilityMsg | unknown | Internal/interface alanı: OIPanelMetrics.stabilityMsg | server/metrics/OICalculator.ts:5 |
| OpenInterestMetrics.lastUpdated | raw | Internal/interface alanı: OpenInterestMetrics.lastUpdated | server/metrics/OpenInterestMonitor.ts:17 |
| OpenInterestMetrics.oiChangeAbs | unknown | Internal/interface alanı: OpenInterestMetrics.oiChangeAbs | server/metrics/OpenInterestMonitor.ts:14 |
| OpenInterestMetrics.oiChangePct | pct | Internal/interface alanı: OpenInterestMetrics.oiChangePct | server/metrics/OpenInterestMonitor.ts:15 |
| OpenInterestMetrics.oiDeltaWindow | raw | Internal/interface alanı: OpenInterestMetrics.oiDeltaWindow | server/metrics/OpenInterestMonitor.ts:16 |
| OpenInterestMetrics.openInterest | raw | Internal/interface alanı: OpenInterestMetrics.openInterest | server/metrics/OpenInterestMonitor.ts:13 |
| OpenInterestMetrics.source | raw | Internal/interface alanı: OpenInterestMetrics.source | server/metrics/OpenInterestMonitor.ts:18 |
| OpenInterestMonitor.baselineOI | unknown | Internal class state: OpenInterestMonitor.baselineOI | server/metrics/OpenInterestMonitor.ts:27 |
| OpenInterestMonitor.buildMetrics().lastUpdated | raw | Telemetri alanı: lastUpdated | server/metrics/OpenInterestMonitor.ts:140 |
| OpenInterestMonitor.buildMetrics().oiChangeAbs | unknown | Telemetri alanı: oiChangeAbs | server/metrics/OpenInterestMonitor.ts:137 |
| OpenInterestMonitor.buildMetrics().oiChangePct | pct | Telemetri alanı: oiChangePct | server/metrics/OpenInterestMonitor.ts:138 |
| OpenInterestMonitor.buildMetrics().oiDeltaWindow | raw | Telemetri alanı: oiDeltaWindow | server/metrics/OpenInterestMonitor.ts:139 |
| OpenInterestMonitor.buildMetrics().openInterest | raw | Telemetri alanı: openInterest | server/metrics/OpenInterestMonitor.ts:136 |
| OpenInterestMonitor.buildMetrics().source | raw | Telemetri alanı: source | server/metrics/OpenInterestMonitor.ts:141 |
| OpenInterestMonitor.currentOI | unknown | Internal class state: OpenInterestMonitor.currentOI | server/metrics/OpenInterestMonitor.ts:25 |
| OpenInterestMonitor.FETCH_INTERVAL_MS | raw | Internal class state: OpenInterestMonitor.FETCH_INTERVAL_MS | server/metrics/OpenInterestMonitor.ts:31 |
| OpenInterestMonitor.lastBaselineUpdate | unknown | Internal class state: OpenInterestMonitor.lastBaselineUpdate | server/metrics/OpenInterestMonitor.ts:30 |
| OpenInterestMonitor.lastFetchTime | unknown | Internal class state: OpenInterestMonitor.lastFetchTime | server/metrics/OpenInterestMonitor.ts:29 |
| OpenInterestMonitor.listeners | unknown | Internal class state: OpenInterestMonitor.listeners | server/metrics/OpenInterestMonitor.ts:33 |
| OpenInterestMonitor.oiHistory | unknown | Internal class state: OpenInterestMonitor.oiHistory | server/metrics/OpenInterestMonitor.ts:28 |
| OpenInterestMonitor.previousOI | unknown | Internal class state: OpenInterestMonitor.previousOI | server/metrics/OpenInterestMonitor.ts:26 |
| OpenInterestMonitor.symbol | unknown | Internal class state: OpenInterestMonitor.symbol | server/metrics/OpenInterestMonitor.ts:24 |
| OpenInterestMonitor.WINDOW_MS | raw | Internal class state: OpenInterestMonitor.WINDOW_MS | server/metrics/OpenInterestMonitor.ts:32 |
| OrderbookIntegrityConfig.maxGapBeforeCritical | unknown | Internal/interface alanı: OrderbookIntegrityConfig.maxGapBeforeCritical | server/metrics/OrderbookIntegrityMonitor.ts:29 |
| OrderbookIntegrityConfig.reconnectCooldownMs | raw | Internal/interface alanı: OrderbookIntegrityConfig.reconnectCooldownMs | server/metrics/OrderbookIntegrityMonitor.ts:30 |
| OrderbookIntegrityConfig.staleCriticalMs | raw | Internal/interface alanı: OrderbookIntegrityConfig.staleCriticalMs | server/metrics/OrderbookIntegrityMonitor.ts:28 |
| OrderbookIntegrityConfig.staleWarnMs | raw | Internal/interface alanı: OrderbookIntegrityConfig.staleWarnMs | server/metrics/OrderbookIntegrityMonitor.ts:27 |
| OrderbookIntegrityInput.bestAsk | price | Internal/interface alanı: OrderbookIntegrityInput.bestAsk | server/metrics/OrderbookIntegrityMonitor.ts:22 |
| OrderbookIntegrityInput.bestBid | price | Internal/interface alanı: OrderbookIntegrityInput.bestBid | server/metrics/OrderbookIntegrityMonitor.ts:21 |
| OrderbookIntegrityInput.eventTimeMs | raw | Internal/interface alanı: OrderbookIntegrityInput.eventTimeMs | server/metrics/OrderbookIntegrityMonitor.ts:20 |
| OrderbookIntegrityInput.nowMs | raw | Internal/interface alanı: OrderbookIntegrityInput.nowMs | server/metrics/OrderbookIntegrityMonitor.ts:23 |
| OrderbookIntegrityInput.prevSequenceEnd | unknown | Internal/interface alanı: OrderbookIntegrityInput.prevSequenceEnd | server/metrics/OrderbookIntegrityMonitor.ts:19 |
| OrderbookIntegrityInput.sequenceEnd | unknown | Internal/interface alanı: OrderbookIntegrityInput.sequenceEnd | server/metrics/OrderbookIntegrityMonitor.ts:18 |
| OrderbookIntegrityInput.sequenceStart | unknown | Internal/interface alanı: OrderbookIntegrityInput.sequenceStart | server/metrics/OrderbookIntegrityMonitor.ts:17 |
| OrderbookIntegrityInput.symbol | unknown | Internal/interface alanı: OrderbookIntegrityInput.symbol | server/metrics/OrderbookIntegrityMonitor.ts:16 |
| OrderbookIntegrityMonitor.avgStalenessMs | raw | Internal class state: OrderbookIntegrityMonitor.avgStalenessMs | server/metrics/OrderbookIntegrityMonitor.ts:48 |
| OrderbookIntegrityMonitor.config | unknown | Internal class state: OrderbookIntegrityMonitor.config | server/metrics/OrderbookIntegrityMonitor.ts:42 |
| OrderbookIntegrityMonitor.crossedBookDetected | bool | Internal class state: OrderbookIntegrityMonitor.crossedBookDetected | server/metrics/OrderbookIntegrityMonitor.ts:47 |
| OrderbookIntegrityMonitor.getStatus().avgStalenessMs | raw | Telemetri alanı: avgStalenessMs | server/metrics/OrderbookIntegrityMonitor.ts:133 |
| OrderbookIntegrityMonitor.getStatus().crossedBookDetected | bool | Telemetri alanı: crossedBookDetected | server/metrics/OrderbookIntegrityMonitor.ts:132 |
| OrderbookIntegrityMonitor.getStatus().lastUpdateTimestamp | raw | Telemetri alanı: lastUpdateTimestamp | server/metrics/OrderbookIntegrityMonitor.ts:130 |
| OrderbookIntegrityMonitor.getStatus().level | unknown | Telemetri alanı: level | server/metrics/OrderbookIntegrityMonitor.ts:128 |
| OrderbookIntegrityMonitor.getStatus().message | unknown | Telemetri alanı: message | server/metrics/OrderbookIntegrityMonitor.ts:129 |
| OrderbookIntegrityMonitor.getStatus().reconnectCount | raw | Telemetri alanı: reconnectCount | server/metrics/OrderbookIntegrityMonitor.ts:134 |
| OrderbookIntegrityMonitor.getStatus().reconnectRecommended | unknown | Telemetri alanı: reconnectRecommended | server/metrics/OrderbookIntegrityMonitor.ts:135 |
| OrderbookIntegrityMonitor.getStatus().sequenceGapCount | raw | Telemetri alanı: sequenceGapCount | server/metrics/OrderbookIntegrityMonitor.ts:131 |
| OrderbookIntegrityMonitor.getStatus().symbol | unknown | Telemetri alanı: symbol | server/metrics/OrderbookIntegrityMonitor.ts:127 |
| OrderbookIntegrityMonitor.lastReconnectTimestamp | raw | Internal class state: OrderbookIntegrityMonitor.lastReconnectTimestamp | server/metrics/OrderbookIntegrityMonitor.ts:50 |
| OrderbookIntegrityMonitor.lastSequenceEnd | unknown | Internal class state: OrderbookIntegrityMonitor.lastSequenceEnd | server/metrics/OrderbookIntegrityMonitor.ts:44 |
| OrderbookIntegrityMonitor.lastUpdateTimestamp | raw | Internal class state: OrderbookIntegrityMonitor.lastUpdateTimestamp | server/metrics/OrderbookIntegrityMonitor.ts:45 |
| OrderbookIntegrityMonitor.reconnectCount | raw | Internal class state: OrderbookIntegrityMonitor.reconnectCount | server/metrics/OrderbookIntegrityMonitor.ts:49 |
| OrderbookIntegrityMonitor.sequenceGapCount | raw | Internal class state: OrderbookIntegrityMonitor.sequenceGapCount | server/metrics/OrderbookIntegrityMonitor.ts:46 |
| OrderbookIntegrityMonitor.symbol | unknown | Internal class state: OrderbookIntegrityMonitor.symbol | server/metrics/OrderbookIntegrityMonitor.ts:41 |
| OrderbookIntegrityStatus.avgStalenessMs | raw | Internal/interface alanı: OrderbookIntegrityStatus.avgStalenessMs | server/metrics/OrderbookIntegrityMonitor.ts:10 |
| OrderbookIntegrityStatus.crossedBookDetected | bool | Internal/interface alanı: OrderbookIntegrityStatus.crossedBookDetected | server/metrics/OrderbookIntegrityMonitor.ts:9 |
| OrderbookIntegrityStatus.lastUpdateTimestamp | raw | Internal/interface alanı: OrderbookIntegrityStatus.lastUpdateTimestamp | server/metrics/OrderbookIntegrityMonitor.ts:7 |
| OrderbookIntegrityStatus.level | unknown | Internal/interface alanı: OrderbookIntegrityStatus.level | server/metrics/OrderbookIntegrityMonitor.ts:5 |
| OrderbookIntegrityStatus.message | unknown | Internal/interface alanı: OrderbookIntegrityStatus.message | server/metrics/OrderbookIntegrityMonitor.ts:6 |
| OrderbookIntegrityStatus.reconnectCount | raw | Internal/interface alanı: OrderbookIntegrityStatus.reconnectCount | server/metrics/OrderbookIntegrityMonitor.ts:11 |
| OrderbookIntegrityStatus.reconnectRecommended | bool | Internal/interface alanı: OrderbookIntegrityStatus.reconnectRecommended | server/metrics/OrderbookIntegrityMonitor.ts:12 |
| OrderbookIntegrityStatus.sequenceGapCount | raw | Internal/interface alanı: OrderbookIntegrityStatus.sequenceGapCount | server/metrics/OrderbookIntegrityMonitor.ts:8 |
| OrderbookIntegrityStatus.symbol | unknown | Internal/interface alanı: OrderbookIntegrityStatus.symbol | server/metrics/OrderbookIntegrityMonitor.ts:4 |
| OrderbookState.asks | price | Internal/interface alanı: OrderbookState.asks | server/metrics/OrderbookManager.ts:32 |
| OrderbookState.bids | price | Internal/interface alanı: OrderbookState.bids | server/metrics/OrderbookManager.ts:31 |
| OrderbookState.buffer | unknown | Internal/interface alanı: OrderbookState.buffer | server/metrics/OrderbookManager.ts:36 |
| OrderbookState.lastDepthTime | raw | Internal/interface alanı: OrderbookState.lastDepthTime | server/metrics/OrderbookManager.ts:33 |
| OrderbookState.lastSeenU_u | unknown | Internal/interface alanı: OrderbookState.lastSeenU_u | server/metrics/OrderbookManager.ts:37 |
| OrderbookState.lastUpdateId | unknown | Internal/interface alanı: OrderbookState.lastUpdateId | server/metrics/OrderbookManager.ts:30 |
| OrderbookState.resyncPromise | unknown | Internal/interface alanı: OrderbookState.resyncPromise | server/metrics/OrderbookManager.ts:35 |
| OrderbookState.stats | unknown | Internal/interface alanı: OrderbookState.stats | server/metrics/OrderbookManager.ts:38 |
| OrderbookState.uiState | raw | Internal/interface alanı: OrderbookState.uiState | server/metrics/OrderbookManager.ts:34 |
| PassiveFlowMetrics.askAddRate | price | Internal/interface alanı: PassiveFlowMetrics.askAddRate | server/metrics/AdvancedMicrostructureMetrics.ts:45 |
| PassiveFlowMetrics.askCancelRate | price | Internal/interface alanı: PassiveFlowMetrics.askCancelRate | server/metrics/AdvancedMicrostructureMetrics.ts:47 |
| PassiveFlowMetrics.bidAddRate | price | Internal/interface alanı: PassiveFlowMetrics.bidAddRate | server/metrics/AdvancedMicrostructureMetrics.ts:44 |
| PassiveFlowMetrics.bidCancelRate | price | Internal/interface alanı: PassiveFlowMetrics.bidCancelRate | server/metrics/AdvancedMicrostructureMetrics.ts:46 |
| PassiveFlowMetrics.depthDeltaDecomposition | raw | Internal/interface alanı: PassiveFlowMetrics.depthDeltaDecomposition | server/metrics/AdvancedMicrostructureMetrics.ts:48 |
| PassiveFlowMetrics.queueDeltaBestAsk | price | Internal/interface alanı: PassiveFlowMetrics.queueDeltaBestAsk | server/metrics/AdvancedMicrostructureMetrics.ts:55 |
| PassiveFlowMetrics.queueDeltaBestBid | price | Internal/interface alanı: PassiveFlowMetrics.queueDeltaBestBid | server/metrics/AdvancedMicrostructureMetrics.ts:54 |
| PassiveFlowMetrics.refreshRate | unknown | Internal/interface alanı: PassiveFlowMetrics.refreshRate | server/metrics/AdvancedMicrostructureMetrics.ts:57 |
| PassiveFlowMetrics.spoofScore | raw | Internal/interface alanı: PassiveFlowMetrics.spoofScore | server/metrics/AdvancedMicrostructureMetrics.ts:56 |
| PendingBurstCheck.midPriceAtBurst | price | Internal/interface alanı: PendingBurstCheck.midPriceAtBurst | server/metrics/AdvancedMicrostructureMetrics.ts:144 |
| PendingBurstCheck.side | raw | Internal/interface alanı: PendingBurstCheck.side | server/metrics/AdvancedMicrostructureMetrics.ts:144 |
| PendingBurstCheck.ts | unknown | Internal/interface alanı: PendingBurstCheck.ts | server/metrics/AdvancedMicrostructureMetrics.ts:144 |
| PendingRealizedSpread.side | raw | Internal/interface alanı: PendingRealizedSpread.side | server/metrics/AdvancedMicrostructureMetrics.ts:143 |
| PendingRealizedSpread.tradePrice | price | Internal/interface alanı: PendingRealizedSpread.tradePrice | server/metrics/AdvancedMicrostructureMetrics.ts:143 |
| PendingRealizedSpread.ts | unknown | Internal/interface alanı: PendingRealizedSpread.ts | server/metrics/AdvancedMicrostructureMetrics.ts:143 |
| PerformanceCalculator.getMetrics().lossCount | raw | Telemetri alanı: lossCount | server/metrics/PerformanceCalculator.ts:57 |
| PerformanceCalculator.getMetrics().maxDrawdown | unknown | Telemetri alanı: maxDrawdown | server/metrics/PerformanceCalculator.ts:60 |
| PerformanceCalculator.getMetrics().pnlCurve | unknown | Telemetri alanı: pnlCurve | server/metrics/PerformanceCalculator.ts:62 |
| PerformanceCalculator.getMetrics().sharpeRatio | raw | Telemetri alanı: sharpeRatio | server/metrics/PerformanceCalculator.ts:61 |
| PerformanceCalculator.getMetrics().totalPnL | unknown | Telemetri alanı: totalPnL | server/metrics/PerformanceCalculator.ts:55 |
| PerformanceCalculator.getMetrics().totalTrades | unknown | Telemetri alanı: totalTrades | server/metrics/PerformanceCalculator.ts:58 |
| PerformanceCalculator.getMetrics().winCount | raw | Telemetri alanı: winCount | server/metrics/PerformanceCalculator.ts:56 |
| PerformanceCalculator.getMetrics().winRate | unknown | Telemetri alanı: winRate | server/metrics/PerformanceCalculator.ts:59 |
| PerformanceCalculator.lossCount | raw | Internal class state: PerformanceCalculator.lossCount | server/metrics/PerformanceCalculator.ts:20 |
| PerformanceCalculator.maxCurvePoints | unknown | Internal class state: PerformanceCalculator.maxCurvePoints | server/metrics/PerformanceCalculator.ts:24 |
| PerformanceCalculator.maxDrawdown | unknown | Internal class state: PerformanceCalculator.maxDrawdown | server/metrics/PerformanceCalculator.ts:21 |
| PerformanceCalculator.peakPnL | unknown | Internal class state: PerformanceCalculator.peakPnL | server/metrics/PerformanceCalculator.ts:22 |
| PerformanceCalculator.pnlCurve | unknown | Internal class state: PerformanceCalculator.pnlCurve | server/metrics/PerformanceCalculator.ts:23 |
| PerformanceCalculator.totalPnL | unknown | Internal class state: PerformanceCalculator.totalPnL | server/metrics/PerformanceCalculator.ts:18 |
| PerformanceCalculator.winCount | raw | Internal class state: PerformanceCalculator.winCount | server/metrics/PerformanceCalculator.ts:19 |
| PerformanceMetrics.lossCount | raw | Internal/interface alanı: PerformanceMetrics.lossCount | server/metrics/PerformanceCalculator.ts:9 |
| PerformanceMetrics.maxDrawdown | unknown | Internal/interface alanı: PerformanceMetrics.maxDrawdown | server/metrics/PerformanceCalculator.ts:12 |
| PerformanceMetrics.pnlCurve | unknown | Internal/interface alanı: PerformanceMetrics.pnlCurve | server/metrics/PerformanceCalculator.ts:14 |
| PerformanceMetrics.sharpeRatio | raw | Internal/interface alanı: PerformanceMetrics.sharpeRatio | server/metrics/PerformanceCalculator.ts:13 |
| PerformanceMetrics.totalPnL | unknown | Internal/interface alanı: PerformanceMetrics.totalPnL | server/metrics/PerformanceCalculator.ts:7 |
| PerformanceMetrics.totalTrades | unknown | Internal/interface alanı: PerformanceMetrics.totalTrades | server/metrics/PerformanceCalculator.ts:10 |
| PerformanceMetrics.winCount | raw | Internal/interface alanı: PerformanceMetrics.winCount | server/metrics/PerformanceCalculator.ts:8 |
| PerformanceMetrics.winRate | unknown | Internal/interface alanı: PerformanceMetrics.winRate | server/metrics/PerformanceCalculator.ts:11 |
| PrecisionRecallReport.longPrecision | unknown | Internal/interface alanı: PrecisionRecallReport.longPrecision | server/metrics/TradeMetrics.ts:16 |
| PrecisionRecallReport.longRecall | unknown | Internal/interface alanı: PrecisionRecallReport.longRecall | server/metrics/TradeMetrics.ts:17 |
| PrecisionRecallReport.shortPrecision | unknown | Internal/interface alanı: PrecisionRecallReport.shortPrecision | server/metrics/TradeMetrics.ts:18 |
| PrecisionRecallReport.shortRecall | unknown | Internal/interface alanı: PrecisionRecallReport.shortRecall | server/metrics/TradeMetrics.ts:19 |
| PrecisionRecallReport.totalWinRate | unknown | Internal/interface alanı: PrecisionRecallReport.totalWinRate | server/metrics/TradeMetrics.ts:20 |
| PricePoint.price | price | Internal/interface alanı: PricePoint.price | server/metrics/SignalPerformance.ts:9 |
| PricePoint.timestampMs | raw | Internal/interface alanı: PricePoint.timestampMs | server/metrics/SignalPerformance.ts:8 |
| RecentAggTrade.notional | raw | Internal/interface alanı: RecentAggTrade.notional | server/metrics/AdvancedMicrostructureMetrics.ts:145 |
| RecentAggTrade.price | price | Internal/interface alanı: RecentAggTrade.price | server/metrics/AdvancedMicrostructureMetrics.ts:145 |
| RecentAggTrade.side | raw | Internal/interface alanı: RecentAggTrade.side | server/metrics/AdvancedMicrostructureMetrics.ts:145 |
| RecentAggTrade.ts | unknown | Internal/interface alanı: RecentAggTrade.ts | server/metrics/AdvancedMicrostructureMetrics.ts:145 |
| RecentLargeAdd.price | price | Internal/interface alanı: RecentLargeAdd.price | server/metrics/AdvancedMicrostructureMetrics.ts:146 |
| RecentLargeAdd.quantity | unknown | Internal/interface alanı: RecentLargeAdd.quantity | server/metrics/AdvancedMicrostructureMetrics.ts:146 |
| RecentLargeAdd.side | raw | Internal/interface alanı: RecentLargeAdd.side | server/metrics/AdvancedMicrostructureMetrics.ts:146 |
| RecentLargeAdd.ts | unknown | Internal/interface alanı: RecentLargeAdd.ts | server/metrics/AdvancedMicrostructureMetrics.ts:146 |
| RegimeMetrics.chopScore | raw | Internal/interface alanı: RegimeMetrics.chopScore | server/metrics/AdvancedMicrostructureMetrics.ts:82 |
| RegimeMetrics.microATR | price | Internal/interface alanı: RegimeMetrics.microATR | server/metrics/AdvancedMicrostructureMetrics.ts:81 |
| RegimeMetrics.realizedVol15m | raw | Internal/interface alanı: RegimeMetrics.realizedVol15m | server/metrics/AdvancedMicrostructureMetrics.ts:79 |
| RegimeMetrics.realizedVol1m | raw | Internal/interface alanı: RegimeMetrics.realizedVol1m | server/metrics/AdvancedMicrostructureMetrics.ts:77 |
| RegimeMetrics.realizedVol5m | raw | Internal/interface alanı: RegimeMetrics.realizedVol5m | server/metrics/AdvancedMicrostructureMetrics.ts:78 |
| RegimeMetrics.trendinessScore | raw | Internal/interface alanı: RegimeMetrics.trendinessScore | server/metrics/AdvancedMicrostructureMetrics.ts:83 |
| RegimeMetrics.volOfVol | raw | Internal/interface alanı: RegimeMetrics.volOfVol | server/metrics/AdvancedMicrostructureMetrics.ts:80 |
| RegressionWindow.head | unknown | Internal class state: RegressionWindow.head | server/metrics/RollingWindow.ts:146 |
| RegressionWindow.n | unknown | Internal class state: RegressionWindow.n | server/metrics/RollingWindow.ts:147 |
| RegressionWindow.sumX | unknown | Internal class state: RegressionWindow.sumX | server/metrics/RollingWindow.ts:148 |
| RegressionWindow.sumXX | unknown | Internal class state: RegressionWindow.sumXX | server/metrics/RollingWindow.ts:150 |
| RegressionWindow.sumXY | unknown | Internal class state: RegressionWindow.sumXY | server/metrics/RollingWindow.ts:151 |
| RegressionWindow.sumY | unknown | Internal class state: RegressionWindow.sumY | server/metrics/RollingWindow.ts:149 |
| RegressionWindow.values | unknown | Internal class state: RegressionWindow.values | server/metrics/RollingWindow.ts:145 |
| ReturnDistribution.histogram | unknown | Internal/interface alanı: ReturnDistribution.histogram | server/metrics/PortfolioMetrics.ts:5 |
| ReturnDistribution.max | unknown | Internal/interface alanı: ReturnDistribution.max | server/metrics/PortfolioMetrics.ts:4 |
| ReturnDistribution.mean | unknown | Internal/interface alanı: ReturnDistribution.mean | server/metrics/PortfolioMetrics.ts:2 |
| ReturnDistribution.min | unknown | Internal/interface alanı: ReturnDistribution.min | server/metrics/PortfolioMetrics.ts:3 |
| SessionState.high | unknown | Internal/interface alanı: SessionState.high | server/metrics/SessionVwapTracker.ts:24 |
| SessionState.low | unknown | Internal/interface alanı: SessionState.low | server/metrics/SessionVwapTracker.ts:25 |
| SessionState.name | raw | Internal/interface alanı: SessionState.name | server/metrics/SessionVwapTracker.ts:20 |
| SessionState.notional | raw | Internal/interface alanı: SessionState.notional | server/metrics/SessionVwapTracker.ts:23 |
| SessionState.sessionStartMs | raw | Internal/interface alanı: SessionState.sessionStartMs | server/metrics/SessionVwapTracker.ts:21 |
| SessionState.volume | raw | Internal/interface alanı: SessionState.volume | server/metrics/SessionVwapTracker.ts:22 |
| SessionVwapSnapshot.elapsedMs | raw | Internal/interface alanı: SessionVwapSnapshot.elapsedMs | server/metrics/SessionVwapTracker.ts:6 |
| SessionVwapSnapshot.name | raw | Internal/interface alanı: SessionVwapSnapshot.name | server/metrics/SessionVwapTracker.ts:4 |
| SessionVwapSnapshot.priceDistanceBps | bps | Internal/interface alanı: SessionVwapSnapshot.priceDistanceBps | server/metrics/SessionVwapTracker.ts:8 |
| SessionVwapSnapshot.sessionHigh | unknown | Internal/interface alanı: SessionVwapSnapshot.sessionHigh | server/metrics/SessionVwapTracker.ts:9 |
| SessionVwapSnapshot.sessionLow | unknown | Internal/interface alanı: SessionVwapSnapshot.sessionLow | server/metrics/SessionVwapTracker.ts:10 |
| SessionVwapSnapshot.sessionRangePct | pct | Internal/interface alanı: SessionVwapSnapshot.sessionRangePct | server/metrics/SessionVwapTracker.ts:11 |
| SessionVwapSnapshot.sessionStartMs | raw | Internal/interface alanı: SessionVwapSnapshot.sessionStartMs | server/metrics/SessionVwapTracker.ts:5 |
| SessionVwapSnapshot.value | unknown | Internal/interface alanı: SessionVwapSnapshot.value | server/metrics/SessionVwapTracker.ts:7 |
| SessionVwapTracker.snapshot().elapsedMs | raw | Telemetri alanı: elapsedMs | server/metrics/SessionVwapTracker.ts:120 |
| SessionVwapTracker.snapshot().name | raw | Telemetri alanı: name | server/metrics/SessionVwapTracker.ts:118 |
| SessionVwapTracker.snapshot().priceDistanceBps | bps | Telemetri alanı: priceDistanceBps | server/metrics/SessionVwapTracker.ts:122 |
| SessionVwapTracker.snapshot().sessionHigh | unknown | Telemetri alanı: sessionHigh | server/metrics/SessionVwapTracker.ts:123 |
| SessionVwapTracker.snapshot().sessionLow | unknown | Telemetri alanı: sessionLow | server/metrics/SessionVwapTracker.ts:124 |
| SessionVwapTracker.snapshot().sessionRangePct | pct | Telemetri alanı: sessionRangePct | server/metrics/SessionVwapTracker.ts:125 |
| SessionVwapTracker.snapshot().sessionStartMs | raw | Telemetri alanı: sessionStartMs | server/metrics/SessionVwapTracker.ts:119 |
| SessionVwapTracker.snapshot().value | unknown | Telemetri alanı: value | server/metrics/SessionVwapTracker.ts:121 |
| SessionVwapTracker.state | raw | Internal class state: SessionVwapTracker.state | server/metrics/SessionVwapTracker.ts:94 |
| SessionVwapTracker.windows | unknown | Internal class state: SessionVwapTracker.windows | server/metrics/SessionVwapTracker.ts:93 |
| SessionWindow.name | raw | Internal/interface alanı: SessionWindow.name | server/metrics/SessionVwapTracker.ts:15 |
| SessionWindow.startHourUtc | unknown | Internal/interface alanı: SessionWindow.startHourUtc | server/metrics/SessionVwapTracker.ts:16 |
| SignalEvent.side | raw | Internal/interface alanı: SignalEvent.side | server/metrics/SignalPerformance.ts:3 |
| SignalEvent.strength | unknown | Internal/interface alanı: SignalEvent.strength | server/metrics/SignalPerformance.ts:4 |
| SignalEvent.timestampMs | raw | Internal/interface alanı: SignalEvent.timestampMs | server/metrics/SignalPerformance.ts:2 |
| SizePerformance.avgPnl | unknown | Internal/interface alanı: SizePerformance.avgPnl | server/metrics/ExecutionMetrics.ts:18 |
| SizePerformance.avgSlippageBps | bps | Internal/interface alanı: SizePerformance.avgSlippageBps | server/metrics/ExecutionMetrics.ts:19 |
| SizePerformance.bucket | unknown | Internal/interface alanı: SizePerformance.bucket | server/metrics/ExecutionMetrics.ts:17 |
| SizePerformance.tradeCount | raw | Internal/interface alanı: SizePerformance.tradeCount | server/metrics/ExecutionMetrics.ts:20 |
| SnapshotApplyResult.appliedCount | raw | Internal/interface alanı: SnapshotApplyResult.appliedCount | server/metrics/OrderbookManager.ts:48 |
| SnapshotApplyResult.droppedCount | raw | Internal/interface alanı: SnapshotApplyResult.droppedCount | server/metrics/OrderbookManager.ts:49 |
| SnapshotApplyResult.gapDetected | bool | Internal/interface alanı: SnapshotApplyResult.gapDetected | server/metrics/OrderbookManager.ts:50 |
| SnapshotApplyResult.ok | bool | Internal/interface alanı: SnapshotApplyResult.ok | server/metrics/OrderbookManager.ts:47 |
| SpotReferenceMetrics.imbalance10 | unknown | Internal/interface alanı: SpotReferenceMetrics.imbalance10 | server/metrics/SpotReferenceMonitor.ts:4 |
| SpotReferenceMetrics.lastUpdated | raw | Internal/interface alanı: SpotReferenceMetrics.lastUpdated | server/metrics/SpotReferenceMonitor.ts:5 |
| SpotReferenceMetrics.midPrice | price | Internal/interface alanı: SpotReferenceMetrics.midPrice | server/metrics/SpotReferenceMonitor.ts:3 |
| SpotReferenceMetrics.source | raw | Internal/interface alanı: SpotReferenceMetrics.source | server/metrics/SpotReferenceMonitor.ts:6 |
| SpotReferenceMetrics.symbol | unknown | Internal/interface alanı: SpotReferenceMetrics.symbol | server/metrics/SpotReferenceMonitor.ts:2 |
| SpotReferenceMonitor.inFlight | unknown | Internal class state: SpotReferenceMonitor.inFlight | server/metrics/SpotReferenceMonitor.ts:11 |
| SpotReferenceMonitor.metrics | unknown | Internal class state: SpotReferenceMonitor.metrics | server/metrics/SpotReferenceMonitor.ts:12 |
| SpotReferenceMonitor.timer | unknown | Internal class state: SpotReferenceMonitor.timer | server/metrics/SpotReferenceMonitor.ts:10 |
| SpotReferenceSnapshot.imbalance10 | unknown | Internal/interface alanı: SpotReferenceSnapshot.imbalance10 | server/metrics/AdvancedMicrostructureMetrics.ts:132 |
| SpotReferenceSnapshot.midPrice | price | Internal/interface alanı: SpotReferenceSnapshot.midPrice | server/metrics/AdvancedMicrostructureMetrics.ts:131 |
| SpotReferenceSnapshot.timestampMs | raw | Internal/interface alanı: SpotReferenceSnapshot.timestampMs | server/metrics/AdvancedMicrostructureMetrics.ts:130 |
| SpreadPerformance.avgPnl | unknown | Internal/interface alanı: SpreadPerformance.avgPnl | server/metrics/ExecutionMetrics.ts:11 |
| SpreadPerformance.bucket | unknown | Internal/interface alanı: SpreadPerformance.bucket | server/metrics/ExecutionMetrics.ts:10 |
| SpreadPerformance.tradeCount | raw | Internal/interface alanı: SpreadPerformance.tradeCount | server/metrics/ExecutionMetrics.ts:13 |
| SpreadPerformance.winRate | unknown | Internal/interface alanı: SpreadPerformance.winRate | server/metrics/ExecutionMetrics.ts:12 |
| StoredCvdTrade.arrival | unknown | Internal/interface alanı: StoredCvdTrade.arrival | server/metrics/CvdCalculator.ts:20 |
| StoredCvdTrade.price | price | Internal/interface alanı: StoredCvdTrade.price | server/metrics/CvdCalculator.ts:21 |
| StoredTrade.arrival | unknown | Internal/interface alanı: StoredTrade.arrival | server/metrics/TimeAndSales.ts:95 |
| StrategyMetricsCollector.currentEquity | unknown | Internal class state: StrategyMetricsCollector.currentEquity | server/metrics/StrategyMetricsCollector.ts:9 |
| StrategyMetricsCollector.dailyPnL | unknown | Internal class state: StrategyMetricsCollector.dailyPnL | server/metrics/StrategyMetricsCollector.ts:10 |
| StrategyMetricsCollector.initialCapital | unknown | Internal class state: StrategyMetricsCollector.initialCapital | server/metrics/StrategyMetricsCollector.ts:8 |
| StrategyMetricsCollector.latencySamples | unknown | Internal class state: StrategyMetricsCollector.latencySamples | server/metrics/StrategyMetricsCollector.ts:17 |
| StrategyMetricsCollector.maxDrawdown | unknown | Internal class state: StrategyMetricsCollector.maxDrawdown | server/metrics/StrategyMetricsCollector.ts:14 |
| StrategyMetricsCollector.peakEquity | unknown | Internal class state: StrategyMetricsCollector.peakEquity | server/metrics/StrategyMetricsCollector.ts:15 |
| StrategyMetricsCollector.returnSamples | unknown | Internal class state: StrategyMetricsCollector.returnSamples | server/metrics/StrategyMetricsCollector.ts:18 |
| StrategyMetricsCollector.totalFeesPaid | unknown | Internal class state: StrategyMetricsCollector.totalFeesPaid | server/metrics/StrategyMetricsCollector.ts:16 |
| StrategyMetricsCollector.totalPnL | unknown | Internal class state: StrategyMetricsCollector.totalPnL | server/metrics/StrategyMetricsCollector.ts:11 |
| StrategyMetricsCollector.totalTrades | unknown | Internal class state: StrategyMetricsCollector.totalTrades | server/metrics/StrategyMetricsCollector.ts:12 |
| StrategyMetricsCollector.winningTrades | unknown | Internal class state: StrategyMetricsCollector.winningTrades | server/metrics/StrategyMetricsCollector.ts:13 |
| TimeAndSales.computeMetrics().aggressiveBuyVolume | raw | Telemetri alanı: aggressiveBuyVolume | server/metrics/TimeAndSales.ts:214 |
| TimeAndSales.computeMetrics().aggressiveSellVolume | raw | Telemetri alanı: aggressiveSellVolume | server/metrics/TimeAndSales.ts:215 |
| TimeAndSales.computeMetrics().bidHitAskLiftRatio | price | Telemetri alanı: bidHitAskLiftRatio | server/metrics/TimeAndSales.ts:220 |
| TimeAndSales.computeMetrics().consecutiveBurst | unknown | Telemetri alanı: consecutiveBurst | server/metrics/TimeAndSales.ts:221 |
| TimeAndSales.computeMetrics().largeTrades | unknown | Telemetri alanı: largeTrades | server/metrics/TimeAndSales.ts:219 |
| TimeAndSales.computeMetrics().midTrades | price | Telemetri alanı: midTrades | server/metrics/TimeAndSales.ts:218 |
| TimeAndSales.computeMetrics().printsPerSecond | unknown | Telemetri alanı: printsPerSecond | server/metrics/TimeAndSales.ts:222 |
| TimeAndSales.computeMetrics().smallTrades | unknown | Telemetri alanı: smallTrades | server/metrics/TimeAndSales.ts:217 |
| TimeAndSales.computeMetrics().tradeCount | raw | Telemetri alanı: tradeCount | server/metrics/TimeAndSales.ts:216 |
| TimeAndSales.head | unknown | Internal class state: TimeAndSales.head | server/metrics/TimeAndSales.ts:111 |
| TimeAndSales.lastBurstCount | raw | Internal class state: TimeAndSales.lastBurstCount | server/metrics/TimeAndSales.ts:113 |
| TimeAndSales.lastBurstSide | raw | Internal class state: TimeAndSales.lastBurstSide | server/metrics/TimeAndSales.ts:112 |
| TimeAndSales.trades | unknown | Internal class state: TimeAndSales.trades | server/metrics/TimeAndSales.ts:110 |
| TimeAndSales.windowMs | raw | Internal class state: TimeAndSales.windowMs | server/metrics/TimeAndSales.ts:109 |
| TimeframeStore.head | unknown | Internal/interface alanı: TimeframeStore.head | server/metrics/CvdCalculator.ts:27 |
| TimeframeStore.trades | unknown | Internal/interface alanı: TimeframeStore.trades | server/metrics/CvdCalculator.ts:26 |
| TimeframeStore.windowMs | raw | Internal/interface alanı: TimeframeStore.windowMs | server/metrics/CvdCalculator.ts:25 |

Not: 541 alanin ilk 500 satiri gosterildi.

## Mismatch

### Type var ama payload yok

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| aiBias.breakConfirm | unknown | AI bias alanı: breakConfirm | src/types/metrics.ts:46 |
| aiBias.confidence | unknown | AI bias alanı: confidence | src/types/metrics.ts:43 |
| aiBias.lockedByPosition | bool | AI bias alanı: lockedByPosition | src/types/metrics.ts:45 |
| aiBias.reason | raw | AI bias alanı: reason | src/types/metrics.ts:47 |
| aiBias.side | raw | AI bias alanı: side | src/types/metrics.ts:42 |
| aiBias.source | raw | AI bias alanı: source | src/types/metrics.ts:44 |
| aiBias.timestampMs | raw | AI bias alanı: timestampMs | src/types/metrics.ts:48 |
| aiTrend.ageMs | raw | AI trend alanı: ageMs | src/types/metrics.ts:255 |
| aiTrend.breakConfirm | unknown | AI trend alanı: breakConfirm | src/types/metrics.ts:256 |
| aiTrend.intact | bool | AI trend alanı: intact | src/types/metrics.ts:254 |
| aiTrend.score | raw | AI trend alanı: score | src/types/metrics.ts:253 |
| aiTrend.side | raw | AI trend alanı: side | src/types/metrics.ts:252 |
| aiTrend.source | raw | AI trend alanı: source | src/types/metrics.ts:257 |
| crossMarketMetrics.betaToBTC | unknown | Cross-market metriği: betaToBTC | src/types/metrics.ts:200 |
| crossMarketMetrics.betaToETH | unknown | Cross-market metriği: betaToETH | src/types/metrics.ts:201 |
| crossMarketMetrics.crossVenueImbalanceDiff | unknown | Cross-market metriği: crossVenueImbalanceDiff | src/types/metrics.ts:202 |
| crossMarketMetrics.spotPerpDivergence | unknown | Cross-market metriği: spotPerpDivergence | src/types/metrics.ts:199 |
| derivativesMetrics.indexLastDeviationPct | pct | Türev piyasa metriği: indexLastDeviationPct | src/types/metrics.ts:174 |
| derivativesMetrics.liquidationProxyScore | raw | Türev piyasa metriği: liquidationProxyScore | src/types/metrics.ts:177 |
| derivativesMetrics.markLastDeviationPct | pct | Türev piyasa metriği: markLastDeviationPct | src/types/metrics.ts:173 |
| derivativesMetrics.perpBasis | raw | Türev piyasa metriği: perpBasis | src/types/metrics.ts:175 |
| derivativesMetrics.perpBasisZScore | raw | Türev piyasa metriği: perpBasisZScore | src/types/metrics.ts:176 |
| funding.indexPrice | price | Funding metriği: indexPrice | src/types/metrics.ts:131 |
| funding.markPrice | price | Funding metriği: markPrice | src/types/metrics.ts:130 |
| funding.rate | unknown | Funding metriği: rate | src/types/metrics.ts:126 |
| funding.source | raw | Funding metriği: source | src/types/metrics.ts:129 |
| funding.timeToFundingMs | raw | Funding metriği: timeToFundingMs | src/types/metrics.ts:127 |
| funding.trend | raw | Funding metriği: trend | src/types/metrics.ts:128 |
| htf.h1.atr | price | HTF ham structure metriği: atr | src/types/metrics.ts:219 |
| htf.h1.barStartMs | raw | HTF ham structure metriği: barStartMs | src/types/metrics.ts:217 |
| htf.h1.close | price | HTF ham structure metriği: close | src/types/metrics.ts:218 |
| htf.h1.lastSwingHigh | price | HTF ham structure metriği: lastSwingHigh | src/types/metrics.ts:220 |
| htf.h1.lastSwingLow | price | HTF ham structure metriği: lastSwingLow | src/types/metrics.ts:221 |
| htf.h1.structureBreakDn | bool | HTF ham structure metriği: structureBreakDn | src/types/metrics.ts:223 |
| htf.h1.structureBreakUp | bool | HTF ham structure metriği: structureBreakUp | src/types/metrics.ts:222 |
| htf.h4.atr | price | HTF ham structure metriği: atr | src/types/metrics.ts:219 |
| htf.h4.barStartMs | raw | HTF ham structure metriği: barStartMs | src/types/metrics.ts:217 |
| htf.h4.close | price | HTF ham structure metriği: close | src/types/metrics.ts:218 |
| htf.h4.lastSwingHigh | price | HTF ham structure metriği: lastSwingHigh | src/types/metrics.ts:220 |
| htf.h4.lastSwingLow | price | HTF ham structure metriği: lastSwingLow | src/types/metrics.ts:221 |
| htf.h4.structureBreakDn | bool | HTF ham structure metriği: structureBreakDn | src/types/metrics.ts:223 |
| htf.h4.structureBreakUp | bool | HTF ham structure metriği: structureBreakUp | src/types/metrics.ts:222 |
| legacyMetrics.cvdSession | unknown | Legacy orderflow metriği: cvdSession | src/types/metrics.ts:76 |
| legacyMetrics.cvdSlope | raw | Legacy orderflow metriği: cvdSlope | src/types/metrics.ts:77 |
| legacyMetrics.delta1s | raw | Legacy orderflow metriği: delta1s | src/types/metrics.ts:73 |
| legacyMetrics.delta5s | raw | Legacy orderflow metriği: delta5s | src/types/metrics.ts:74 |
| legacyMetrics.deltaZ | raw | Legacy orderflow metriği: deltaZ | src/types/metrics.ts:75 |
| legacyMetrics.obiDeep | price | Legacy orderflow metriği: obiDeep | src/types/metrics.ts:71 |
| legacyMetrics.obiDivergence | price | Legacy orderflow metriği: obiDivergence | src/types/metrics.ts:72 |
| legacyMetrics.obiWeighted | unknown | Legacy orderflow metriği: obiWeighted | src/types/metrics.ts:70 |
| legacyMetrics.price | price | Legacy orderflow metriği: price | src/types/metrics.ts:69 |
| legacyMetrics.totalNotional | raw | Legacy orderflow metriği: totalNotional | src/types/metrics.ts:80 |
| legacyMetrics.totalVolume | raw | Legacy orderflow metriği: totalVolume | src/types/metrics.ts:79 |
| legacyMetrics.tradeCount | raw | Legacy orderflow metriği: tradeCount | src/types/metrics.ts:81 |
| legacyMetrics.vwap | price | Legacy orderflow metriği: vwap | src/types/metrics.ts:78 |
| liquidityMetrics.bookConvexity | unknown | Likidite metriği: bookConvexity | src/types/metrics.ts:145 |
| liquidityMetrics.bookSlopeAsk | price | Likidite metriği: bookSlopeAsk | src/types/metrics.ts:144 |
| liquidityMetrics.bookSlopeBid | price | Likidite metriği: bookSlopeBid | src/types/metrics.ts:143 |
| liquidityMetrics.effectiveSpread | raw | Likidite metriği: effectiveSpread | src/types/metrics.ts:151 |
| liquidityMetrics.expectedSlippageBuy | unknown | Likidite metriği: expectedSlippageBuy | src/types/metrics.ts:148 |
| liquidityMetrics.expectedSlippageSell | unknown | Likidite metriği: expectedSlippageSell | src/types/metrics.ts:149 |
| liquidityMetrics.imbalanceCurve | unknown | Likidite metriği: imbalanceCurve | src/types/metrics.ts:136 |
| liquidityMetrics.imbalanceCurve.level1 | unknown | Likidite metriği: level1 | src/types/metrics.ts:137 |
| liquidityMetrics.imbalanceCurve.level10 | unknown | Likidite metriği: level10 | src/types/metrics.ts:139 |
| liquidityMetrics.imbalanceCurve.level20 | unknown | Likidite metriği: level20 | src/types/metrics.ts:140 |
| liquidityMetrics.imbalanceCurve.level5 | unknown | Likidite metriği: level5 | src/types/metrics.ts:138 |
| liquidityMetrics.imbalanceCurve.level50 | unknown | Likidite metriği: level50 | src/types/metrics.ts:141 |
| liquidityMetrics.liquidityWallScore | raw | Likidite metriği: liquidityWallScore | src/types/metrics.ts:146 |
| liquidityMetrics.microPrice | price | Likidite metriği: microPrice | src/types/metrics.ts:135 |
| liquidityMetrics.realizedSpreadShortWindow | raw | Likidite metriği: realizedSpreadShortWindow | src/types/metrics.ts:152 |
| liquidityMetrics.resiliencyMs | raw | Likidite metriği: resiliencyMs | src/types/metrics.ts:150 |
| liquidityMetrics.voidGapScore | raw | Likidite metriği: voidGapScore | src/types/metrics.ts:147 |
| openInterest.lastUpdated | raw | Open interest metriği: lastUpdated | src/types/metrics.ts:114 |
| openInterest.oiChangeAbs | unknown | Open interest metriği: oiChangeAbs | src/types/metrics.ts:111 |
| openInterest.oiChangePct | pct | Open interest metriği: oiChangePct | src/types/metrics.ts:112 |
| openInterest.oiDeltaWindow | raw | Open interest metriği: oiDeltaWindow | src/types/metrics.ts:113 |
| openInterest.openInterest | raw | Open interest metriği: openInterest | src/types/metrics.ts:110 |
| openInterest.source | raw | Open interest metriği: source | src/types/metrics.ts:115 |
| openInterest.stabilityMsg | unknown | Open interest metriği: stabilityMsg | src/types/metrics.ts:116 |
| orderbookIntegrity.avgStalenessMs | raw | Orderbook integrity alanı: avgStalenessMs | src/types/metrics.ts:268 |
| orderbookIntegrity.crossedBookDetected | bool | Orderbook integrity alanı: crossedBookDetected | src/types/metrics.ts:267 |
| orderbookIntegrity.lastUpdateTimestamp | raw | Orderbook integrity alanı: lastUpdateTimestamp | src/types/metrics.ts:265 |
| orderbookIntegrity.level | unknown | Orderbook integrity alanı: level | src/types/metrics.ts:263 |
| orderbookIntegrity.message | unknown | Orderbook integrity alanı: message | src/types/metrics.ts:264 |
| orderbookIntegrity.reconnectCount | raw | Orderbook integrity alanı: reconnectCount | src/types/metrics.ts:269 |
| orderbookIntegrity.reconnectRecommended | bool | Orderbook integrity alanı: reconnectRecommended | src/types/metrics.ts:270 |
| orderbookIntegrity.sequenceGapCount | raw | Orderbook integrity alanı: sequenceGapCount | src/types/metrics.ts:266 |
| orderbookIntegrity.symbol | unknown | Orderbook integrity alanı: symbol | src/types/metrics.ts:262 |
| passiveFlowMetrics.askAddRate | price | Pasif akış metriği: askAddRate | src/types/metrics.ts:157 |
| passiveFlowMetrics.askCancelRate | price | Pasif akış metriği: askCancelRate | src/types/metrics.ts:159 |
| passiveFlowMetrics.bidAddRate | price | Pasif akış metriği: bidAddRate | src/types/metrics.ts:156 |
| passiveFlowMetrics.bidCancelRate | price | Pasif akış metriği: bidCancelRate | src/types/metrics.ts:158 |
| passiveFlowMetrics.depthDeltaDecomposition | raw | Pasif akış metriği: depthDeltaDecomposition | src/types/metrics.ts:160 |
| passiveFlowMetrics.depthDeltaDecomposition.addVolume | raw | Pasif akış metriği: addVolume | src/types/metrics.ts:161 |
| passiveFlowMetrics.depthDeltaDecomposition.cancelVolume | raw | Pasif akış metriği: cancelVolume | src/types/metrics.ts:162 |
| passiveFlowMetrics.depthDeltaDecomposition.netDepthDelta | raw | Pasif akış metriği: netDepthDelta | src/types/metrics.ts:164 |
| passiveFlowMetrics.depthDeltaDecomposition.tradeRelatedVolume | raw | Pasif akış metriği: tradeRelatedVolume | src/types/metrics.ts:163 |
| passiveFlowMetrics.queueDeltaBestAsk | price | Pasif akış metriği: queueDeltaBestAsk | src/types/metrics.ts:167 |
| passiveFlowMetrics.queueDeltaBestBid | price | Pasif akış metriği: queueDeltaBestBid | src/types/metrics.ts:166 |
| passiveFlowMetrics.refreshRate | unknown | Pasif akış metriği: refreshRate | src/types/metrics.ts:169 |
| passiveFlowMetrics.spoofScore | raw | Pasif akış metriği: spoofScore | src/types/metrics.ts:168 |
| regimeMetrics.chopScore | raw | Rejim metriği: chopScore | src/types/metrics.ts:194 |
| regimeMetrics.microATR | price | Rejim metriği: microATR | src/types/metrics.ts:193 |
| regimeMetrics.realizedVol15m | raw | Rejim metriği: realizedVol15m | src/types/metrics.ts:191 |
| regimeMetrics.realizedVol1m | raw | Rejim metriği: realizedVol1m | src/types/metrics.ts:189 |
| regimeMetrics.realizedVol5m | raw | Rejim metriği: realizedVol5m | src/types/metrics.ts:190 |
| regimeMetrics.trendinessScore | raw | Rejim metriği: trendinessScore | src/types/metrics.ts:195 |
| regimeMetrics.volOfVol | raw | Rejim metriği: volOfVol | src/types/metrics.ts:192 |
| sessionVwap.elapsedMs | raw | Session VWAP ham metriği: elapsedMs | src/types/metrics.ts:208 |
| sessionVwap.name | raw | Session VWAP ham metriği: name | src/types/metrics.ts:206 |
| sessionVwap.priceDistanceBps | bps | Session VWAP ham metriği: priceDistanceBps | src/types/metrics.ts:210 |
| sessionVwap.sessionHigh | unknown | Session VWAP ham metriği: sessionHigh | src/types/metrics.ts:211 |
| sessionVwap.sessionLow | unknown | Session VWAP ham metriği: sessionLow | src/types/metrics.ts:212 |
| sessionVwap.sessionRangePct | pct | Session VWAP ham metriği: sessionRangePct | src/types/metrics.ts:213 |
| sessionVwap.sessionStartMs | raw | Session VWAP ham metriği: sessionStartMs | src/types/metrics.ts:207 |
| sessionVwap.value | unknown | Session VWAP ham metriği: value | src/types/metrics.ts:209 |
| signalDisplay.boost | unknown | Sinyal gösterim alanı: boost | src/types/metrics.ts:25 |
| signalDisplay.boost.contributions | unknown | Sinyal gösterim alanı: contributions | src/types/metrics.ts:27 |
| signalDisplay.boost.score | raw | Sinyal gösterim alanı: score | src/types/metrics.ts:26 |
| signalDisplay.boost.timeframeMultipliers | unknown | Sinyal gösterim alanı: timeframeMultipliers | src/types/metrics.ts:28 |
| signalDisplay.candidate | unknown | Sinyal gösterim alanı: candidate | src/types/metrics.ts:20 |
| signalDisplay.candidate.entryPrice | price | Sinyal gösterim alanı: entryPrice | src/types/metrics.ts:21 |
| signalDisplay.candidate.slPrice | price | Sinyal gösterim alanı: slPrice | src/types/metrics.ts:23 |
| signalDisplay.candidate.tpPrice | price | Sinyal gösterim alanı: tpPrice | src/types/metrics.ts:22 |
| signalDisplay.confidence | unknown | Sinyal gösterim alanı: confidence | src/types/metrics.ts:18 |
| signalDisplay.score | raw | Sinyal gösterim alanı: score | src/types/metrics.ts:17 |
| signalDisplay.signal | raw | Sinyal gösterim alanı: signal | src/types/metrics.ts:2 |
| signalDisplay.vetoReason | raw | Sinyal gösterim alanı: vetoReason | src/types/metrics.ts:19 |
| snapshot.eventId | unknown | Snapshot metadata alanı: eventId | src/types/metrics.ts:52 |
| snapshot.stateHash | raw | Snapshot metadata alanı: stateHash | src/types/metrics.ts:53 |
| snapshot.ts | unknown | Snapshot metadata alanı: ts | src/types/metrics.ts:54 |
| timeAndSales.aggressiveBuyVolume | raw | Trade tape metriği: aggressiveBuyVolume | src/types/metrics.ts:90 |
| timeAndSales.aggressiveSellVolume | raw | Trade tape metriği: aggressiveSellVolume | src/types/metrics.ts:91 |
| timeAndSales.bidHitAskLiftRatio | price | Trade tape metriği: bidHitAskLiftRatio | src/types/metrics.ts:96 |
| timeAndSales.consecutiveBurst | unknown | Trade tape metriği: consecutiveBurst | src/types/metrics.ts:97 |
| timeAndSales.consecutiveBurst.count | raw | Trade tape metriği: count | src/types/metrics.ts:99 |
| timeAndSales.consecutiveBurst.side | raw | Trade tape metriği: side | src/types/metrics.ts:98 |
| timeAndSales.largeTrades | unknown | Trade tape metriği: largeTrades | src/types/metrics.ts:95 |
| timeAndSales.midTrades | price | Trade tape metriği: midTrades | src/types/metrics.ts:94 |
| timeAndSales.printsPerSecond | unknown | Trade tape metriği: printsPerSecond | src/types/metrics.ts:101 |
| timeAndSales.smallTrades | unknown | Trade tape metriği: smallTrades | src/types/metrics.ts:93 |
| timeAndSales.tradeCount | raw | Trade tape metriği: tradeCount | src/types/metrics.ts:92 |
| toxicityMetrics.burstPersistenceScore | raw | Toxicity metriği: burstPersistenceScore | src/types/metrics.ts:185 |
| toxicityMetrics.priceImpactPerSignedNotional | price | Toxicity metriği: priceImpactPerSignedNotional | src/types/metrics.ts:183 |
| toxicityMetrics.signedVolumeRatio | raw | Toxicity metriği: signedVolumeRatio | src/types/metrics.ts:182 |
| toxicityMetrics.tradeToBookRatio | raw | Toxicity metriği: tradeToBookRatio | src/types/metrics.ts:184 |
| toxicityMetrics.vpinApprox | unknown | Toxicity metriği: vpinApprox | src/types/metrics.ts:181 |

### Payload var ama UI yok

| Metric Path | Unit | Kisa Aciklama | Kaynak |
|---|---|---|---|
| absorption | unknown | Telemetri alanı: absorption | server/index.ts:1723 |
| advancedMetrics.breakoutScore | raw | Özet advanced skor alanı: breakoutScore | server/index.ts:1748 |
| advancedMetrics.sweepFadeScore | raw | Özet advanced skor alanı: sweepFadeScore | server/index.ts:1747 |
| advancedMetrics.volatilityIndex | raw | Özet advanced skor alanı: volatilityIndex | server/index.ts:1749 |
| bestAsk | price | Telemetri alanı: bestAsk | server/index.ts:1760 |
| bestBid | price | Telemetri alanı: bestBid | server/index.ts:1759 |
| crossMarketMetrics | unknown | Cross-market metriği: crossMarketMetrics | server/index.ts:1756 |
| cvd.tf15m.cvd | unknown | CVD metriği: cvd | server/index.ts:1720 |
| cvd.tf15m.delta | raw | CVD metriği: delta | server/index.ts:1720 |
| cvd.tf15m.state | raw | CVD metriği: state | server/index.ts:1720 |
| cvd.tf1m.cvd | unknown | CVD metriği: cvd | server/index.ts:1718 |
| cvd.tf1m.delta | raw | CVD metriği: delta | server/index.ts:1718 |
| cvd.tf1m.state | raw | CVD metriği: state | server/index.ts:1718 |
| cvd.tf5m.cvd | unknown | CVD metriği: cvd | server/index.ts:1719 |
| cvd.tf5m.delta | raw | CVD metriği: delta | server/index.ts:1719 |
| cvd.tf5m.state | raw | CVD metriği: state | server/index.ts:1719 |
| cvd.tradeCounts | raw | CVD metriği: tradeCounts | server/index.ts:1721 |
| derivativesMetrics | unknown | Türev piyasa metriği: derivativesMetrics | server/index.ts:1753 |
| enableCrossMarketConfirmation | unknown | Telemetri alanı: enableCrossMarketConfirmation | server/index.ts:1757 |
| event_time_ms | raw | Telemetri alanı: event_time_ms | server/index.ts:1714 |
| funding | unknown | Funding metriği: funding | server/index.ts:1725 |
| htf.h1 | unknown | HTF ham structure metriği: h1 | server/index.ts:1741 |
| htf.h4 | unknown | HTF ham structure metriği: h4 | server/index.ts:1742 |
| lastUpdateId | unknown | Telemetri alanı: lastUpdateId | server/index.ts:1763 |
| liquidityMetrics | unknown | Likidite metriği: liquidityMetrics | server/index.ts:1751 |
| midPrice | price | Orta fiyat alanı: midPrice | server/index.ts:1762 |
| orderbookIntegrity | unknown | Orderbook integrity alanı: orderbookIntegrity | server/index.ts:1744 |
| passiveFlowMetrics | unknown | Pasif akış metriği: passiveFlowMetrics | server/index.ts:1752 |
| regimeMetrics | unknown | Rejim metriği: regimeMetrics | server/index.ts:1755 |
| signalDisplay | raw | Sinyal gösterim alanı: signalDisplay | server/index.ts:1745 |
| snapshot | unknown | Snapshot metadata alanı: snapshot | server/index.ts:1715 |
| spreadPct | pct | Telemetri alanı: spreadPct | server/index.ts:1761 |
| strategyPosition | unknown | Strateji pozisyon alanı: strategyPosition | server/index.ts:1728 |
| strategyPosition.addsUsed | unknown | Strateji pozisyon alanı: addsUsed | server/index.ts:1734 |
| strategyPosition.entryPrice | price | Strateji pozisyon alanı: entryPrice | server/index.ts:1732 |
| strategyPosition.qty | raw | Strateji pozisyon alanı: qty | server/index.ts:1731 |
| strategyPosition.timeInPositionMs | raw | Strateji pozisyon alanı: timeInPositionMs | server/index.ts:1735 |
| strategyPosition.unrealizedPnlPct | pct | Strateji pozisyon alanı: unrealizedPnlPct | server/index.ts:1733 |
| symbol | unknown | Telemetri alanı: symbol | server/index.ts:1712 |
| timeAndSales | unknown | Trade tape metriği: timeAndSales | server/index.ts:1716 |
| toxicityMetrics | unknown | Toxicity metriği: toxicityMetrics | server/index.ts:1754 |
| type | unknown | Telemetri alanı: type | server/index.ts:1711 |

## 5) Notlar

- Bu envanter metrics.ts + server payload assembly + UI mapping + server/metrics internal state taramasindan otomatik derlenmistir.
- Unit degeri koddan net cikmayan alanlarda "unknown" veya "raw" olarak birakilmistir.
- UI gorunurlugu component bazli oldugu icin route ve breakpoint durumuna gore farklilik gosterebilir.
