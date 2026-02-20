# Live Orderflow Metrics (Selected Pairs)

Bu listede, botun `metrics` websocket payload'unda gelen ve `Live Orderflow Metrics (Selected Pairs)` bolumunde kullanilan/turetilen metric alanlari yer alir.

## UI'da dogrudan gorunen metricler

- `legacyMetrics.price` (Price)
- `openInterest.openInterest` (OI)
- `openInterest.oiChangeAbs` (OI Change Abs)
- `openInterest.oiChangePct` (OI Change %)
- `legacyMetrics.obiWeighted` (OBI 10L / OBI W)
- `legacyMetrics.obiDeep` (OBI 50L / OBI D)
- `legacyMetrics.obiDivergence` (OBI Div)
- `legacyMetrics.deltaZ` (Delta Z)
- `legacyMetrics.cvdSlope` (CVD Slope)
- `signalDisplay.signal` (Signal tipi)
- `signalDisplay.score` (Signal score)
- `signalDisplay.vetoReason` (Signal yoksa veto/metin)
- `aiTrend.side` (Trend LONG/SHORT/NEUTRAL)
- `aiTrend.score` (Trend score)
- `aiTrend.intact` (Trend gecerlilik durumu)

## Expanded/Mobile kartlarda gorunen ek orderflow metricler

- `timeAndSales.aggressiveBuyVolume`
- `timeAndSales.aggressiveSellVolume`
- `timeAndSales.tradeCount`
- `timeAndSales.smallTrades`
- `timeAndSales.midTrades`
- `timeAndSales.largeTrades`
- `timeAndSales.bidHitAskLiftRatio`
- `timeAndSales.consecutiveBurst.side`
- `timeAndSales.consecutiveBurst.count`
- `timeAndSales.printsPerSecond`
- `cvd.tf1m.cvd`
- `cvd.tf1m.delta`
- `cvd.tf1m.state`
- `cvd.tf5m.cvd`
- `cvd.tf5m.delta`
- `cvd.tf5m.state`
- `cvd.tf15m.cvd`
- `cvd.tf15m.delta`
- `cvd.tf15m.state`
- `legacyMetrics.delta1s`
- `legacyMetrics.delta5s`
- `legacyMetrics.cvdSession`
- `legacyMetrics.vwap`
- `absorption`
- `funding.rate`
- `funding.timeToFundingMs`
- `funding.trend`

## Payload'da bulunan, UI'da her zaman gorunmeyebilen (gizli/yardimci) metricler

- `openInterest.oiDeltaWindow`
- `openInterest.lastUpdated`
- `openInterest.source`
- `openInterest.stabilityMsg`
- `funding.source`
- `aiTrend.ageMs`
- `aiTrend.breakConfirm`
- `aiTrend.source`
- `legacyMetrics.totalVolume`
- `legacyMetrics.totalNotional`
- `legacyMetrics.tradeCount`
- `advancedMetrics.sweepFadeScore`
- `advancedMetrics.breakoutScore`
- `advancedMetrics.volatilityIndex`
- `cvd.tradeCounts`
- `bestBid`
- `bestAsk`
- `spreadPct`
- `midPrice`
- `lastUpdateId`
- `orderbookIntegrity.level`
- `orderbookIntegrity.message`
- `orderbookIntegrity.lastUpdateTimestamp`
- `orderbookIntegrity.sequenceGapCount`
- `orderbookIntegrity.crossedBookDetected`
- `orderbookIntegrity.avgStalenessMs`
- `orderbookIntegrity.reconnectCount`
- `orderbookIntegrity.reconnectRecommended`
- `snapshot.eventId`
- `snapshot.stateHash`
- `snapshot.ts`
- `event_time_ms`

## Ham orderbook alanlari

- `bids` (top seviyeler)
- `asks` (top seviyeler)
