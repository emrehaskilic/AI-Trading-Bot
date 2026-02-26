from __future__ import annotations

from datetime import datetime
from html import escape
from pathlib import Path
import re

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

ROOT = Path(r"c:\Users\emrehaskilic\Desktop\kımı\AI-Trading-Bot")
OUT = Path(r"c:\Users\emrehaskilic\Desktop\AI_Trading_Bot_Metrik_Envanteri.pdf")

styles = getSampleStyleSheet()
style_title = ParagraphStyle(
    "TitleCustom",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=18,
    leading=22,
    spaceAfter=10,
)
style_h1 = ParagraphStyle(
    "H1",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=12,
    leading=14,
    spaceBefore=8,
    spaceAfter=4,
)
style_h2 = ParagraphStyle(
    "H2",
    parent=styles["Heading3"],
    fontName="Helvetica-Bold",
    fontSize=10,
    leading=12,
    spaceBefore=6,
    spaceAfter=2,
)
style_body = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8.8,
    leading=11,
    spaceAfter=2,
)
style_code = ParagraphStyle(
    "Code",
    parent=styles["BodyText"],
    fontName="Courier",
    fontSize=8.2,
    leading=10,
    spaceAfter=2,
)

story = []


def p(text: str, style=style_body):
    story.append(Paragraph(escape(text), style))


def bullets(items: list[str], style=style_body):
    for item in items:
        story.append(Paragraph(f"- {escape(item)}", style))
    story.append(Spacer(1, 2.2 * mm))


story.append(Paragraph("AI Trading Bot - Metrik Envanteri", style_title))
p(f"Uretim tarihi: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
p("Kapsam: Live Orderflow Metrics + Volume Analysis + CVD + Advanced Microstructure + UI'da gorunmeyen tum karar/pipeline metrikleri.")
story.append(Spacer(1, 2 * mm))

story.append(Paragraph("Kaynak Dosyalar", style_h1))
bullets([
    "src/types/metrics.ts",
    "src/components/SymbolRow.tsx",
    "src/components/sections/OpenInterestSection.tsx",
    "src/components/MobileSymbolCard.tsx",
    "src/components/panels/LeftStatsPanel.tsx",
    "src/components/panels/RightStatsPanel.tsx",
    "server/index.ts",
    "server/ai/types.ts",
    "server/ai/StateExtractor.ts",
    "server/metrics/AdvancedMicrostructureMetrics.ts",
], style=style_code)

story.append(Paragraph("1) UI'da Gorunen Metrikler", style_h1))

story.append(Paragraph("1.1 Live Orderflow Metrics (Selected Pairs)", style_h2))
bullets([
    "symbol",
    "state",
    "legacyMetrics.price",
    "legacyMetrics.obiWeighted",
    "legacyMetrics.obiDeep",
    "legacyMetrics.obiDivergence",
    "legacyMetrics.deltaZ",
    "legacyMetrics.cvdSlope",
    "openInterest.openInterest",
    "openInterest.oiChangeAbs",
    "openInterest.oiChangePct",
    "aiTrend.side",
    "aiTrend.score",
    "aiTrend.intact",
    "aiTrend.ageMs",
    "aiTrend.breakConfirm",
    "aiBias.side",
    "aiBias.confidence",
    "aiBias.source",
    "aiBias.lockedByPosition",
    "aiBias.breakConfirm",
    "aiBias.reason",
    "strategyPosition.side",
    "strategyPosition.qty",
    "strategyPosition.entryPrice",
    "strategyPosition.unrealizedPnlPct",
    "strategyPosition.addsUsed",
    "strategyPosition.timeInPositionMs",
    "snapshot.stateHash",
    "snapshot.eventId",
])

story.append(Paragraph("1.2 Volume Analysis", style_h2))
bullets([
    "timeAndSales.aggressiveBuyVolume",
    "timeAndSales.aggressiveSellVolume",
    "timeAndSales.smallTrades",
    "timeAndSales.midTrades",
    "timeAndSales.largeTrades",
    "timeAndSales.tradeCount",
    "timeAndSales.printsPerSecond",
    "timeAndSales.bidHitAskLiftRatio",
    "timeAndSales.consecutiveBurst.side",
    "timeAndSales.consecutiveBurst.count",
])

story.append(Paragraph("1.3 Orderflow Dynamics (CVD)", style_h2))
bullets([
    "cvd.tf1m.cvd",
    "cvd.tf1m.delta",
    "cvd.tf1m.state",
    "cvd.tf5m.cvd",
    "cvd.tf5m.delta",
    "cvd.tf5m.state",
    "cvd.tf15m.cvd",
    "cvd.tf15m.delta",
    "cvd.tf15m.state",
    "advancedMetrics.volatilityIndex (CVD panelde ATR etiketi)",
])

story.append(Paragraph("1.4 Advanced Microstructure", style_h2))
p("Liquidity")
bullets([
    "liquidityMetrics.microPrice",
    "liquidityMetrics.liquidityWallScore",
    "liquidityMetrics.voidGapScore",
    "liquidityMetrics.bookConvexity",
    "liquidityMetrics.expectedSlippageBuy",
    "liquidityMetrics.expectedSlippageSell",
    "liquidityMetrics.resiliencyMs",
    "liquidityMetrics.effectiveSpread",
])
p("Passive Flow")
bullets([
    "passiveFlowMetrics.bidAddRate",
    "passiveFlowMetrics.askAddRate",
    "passiveFlowMetrics.bidCancelRate",
    "passiveFlowMetrics.askCancelRate",
    "passiveFlowMetrics.spoofScore",
    "passiveFlowMetrics.refreshRate",
])
p("Derivatives")
bullets([
    "derivativesMetrics.markLastDeviationPct",
    "derivativesMetrics.indexLastDeviationPct",
    "derivativesMetrics.perpBasis",
    "derivativesMetrics.perpBasisZScore",
    "derivativesMetrics.liquidationProxyScore",
])
p("Toxicity")
bullets([
    "toxicityMetrics.vpinApprox",
    "toxicityMetrics.signedVolumeRatio",
    "toxicityMetrics.priceImpactPerSignedNotional",
    "toxicityMetrics.tradeToBookRatio",
    "toxicityMetrics.burstPersistenceScore",
])
p("Regime")
bullets([
    "regimeMetrics.realizedVol1m",
    "regimeMetrics.realizedVol5m",
    "regimeMetrics.realizedVol15m",
    "regimeMetrics.volOfVol",
    "regimeMetrics.chopScore",
    "regimeMetrics.trendinessScore",
])
p("Cross Market")
bullets([
    "enableCrossMarketConfirmation",
    "crossMarketMetrics.spotPerpDivergence",
    "crossMarketMetrics.betaToBTC",
    "crossMarketMetrics.betaToETH",
    "crossMarketMetrics.crossVenueImbalanceDiff",
])

story.append(Paragraph("1.5 Diger UI panellerinde gorunenler", style_h2))
bullets([
    "signalDisplay.signal",
    "signalDisplay.score",
    "signalDisplay.vetoReason",
    "signalDisplay.candidate.entryPrice",
    "signalDisplay.candidate.tpPrice",
    "openInterest.stabilityMsg",
    "funding.rate",
    "funding.timeToFundingMs",
    "funding.trend",
    "absorption",
    "bids / asks / midPrice (OrderBook)",
])

story.append(PageBreak())
story.append(Paragraph("2) UI'da Dogrudan Gorunmeyen Ama Payload'da Olan Metrikler", style_h1))

story.append(Paragraph("2.1 Legacy / Trade / CVD icinde gizli kalan alanlar", style_h2))
bullets([
    "legacyMetrics.delta1s",
    "legacyMetrics.delta5s",
    "legacyMetrics.cvdSession",
    "legacyMetrics.vwap",
    "legacyMetrics.totalVolume",
    "legacyMetrics.totalNotional",
    "legacyMetrics.tradeCount",
    "openInterest.oiDeltaWindow",
    "openInterest.lastUpdated",
    "openInterest.source",
    "funding.source",
    "funding.markPrice",
    "funding.indexPrice",
    "cvd.tradeCounts (server payload extra)",
])

story.append(Paragraph("2.2 Advanced Microstructure gizli alanlar", style_h2))
bullets([
    "liquidityMetrics.imbalanceCurve.level1",
    "liquidityMetrics.imbalanceCurve.level5",
    "liquidityMetrics.imbalanceCurve.level10",
    "liquidityMetrics.imbalanceCurve.level20",
    "liquidityMetrics.imbalanceCurve.level50",
    "liquidityMetrics.bookSlopeBid",
    "liquidityMetrics.bookSlopeAsk",
    "liquidityMetrics.realizedSpreadShortWindow",
    "passiveFlowMetrics.depthDeltaDecomposition.addVolume",
    "passiveFlowMetrics.depthDeltaDecomposition.cancelVolume",
    "passiveFlowMetrics.depthDeltaDecomposition.tradeRelatedVolume",
    "passiveFlowMetrics.depthDeltaDecomposition.netDepthDelta",
    "passiveFlowMetrics.queueDeltaBestBid",
    "passiveFlowMetrics.queueDeltaBestAsk",
    "regimeMetrics.microATR",
])

story.append(Paragraph("2.3 Signal / Integrity / Transport gizli alanlar", style_h2))
bullets([
    "signalDisplay.confidence",
    "signalDisplay.candidate.slPrice",
    "signalDisplay.boost.score",
    "signalDisplay.boost.contributions",
    "signalDisplay.boost.timeframeMultipliers",
    "signalDisplay.regime (server payload extra)",
    "signalDisplay.dfsPercentile (server payload extra)",
    "signalDisplay.actions[] (server payload extra)",
    "signalDisplay.reasons[] (server payload extra)",
    "signalDisplay.gatePassed (server payload extra)",
    "orderbookIntegrity.level",
    "orderbookIntegrity.message",
    "orderbookIntegrity.lastUpdateTimestamp",
    "orderbookIntegrity.sequenceGapCount",
    "orderbookIntegrity.crossedBookDetected",
    "orderbookIntegrity.avgStalenessMs",
    "orderbookIntegrity.reconnectCount",
    "orderbookIntegrity.reconnectRecommended",
    "event_time_ms (payload extra)",
    "bestBid (payload extra)",
    "bestAsk (payload extra)",
    "spreadPct (payload extra)",
    "advancedMetrics.sweepFadeScore",
    "advancedMetrics.breakoutScore",
])

story.append(Paragraph("3) AI Dry Run / LLM Karar Pipeline Metrikleri (UI hidden)", style_h1))

story.append(Paragraph("3.1 AIMetricsSnapshot", style_h2))
bullets([
    "decision.regime",
    "decision.dfs",
    "decision.dfsPercentile",
    "decision.volLevel",
    "decision.gatePassed",
    "decision.thresholds.longEntry",
    "decision.thresholds.longBreak",
    "decision.thresholds.shortEntry",
    "decision.thresholds.shortBreak",
    "blockedReasons[]",
    "riskState.equity",
    "riskState.leverage",
    "riskState.startingMarginUser",
    "riskState.marginInUse",
    "riskState.drawdownPct",
    "riskState.dailyLossLock",
    "riskState.cooldownMsRemaining",
    "riskState.marginHealth",
    "riskState.maintenanceMarginRatio",
    "riskState.liquidationProximityPct",
    "executionState.lastAction",
    "executionState.holdStreak",
    "executionState.lastAddMsAgo",
    "executionState.lastFlipMsAgo",
    "executionState.winnerStopArmed",
    "executionState.winnerStopType",
    "executionState.winnerStopPrice",
    "executionState.winnerRMultiple",
    "executionState.trendBias",
    "executionState.trendStrength",
    "executionState.trendIntact",
    "executionState.trendAgeMs",
    "executionState.trendBreakConfirm",
    "executionState.lastTrendTakeProfitMsAgo",
    "executionState.bootstrapPhaseMsRemaining",
    "executionState.bootstrapSeedStrength",
    "executionState.bootstrapWarmupMsRemaining",
    "market.price",
    "market.vwap",
    "market.spreadPct",
    "market.delta1s",
    "market.delta5s",
    "market.deltaZ",
    "market.cvdSlope",
    "market.obiWeighted",
    "market.obiDeep",
    "market.obiDivergence",
    "trades.printsPerSecond",
    "trades.tradeCount",
    "trades.aggressiveBuyVolume",
    "trades.aggressiveSellVolume",
    "trades.burstCount",
    "trades.burstSide",
    "openInterest.oiChangePct",
    "absorption.value",
    "absorption.side",
    "volatility",
    "position.side",
    "position.qty",
    "position.entryPrice",
    "position.unrealizedPnlPct",
    "position.addsUsed",
    "position.timeInPositionMs",
])

story.append(Paragraph("3.2 StateExtractor ciktilari (DeterministicStateSnapshot)", style_h2))
bullets([
    "flowState",
    "regimeState",
    "derivativesState",
    "toxicityState",
    "executionState",
    "stateConfidence",
    "directionalBias",
    "cvdSlopeSign",
    "oiDirection",
    "volatilityPercentile",
    "expectedSlippageBps",
    "spreadBps",
])

story.append(Paragraph("3.3 AI durum/telemetry metrikleri", style_h2))
bullets([
    "AIDecisionTelemetry.invalidLLMResponses",
    "AIDecisionTelemetry.repairCalls",
    "AIDecisionTelemetry.guardrailBlocks",
    "AIDecisionTelemetry.forcedExits",
    "AIDecisionTelemetry.flipsCount",
    "AIDecisionTelemetry.addsCount",
    "AIDecisionTelemetry.probeEntries",
    "AIDecisionTelemetry.edgeFilteredEntries",
    "AIDecisionTelemetry.holdOverrides",
    "AIDecisionTelemetry.avgHoldTimeMs",
    "AIDecisionTelemetry.feePct",
    "AIDryRunStatus.performance.samples",
    "AIDryRunStatus.performance.winRate",
    "AIDryRunStatus.performance.avgOutcome",
    "AIDryRunStatus.performance.avgWin",
    "AIDryRunStatus.performance.avgLoss",
    "AIDryRunStatus.performance.profitFactor",
])

story.append(PageBreak())
story.append(Paragraph("4) AdvancedMicrostructure Internal (UI ve payload disi hesap metrikleri)", style_h1))

adv_file = ROOT / "server" / "metrics" / "AdvancedMicrostructureMetrics.ts"
text = adv_file.read_text(encoding="utf-8")
private_names = re.findall(r"private\s+(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)", text)
# order-preserving unique
seen = set()
private_unique = []
for name in private_names:
    if name in seen:
        continue
    seen.add(name)
    private_unique.append(name)

p("Asagidaki alanlar sinif ici hesaplama/buffer metrikleridir; cogu UI'ya dogrudan cizilmez.")
bullets([f"AdvancedMicrostructureMetrics.{n}" for n in private_unique], style=style_code)

story.append(Paragraph("5) Not", style_h1))
p("Bu envanter kod tabanindaki mevcut alan adlarina gore derlenmistir. UI'da hangi alanin gosterildigi ekrana/komponente gore degisebilir.")
p("Referans commit klasoru: AI-Trading-Bot (local workspace)")

doc = SimpleDocTemplate(
    str(OUT),
    pagesize=A4,
    leftMargin=14 * mm,
    rightMargin=14 * mm,
    topMargin=12 * mm,
    bottomMargin=12 * mm,
    title="AI Trading Bot Metrik Envanteri",
)
doc.build(story)
print(str(OUT))
