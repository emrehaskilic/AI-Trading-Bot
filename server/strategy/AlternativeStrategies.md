# Alternative Trading Strategies - AI Trading Bot

## Overview
This document presents 4 alternative trading strategies based on the existing AI Trading Bot codebase components:
- DirectionalFlowScore (8-component scoring system)
- RegimeSelector (TR/MR/EV regime detection)
- NormalizationStore (Rolling statistics)
- Risk Guards (Complete risk management)

---

## Strategy 1: Orderflow Momentum Strategy

### Concept
Focuses on aggressive orderflow confirmation through deltaZ (price momentum), CVD slope (trend confirmation), and OBI alignment (orderbook confirmation). This strategy captures strong directional moves confirmed by multiple orderflow dimensions.

### Logic
```pseudocode
CLASS OrderflowMomentumStrategy
  
  INITIALIZE:
    norm = NormalizationStore(windowMs=5min)
    dfs = DirectionalFlowScore(norm, customWeights)
    riskEngine = InstitutionalRiskEngine(config)
    
    // State tracking
    position = null
    entryDfs = 0
    entryTimestamp = 0
    consecutiveConfirmations = 0
  
  METHOD evaluate(input):
    
    // 1. Compute DFS with momentum-focused weights
    dfsOut = dfs.compute(input, MOMENTUM_WEIGHTS)
    
    // 2. Calculate component alignment score
    alignment = calculateAlignment(input, dfsOut)
    
    // 3. Check for entry conditions
    IF position == null:
      entrySignal = checkEntry(input, dfsOut, alignment)
      IF entrySignal.valid:
        position = entrySignal.side
        entryDfs = dfsOut.dfs
        entryTimestamp = input.nowMs
        RETURN ENTRY_ACTION(entrySignal.side)
    
    // 4. Check for exit conditions
    ELSE:
      exitSignal = checkExit(input, dfsOut, alignment, position)
      IF exitSignal.valid:
        position = null
        RETURN EXIT_ACTION(position.side)
    
    RETURN NOOP

  METHOD calculateAlignment(input, dfsOut):
    // Component directional agreement
    deltaDirection = SIGN(input.deltaZ)
    cvdDirection = SIGN(input.cvdSlope)
    obiDirection = SIGN(input.obiDeep)
    dfsDirection = SIGN(dfsOut.dfs)
    
    // Count aligned components
    aligned = 0
    IF deltaDirection == dfsDirection: aligned += 1
    IF cvdDirection == dfsDirection: aligned += 1
    IF obiDirection == dfsDirection: aligned += 1
    
    // Return alignment score (0-3)
    RETURN aligned

  METHOD checkEntry(input, dfsOut, alignment):
    
    // Long entry conditions
    IF dfsOut.dfsPercentile >= entryThresholdLong 
       AND alignment >= minAlignment
       AND input.cvdSlope > cvdMinSlope
       AND input.obiDeep > obiMinThreshold
       AND input.deltaZ > deltaMinThreshold:
      
      // Additional confirmation: consecutive strong readings
      IF dfsOut.dfsPercentile >= confirmationThreshold:
        consecutiveConfirmations += 1
      ELSE:
        consecutiveConfirmations = 0
      
      IF consecutiveConfirmations >= minConsecutive:
        RETURN {valid: true, side: 'LONG'}
    
    // Short entry conditions (mirrored)
    IF dfsOut.dfsPercentile <= entryThresholdShort
       AND alignment >= minAlignment
       AND input.cvdSlope < -cvdMinSlope
       AND input.obiDeep < -obiMinThreshold
       AND input.deltaZ < -deltaMinThreshold:
      
      IF dfsOut.dfsPercentile <= (1 - confirmationThreshold):
        consecutiveConfirmations += 1
      ELSE:
        consecutiveConfirmations = 0
      
      IF consecutiveConfirmations >= minConsecutive:
        RETURN {valid: true, side: 'SHORT'}
    
    consecutiveConfirmations = 0
    RETURN {valid: false}

  METHOD checkExit(input, dfsOut, alignment, position):
    
    timeInTrade = input.nowMs - entryTimestamp
    
    // Time-based exit
    IF timeInTrade >= maxHoldTimeMs:
      RETURN {valid: true, reason: 'TIME_EXIT'}
    
    // Momentum reversal exit
    IF position.side == 'LONG':
      IF dfsOut.dfsPercentile <= exitThresholdLong:
        RETURN {valid: true, reason: 'MOMENTUM_REVERSAL'}
      IF alignment == 0 AND dfsOut.dfsPercentile <= 0.4:
        RETURN {valid: true, reason: 'ALIGNMENT_BREAKDOWN'}
    
    IF position.side == 'SHORT':
      IF dfsOut.dfsPercentile >= exitThresholdShort:
        RETURN {valid: true, reason: 'MOMENTUM_REVERSAL'}
      IF alignment == 0 AND dfsOut.dfsPercentile >= 0.6:
        RETURN {valid: true, reason: 'ALIGNMENT_BREAKDOWN'}
    
    RETURN {valid: false}
```

### Entry Rules
1. **DFS Threshold**: dfsPercentile >= 0.85 (long) or <= 0.15 (short)
2. **Component Alignment**: At least 2 of 3 components (deltaZ, cvdSlope, obiDeep) must align with signal direction
3. **CVD Confirmation**: cvdSlope > 0.5 (long) or < -0.5 (short) in z-score terms
4. **OBI Confirmation**: obiDeep > 0.3 (long) or < -0.3 (short)
5. **Delta Confirmation**: deltaZ > 1.0 (long) or < -1.0 (short)
6. **Consecutive Confirmation**: 2+ consecutive strong readings for entry

### Exit Rules
1. **Momentum Reversal**: dfsPercentile crosses below 0.35 (long) or above 0.65 (short)
2. **Alignment Breakdown**: All 3 components disagree with position direction
3. **Time Exit**: Maximum hold time of 5 minutes
4. **Hard Stop**: 1.5% adverse move from entry

### Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| entryThresholdLong | 0.85 | 0.75-0.95 | DFS percentile for long entry |
| entryThresholdShort | 0.15 | 0.05-0.25 | DFS percentile for short entry |
| exitThresholdLong | 0.35 | 0.25-0.45 | DFS percentile to exit long |
| exitThresholdShort | 0.65 | 0.55-0.75 | DFS percentile to exit short |
| minAlignment | 2 | 2-3 | Minimum aligned components |
| cvdMinSlope | 0.5 | 0.3-1.0 | Minimum CVD slope z-score |
| obiMinThreshold | 0.3 | 0.2-0.5 | Minimum OBI threshold |
| deltaMinThreshold | 1.0 | 0.5-2.0 | Minimum delta z-score |
| confirmationThreshold | 0.90 | 0.85-0.95 | Strong reading threshold |
| minConsecutive | 2 | 1-3 | Required consecutive confirmations |
| maxHoldTimeMs | 300000 | 180000-600000 | Maximum position hold time |

### Custom DFS Weights
```typescript
const MOMENTUM_WEIGHTS = {
  w1: 0.30,  // deltaZ (increased for momentum focus)
  w2: 0.25,  // cvdSlope (increased for trend confirmation)
  w3: 0.15,  // logP
  w4: 0.10,  // obiWeighted
  w5: 0.12,  // obiDeep
  w6: 0.05,  // sweepSigned
  w7: 0.03,  // burstSigned
  w8: 0.00,  // oiImpulse (removed for pure orderflow)
};
```

### Advantages
1. **High Confirmation**: Multiple component alignment reduces false signals
2. **Trend Following**: CVD slope ensures entry in direction of established flow
3. **Quick Exits**: Clear exit rules prevent holding through reversals
4. **Adaptable**: Parameters can be tuned for different volatility regimes

### Risks
1. **Lag Risk**: Waiting for alignment may cause late entry
2. **Whipsaw Risk**: Choppy markets can trigger multiple false signals
3. **Concentration Risk**: Heavy reliance on orderflow may miss price-led moves
4. **Slippage Risk**: High confirmation requirements may lead to worse fills

---

## Strategy 2: Liquidity Imbalance Strategy

### Concept
Exploits extreme orderbook imbalances (obiDeep, obiWeighted) as leading indicators of price movement. When liquidity is significantly skewed to one side, price tends to move toward the thinner side.

### Logic
```pseudocode
CLASS LiquidityImbalanceStrategy
  
  INITIALIZE:
    norm = NormalizationStore(windowMs=3min)
    imbalanceHistory = CircularBuffer(size=20)
    position = null
    entryImbalance = 0
    entrySide = null
    extremeCount = 0
  
  METHOD evaluate(input):
    
    // 1. Calculate composite imbalance score
    imbalanceScore = calculateImbalanceScore(input)
    imbalanceHistory.push(imbalanceScore)
    
    // 2. Update normalization
    norm.update('imbalance', imbalanceScore, input.nowMs)
    norm.update('obiDeep', input.obiDeep, input.nowMs)
    norm.update('obiWeighted', input.obiWeighted, input.nowMs)
    
    // 3. Calculate percentiles
    imbalanceP = norm.percentile('imbalance', imbalanceScore)
    obiDeepP = norm.percentile('obiDeep', input.obiDeep)
    obiWeightedP = norm.percentile('obiWeighted', input.obiWeighted)
    
    // 4. Check entry
    IF position == null:
      entrySignal = checkImbalanceEntry(imbalanceScore, imbalanceP, 
                                        obiDeepP, obiWeightedP, input)
      IF entrySignal.valid:
        position = entrySignal.side
        entryImbalance = imbalanceScore
        entrySide = entrySignal.side
        extremeCount = 0
        RETURN ENTRY_ACTION(entrySignal.side)
    
    // 5. Check exit
    ELSE:
      exitSignal = checkImbalanceExit(imbalanceScore, imbalanceP, input)
      IF exitSignal.valid:
        position = null
        RETURN EXIT_ACTION(entrySide)
    
    RETURN NOOP

  METHOD calculateImbalanceScore(input):
    // Weighted combination of OBI metrics
    deepWeight = 0.6
    weightedWeight = 0.4
    
    score = (deepWeight * input.obiDeep) + (weightedWeight * input.obiWeighted)
    
    // Boost score if both metrics agree
    IF SIGN(input.obiDeep) == SIGN(input.obiWeighted):
      score = score * 1.2
    
    RETURN score

  METHOD checkImbalanceEntry(score, scoreP, obiDeepP, obiWeightedP, input):
    
    // Extreme buy imbalance -> expect price up (long)
    IF score >= extremeLongThreshold 
       AND scoreP >= extremePercentile
       AND obiDeepP >= obiConfirmPercentile
       AND obiWeightedP >= obiConfirmPercentile:
      
      // Check for mean reversion warning (don't chase too far)
      IF input.price > input.vwap * 1.005:
        RETURN {valid: false, reason: 'OVER_EXTENDED'}
      
      // Require confirmation from recent history
      recentExtremes = countRecentExtremes('buy')
      IF recentExtremes >= minExtremeCount:
        RETURN {valid: true, side: 'LONG'}
    
    // Extreme sell imbalance -> expect price down (short)
    IF score <= -extremeShortThreshold
       AND scoreP <= (1 - extremePercentile)
       AND obiDeepP <= (1 - obiConfirmPercentile)
       AND obiWeightedP <= (1 - obiConfirmPercentile):
      
      IF input.price < input.vwap * 0.995:
        RETURN {valid: false, reason: 'OVER_EXTENDED'}
      
      recentExtremes = countRecentExtremes('sell')
      IF recentExtremes >= minExtremeCount:
        RETURN {valid: true, side: 'SHORT'}
    
    RETURN {valid: false}

  METHOD checkImbalanceExit(score, scoreP, input):
    
    // Normalization exit
    IF entrySide == 'LONG':
      IF score <= normalizationThreshold OR scoreP <= 0.55:
        RETURN {valid: true, reason: 'IMBALANCE_NORMALIZED'}
    
    IF entrySide == 'SHORT':
      IF score >= -normalizationThreshold OR scoreP >= 0.45:
        RETURN {valid: true, reason: 'IMBALANCE_NORMALIZED'}
    
    // Time decay exit
    timeHeld = input.nowMs - entryTimestamp
    IF timeHeld > maxHoldTimeMs:
      RETURN {valid: true, reason: 'TIME_DECAY'}
    
    // VWAP rejection exit
    IF entrySide == 'LONG' AND input.price < input.vwap * 0.998:
      RETURN {valid: true, reason: 'VWAP_REJECTION'}
    IF entrySide == 'SHORT' AND input.price > input.vwap * 1.002:
      RETURN {valid: true, reason: 'VWAP_REJECTION'}
    
    RETURN {valid: false}

  METHOD countRecentExtremes(side):
    count = 0
    FOR each score IN imbalanceHistory:
      IF side == 'buy' AND score >= extremeLongThreshold:
        count += 1
      IF side == 'sell' AND score <= -extremeShortThreshold:
        count += 1
    RETURN count
```

### Entry Rules
1. **Extreme Imbalance**: Composite score >= 0.8 (long) or <= -0.8 (short)
2. **Percentile Confirmation**: Score at 90th+ percentile (long) or 10th- percentile (short)
3. **Dual OBI Confirmation**: Both obiDeep and obiWeighted at extremes
4. **Not Over-Extended**: Price within 0.5% of VWAP (avoid chasing)
5. **Sustained Imbalance**: 3+ recent extreme readings in history

### Exit Rules
1. **Normalization Exit**: Score returns to neutral zone (|score| < 0.3)
2. **Percentile Exit**: Score percentile below 55% (long) or above 45% (short)
3. **Time Decay**: Maximum hold time of 3 minutes
4. **VWAP Rejection**: Price crosses VWAP in adverse direction

### Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| extremeLongThreshold | 0.8 | 0.6-1.0 | Imbalance score for long entry |
| extremeShortThreshold | 0.8 | 0.6-1.0 | Imbalance score for short entry |
| extremePercentile | 0.90 | 0.85-0.95 | Required percentile for extreme |
| obiConfirmPercentile | 0.85 | 0.75-0.90 | OBI confirmation threshold |
| normalizationThreshold | 0.3 | 0.2-0.5 | Exit when imbalance normalizes |
| minExtremeCount | 3 | 2-5 | Required recent extreme readings |
| maxHoldTimeMs | 180000 | 120000-300000 | Maximum hold time |
| vwapRejectionPct | 0.002 | 0.001-0.005 | VWAP rejection threshold |

### Advantages
1. **Leading Indicator**: OBI often leads price movement
2. **Clear Signals**: Extreme imbalances are objectively measurable
3. **Mean Reversion**: Natural exit when imbalance corrects
4. **Low Correlation**: Different signal source from price-based strategies

### Risks
1. **Fake Imbalances**: Large orders may be placed to mislead
2. **Iceberg Risk**: Hidden liquidity not visible in orderbook
3. **Flash Events**: Sudden imbalances can reverse quickly
4. **Stale Data**: Orderbook can change faster than sampling rate

---

## Strategy 3: VWAP Mean Reversion Strategy

### Concept
Capitalizes on price deviations from VWAP (Volume Weighted Average Price), assuming price tends to revert to this fair value benchmark. Uses deviation percentiles to identify extreme moves and orderflow confirmation for entry timing.

### Logic
```pseudocode
CLASS VWAPMeanReversionStrategy
  
  INITIALIZE:
    norm = NormalizationStore(windowMs=10min)
    deviationHistory = CircularBuffer(size=50)
    position = null
    entryDeviation = 0
    entryPrice = 0
    vwapTouchCount = 0
  
  METHOD evaluate(input):
    
    // 1. Calculate VWAP deviation
    deviation = input.price - input.market.vwap
    deviationPct = deviation / input.market.vwap
    
    // 2. Update normalization
    norm.update('deviation', deviation, input.nowMs)
    norm.update('deviationPct', deviationPct, input.nowMs)
    norm.update('absDeviation', Math.abs(deviation), input.nowMs)
    
    // 3. Calculate percentiles
    deviationP = norm.percentile('deviation', deviation)
    absDeviationP = norm.percentile('absDeviation', Math.abs(deviation))
    
    // 4. Track VWAP touches
    updateVWAPTouchCount(input.price, input.market.vwap)
    
    // 5. Check entry
    IF position == null:
      entrySignal = checkMeanRevEntry(input, deviation, deviationPct, 
                                      deviationP, absDeviationP)
      IF entrySignal.valid:
        position = entrySignal.side
        entryDeviation = deviation
        entryPrice = input.price
        vwapTouchCount = 0
        RETURN ENTRY_ACTION(entrySignal.side)
    
    // 6. Check exit
    ELSE:
      exitSignal = checkMeanRevExit(input, deviation, deviationP)
      IF exitSignal.valid:
        position = null
        RETURN EXIT_ACTION(position.side)
    
    RETURN NOOP

  METHOD checkMeanRevEntry(input, deviation, deviationPct, deviationP, absDeviationP):
    
    // Long entry: price significantly below VWAP
    IF deviation < 0 AND absDeviationP >= deviationPercentileThreshold:
      
      // Check for reversal confirmation
      reversalConfirm = checkReversalConfirmation(input, 'LONG')
      
      // Check delta improving (becoming less negative)
      deltaImproving = input.deltaZ > previousDeltaZ
      
      // Check CVD stabilizing or turning up
      cvdStabilizing = input.cvdSlope > -0.3  // Not strongly falling
      
      IF reversalConfirm AND deltaImproving AND cvdStabilizing:
        
        // Additional: check for absorption at lows
        absorptionOk = input.absorption?.side == 'buy' OR 
                       input.absorption?.value > absorptionThreshold
        
        IF absorptionOk:
          RETURN {valid: true, side: 'LONG'}
    
    // Short entry: price significantly above VWAP
    IF deviation > 0 AND absDeviationP >= deviationPercentileThreshold:
      
      reversalConfirm = checkReversalConfirmation(input, 'SHORT')
      deltaImproving = input.deltaZ < previousDeltaZ
      cvdStabilizing = input.cvdSlope < 0.3
      
      IF reversalConfirm AND deltaImproving AND cvdStabilizing:
        
        absorptionOk = input.absorption?.side == 'sell' OR 
                       input.absorption?.value > absorptionThreshold
        
        IF absorptionOk:
          RETURN {valid: true, side: 'SHORT'}
    
    RETURN {valid: false}

  METHOD checkReversalConfirmation(input, side):
    
    // Price action reversal patterns
    price = input.price
    prevPrice = previousPrice
    
    IF side == 'LONG':
      // Hammer-like pattern or bullish engulfing
      IF price > prevPrice AND (price - input.market.vwap) > (prevPrice - input.market.vwap):
        RETURN true
    
    IF side == 'SHORT':
      // Shooting star or bearish engulfing
      IF price < prevPrice AND (price - input.market.vwap) < (prevPrice - input.market.vwap):
        RETURN true
    
    RETURN false

  METHOD checkMeanRevExit(input, deviation, deviationP):
    
    // Target exit: return to VWAP
    IF Math.abs(deviation) < vwapProximityThreshold:
      RETURN {valid: true, reason: 'VWAP_TARGET_HIT'}
    
    // Percentile-based exit: deviation normalized
    IF position.side == 'LONG' AND deviationP >= 0.45:
      RETURN {valid: true, reason: 'DEVIATION_NORMALIZED'}
    IF position.side == 'SHORT' AND deviationP <= 0.55:
      RETURN {valid: true, reason: 'DEVIATION_NORMALIZED'}
    
    // Time-based exit
    timeHeld = input.nowMs - entryTimestamp
    IF timeHeld > maxHoldTimeMs:
      RETURN {valid: true, reason: 'TIME_EXIT'}
    
    // Stop loss: deviation extended further
    IF position.side == 'LONG' AND deviation < entryDeviation * 1.5:
      RETURN {valid: true, reason: 'STOP_LOSS'}
    IF position.side == 'SHORT' AND deviation > entryDeviation * 1.5:
      RETURN {valid: true, reason: 'STOP_LOSS'}
    
    // Trailing exit: deviation improved significantly
    improvement = Math.abs(entryDeviation) - Math.abs(deviation)
    IF improvement > trailingTakeProfit * Math.abs(entryDeviation):
      RETURN {valid: true, reason: 'TRAILING_PROFIT'}
    
    RETURN {valid: false}

  METHOD updateVWAPTouchCount(price, vwap):
    IF Math.abs(price - vwap) < vwapProximityThreshold:
      vwapTouchCount += 1
    ELSE:
      vwapTouchCount = 0
```

### Entry Rules
1. **Deviation Threshold**: Price at 85th+ percentile away from VWAP
2. **Reversal Confirmation**: Price action shows reversal pattern
3. **Delta Improving**: Delta moving toward zero (reversing)
4. **CVD Stabilizing**: CVD slope not strongly against position
5. **Absorption**: Significant absorption at extremes

### Exit Rules
1. **VWAP Target**: Price returns within 0.1% of VWAP
2. **Normalization**: Deviation percentile returns to neutral (45-55%)
3. **Time Exit**: Maximum hold time of 8 minutes
4. **Stop Loss**: Deviation extends 50% further from entry
5. **Trailing Profit**: Capture 70% of deviation improvement

### Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| deviationPercentileThreshold | 0.85 | 0.75-0.90 | Required deviation percentile |
| vwapProximityThreshold | 0.001 | 0.0005-0.002 | VWAP "touch" threshold |
| absorptionThreshold | 50000 | 25000-100000 | Min absorption for confirmation |
| maxHoldTimeMs | 480000 | 300000-600000 | Maximum hold time |
| trailingTakeProfit | 0.70 | 0.50-0.85 | Trailing profit percentage |
| cvdStabilizingThreshold | 0.3 | 0.1-0.5 | CVD stabilization threshold |

### Advantages
1. **Statistical Edge**: Mean reversion is a well-documented phenomenon
2. **Clear Targets**: VWAP provides objective profit targets
3. **Risk Management**: Natural stop levels based on deviation extension
4. **Institutional Benchmark**: VWAP is widely used by institutions

### Risks
1. **Trend Risk**: Strong trends can cause extended deviations
2. **Breakout Risk**: Price may break through VWAP and continue
3. **Timing Risk**: Reversal timing can be difficult to predict
4. **Whipsaw Risk**: Price may oscillate around VWAP

---

## Strategy 4: Regime-Switching Hybrid Strategy

### Concept
Dynamically adapts trading approach based on detected market regime (Trending TR, Mean-Reverting MR, Event-Driven EV). Each regime uses specialized entry/exit logic optimized for that market condition.

### Logic
```pseudocode
CLASS RegimeSwitchingHybridStrategy
  
  INITIALIZE:
    norm = NormalizationStore(windowMs=10min)
    dfs = DirectionalFlowScore(norm)
    regimeSelector = RegimeSelector(norm, lockTRMR=3, lockEV=2)
    
    // Sub-strategies
    trendStrategy = TrendFollowingModule()
    meanRevStrategy = MeanReversionModule()
    eventStrategy = EventDrivenModule()
    
    currentRegime = 'MR'
    position = null
    regimeHistory = CircularBuffer(size=10)
  
  METHOD evaluate(input):
    
    // 1. Compute DFS
    dfsOut = dfs.compute(input)
    
    // 2. Update regime selector
    regimeOut = regimeSelector.update({
      nowMs: input.nowMs,
      price: input.price,
      vwap: input.vwap,
      dfsPercentile: dfsOut.dfsPercentile,
      deltaZ: input.deltaZ,
      printsPerSecond: input.trades.printsPerSecond,
      burstCount: input.trades.consecutiveBurst.count,
      volatility: input.volatility
    })
    
    currentRegime = regimeOut.regime
    regimeHistory.push(currentRegime)
    
    // 3. Route to appropriate sub-strategy
    IF position == null:
      entrySignal = routeEntry(input, dfsOut, regimeOut)
      IF entrySignal.valid:
        position = entrySignal.side
        entryRegime = currentRegime
        RETURN ENTRY_ACTION(entrySignal.side, metadata={regime: currentRegime})
    
    ELSE:
      exitSignal = routeExit(input, dfsOut, regimeOut, position)
      IF exitSignal.valid:
        position = null
        RETURN EXIT_ACTION(position.side, metadata={exitRegime: currentRegime})
    
    RETURN NOOP

  METHOD routeEntry(input, dfsOut, regimeOut):
    
    SWITCH currentRegime:
      
      CASE 'TR':
        RETURN trendStrategy.checkEntry(input, dfsOut, regimeOut)
      
      CASE 'MR':
        RETURN meanRevStrategy.checkEntry(input, dfsOut, regimeOut)
      
      CASE 'EV':
        RETURN eventStrategy.checkEntry(input, dfsOut, regimeOut)
    
    RETURN {valid: false}

  METHOD routeExit(input, dfsOut, regimeOut, position):
    
    // Check for regime change exit (optional)
    regimeChanged = checkRegimeChangeExit()
    IF regimeChanged AND allowRegimeChangeExit:
      RETURN {valid: true, reason: 'REGIME_CHANGE'}
    
    // Route to appropriate exit logic
    SWITCH entryRegime:
      
      CASE 'TR':
        RETURN trendStrategy.checkExit(input, dfsOut, regimeOut, position)
      
      CASE 'MR':
        RETURN meanRevStrategy.checkExit(input, dfsOut, regimeOut, position)
      
      CASE 'EV':
        RETURN eventStrategy.checkExit(input, dfsOut, regimeOut, position)
    
    RETURN {valid: false}

// =====================================================
// SUB-STRATEGY: Trend Following (TR Regime)
// =====================================================
CLASS TrendFollowingModule
  
  METHOD checkEntry(input, dfsOut, regimeOut):
    
    // Strong momentum alignment
    IF dfsOut.dfsPercentile >= trEntryThresholdLong:
      // Confirm with price above VWAP
      IF input.price >= input.vwap:
        // CVD confirming trend
        IF input.cvdSlope > 0:
          // OBI aligned
          IF input.obiDeep > 0:
            RETURN {valid: true, side: 'LONG'}
    
    IF dfsOut.dfsPercentile <= trEntryThresholdShort:
      IF input.price <= input.vwap:
        IF input.cvdSlope < 0:
          IF input.obiDeep < 0:
            RETURN {valid: true, side: 'SHORT'}
    
    RETURN {valid: false}
  
  METHOD checkExit(input, dfsOut, regimeOut, position):
    
    // Trend following exits are wider
    IF position.side == 'LONG':
      // Exit on significant DFS reversal
      IF dfsOut.dfsPercentile <= trExitThresholdLong:
        RETURN {valid: true, reason: 'TREND_REVERSAL'}
      
      // Exit on VWAP break
      IF input.price < input.vwap * 0.997:
        RETURN {valid: true, reason: 'VWAP_BREAK'}
    
    IF position.side == 'SHORT':
      IF dfsOut.dfsPercentile >= trExitThresholdShort:
        RETURN {valid: true, reason: 'TREND_REVERSAL'}
      
      IF input.price > input.vwap * 1.003:
        RETURN {valid: true, reason: 'VWAP_BREAK'}
    
    RETURN {valid: false}

// =====================================================
// SUB-STRATEGY: Mean Reversion (MR Regime)
// =====================================================
CLASS MeanReversionModule
  
  METHOD checkEntry(input, dfsOut, regimeOut):
    
    // Calculate deviation from VWAP
    deviation = Math.abs(input.price - input.vwap)
    devP = norm.percentile('dev', deviation)
    
    // Need significant deviation
    IF devP < mrDeviationThreshold:
      RETURN {valid: false}
    
    // Long entry: price below VWAP, reverting up
    IF input.price < input.vwap:
      IF dfsOut.dfsPercentile >= 0.55:  // Slight bullish bias
        IF input.deltaZ > input.previousDeltaZ:  // Improving
          IF input.absorption?.side == 'buy':
            RETURN {valid: true, side: 'LONG'}
    
    // Short entry: price above VWAP, reverting down
    IF input.price > input.vwap:
      IF dfsOut.dfsPercentile <= 0.45:  // Slight bearish bias
        IF input.deltaZ < input.previousDeltaZ:  # Improving
          IF input.absorption?.side == 'sell':
            RETURN {valid: true, side: 'SHORT'}
    
    RETURN {valid: false}
  
  METHOD checkExit(input, dfsOut, regimeOut, position):
    
    // Mean reversion exits are tighter
    IF position.side == 'LONG':
      // Exit near VWAP
      IF input.price >= input.vwap * 0.998:
        RETURN {valid: true, reason: 'VWAP_REACHED'}
      
      // Exit on continued weakness
      IF dfsOut.dfsPercentile <= 0.30:
        RETURN {valid: true, reason: 'WEAKNESS'}
    
    IF position.side == 'SHORT':
      IF input.price <= input.vwap * 1.002:
        RETURN {valid: true, reason: 'VWAP_REACHED'}
      
      IF dfsOut.dfsPercentile >= 0.70:
        RETURN {valid: true, reason: 'STRENGTH'}
    
    RETURN {valid: false}

// =====================================================
// SUB-STRATEGY: Event-Driven (EV Regime)
// =====================================================
CLASS EventDrivenModule
  
  METHOD checkEntry(input, dfsOut, regimeOut):
    
    // Event-driven requires extreme signals
    IF dfsOut.dfsPercentile >= evEntryThresholdLong:
      // Burst confirmation
      IF input.trades.consecutiveBurst.side == 'buy':
        IF input.trades.consecutiveBurst.count >= evBurstCount:
          // High volume confirmation
          IF regimeOut.volLevel > evVolThreshold:
            RETURN {valid: true, side: 'LONG'}
    
    IF dfsOut.dfsPercentile <= evEntryThresholdShort:
      IF input.trades.consecutiveBurst.side == 'sell':
        IF input.trades.consecutiveBurst.count >= evBurstCount:
          IF regimeOut.volLevel > evVolThreshold:
            RETURN {valid: true, side: 'SHORT'}
    
    RETURN {valid: false}
  
  METHOD checkExit(input, dfsOut, regimeOut, position):
    
    // Event-driven exits are fastest
    timeInTrade = input.nowMs - entryTimestamp
    
    // Quick profit taking
    IF timeInTrade < evQuickExitTime:
      IF position.side == 'LONG' AND dfsOut.dfsPercentile <= 0.70:
        RETURN {valid: true, reason: 'QUICK_PROFIT'}
      IF position.side == 'SHORT' AND dfsOut.dfsPercentile >= 0.30:
        RETURN {valid: true, reason: 'QUICK_PROFIT'}
    
    // Time-based exit for events
    IF timeInTrade > evMaxHoldTime:
      RETURN {valid: true, reason: 'EVENT_TIMEOUT'}
    
    // Volatility collapse exit
    IF regimeOut.volLevel < evVolCollapseThreshold:
      RETURN {valid: true, reason: 'VOL_COLLAPSE'}
    
    RETURN {valid: false}
```

### Entry Rules by Regime

#### Trend Following (TR)
1. DFS percentile >= 0.80 (long) or <= 0.20 (short)
2. Price aligned with trend (above/below VWAP)
3. CVD confirming trend direction
4. OBI aligned with trend

#### Mean Reversion (MR)
1. Deviation from VWAP at 75th+ percentile
2. DFS showing slight reversal bias (0.45-0.55)
3. Delta improving toward VWAP
4. Absorption at extreme

#### Event-Driven (EV)
1. DFS percentile >= 0.92 (long) or <= 0.08 (short)
2. Burst count >= 3 consecutive
3. Volume spike (volLevel > 0.80)
4. Burst side aligned with signal

### Exit Rules by Regime

#### Trend Following (TR)
1. DFS reversal to 0.40 (long) or 0.60 (short)
2. VWAP break with momentum
3. Maximum hold: 10 minutes

#### Mean Reversion (MR)
1. Price reaches VWAP proximity
2. DFS showing continued weakness/strength
3. Maximum hold: 5 minutes

#### Event-Driven (EV)
1. Quick profit: DFS normalizes within 30 seconds
2. Event timeout: 2 minutes maximum
3. Volatility collapse: volLevel drops below 0.50

### Parameters

#### Trend Following (TR) Parameters
| Parameter | Default | Range |
|-----------|---------|-------|
| trEntryThresholdLong | 0.80 | 0.70-0.90 |
| trEntryThresholdShort | 0.20 | 0.10-0.30 |
| trExitThresholdLong | 0.40 | 0.30-0.50 |
| trExitThresholdShort | 0.60 | 0.50-0.70 |
| trMaxHoldTime | 600000 | 300000-900000 |

#### Mean Reversion (MR) Parameters
| Parameter | Default | Range |
|-----------|---------|-------|
| mrDeviationThreshold | 0.75 | 0.65-0.85 |
| mrMaxHoldTime | 300000 | 180000-600000 |

#### Event-Driven (EV) Parameters
| Parameter | Default | Range |
|-----------|---------|-------|
| evEntryThresholdLong | 0.92 | 0.88-0.96 |
| evEntryThresholdShort | 0.08 | 0.04-0.12 |
| evBurstCount | 3 | 2-5 |
| evVolThreshold | 0.80 | 0.70-0.90 |
| evQuickExitTime | 30000 | 15000-60000 |
| evMaxHoldTime | 120000 | 60000-180000 |
| evVolCollapseThreshold | 0.50 | 0.40-0.60 |

### Advantages
1. **Adaptive**: Automatically adjusts to market conditions
2. **Optimized**: Each regime uses specialized logic
3. **Robust**: Reduces drawdowns in unsuitable conditions
4. **Comprehensive**: Covers all major market states

### Risks
1. **Regime Detection Lag**: Regime changes may be detected late
2. **False Regimes**: Temporary conditions may trigger wrong regime
3. **Complexity**: More parameters and logic to manage
4. **Transition Risk**: Position from one regime may not suit new regime

---

## Implementation Notes

### Common Infrastructure
All strategies leverage:
- `NormalizationStore` for rolling statistics
- `DirectionalFlowScore` for signal computation
- `RegimeSelector` for regime detection (hybrid strategy)
- `InstitutionalRiskEngine` for risk management

### Risk Integration
```typescript
// All strategies should check risk before trading
const riskCheck = riskEngine.canTrade(symbol, quantity, notional, direction);
if (!riskCheck.allowed) {
  return { action: 'NOOP', reason: riskCheck.reason };
}
```

### Position Sizing
All strategies respect risk engine position multipliers:
```typescript
const positionMultiplier = riskEngine.getPositionMultiplier();
const adjustedSize = baseSize * positionMultiplier;
```

### Performance Monitoring
Each strategy should track:
- Win rate by regime (for hybrid strategy)
- Average hold time
- Profit factor
- Maximum adverse excursion
- Sharpe ratio

---

## Backtesting Recommendations

1. **In-Sample Optimization**: Use first 60% of data for parameter tuning
2. **Out-of-Sample Testing**: Validate on remaining 40% of data
3. **Walk-Forward Analysis**: Re-optimize parameters periodically
4. **Regime-Specific Analysis**: Evaluate performance in each regime separately
5. **Correlation Analysis**: Check correlation between strategies for portfolio construction
