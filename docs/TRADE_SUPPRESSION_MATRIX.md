# Trade Suppression Matrix

## 📊 Suppression Policy Quick Reference

Bu doküman, choppy market ve churn koşullarında uygulanacak trade suppression politikalarının hızlı referansını sunar.

---

## 🎯 Suppression Triggers

### 1. Flip Rate Suppression

```
┌─────────────────────────────────────────────────────────────────┐
│ FLIP RATE THRESHOLDS                                            │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ Flip Rate       │ Action          │ Duration                    │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ ≤ 3 / 5min      │ Normal trading  │ N/A                         │
│ > 3 / 5min      │ NO_TRADE        │ 15 minutes                  │
│ > 5 / 5min      │ HALTED          │ Manual reset required       │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

**Implementation:**
```typescript
if (flipRate > 5) {
  stateManager.transition(RiskStateTrigger.FLIP_RATE_HIGH, 'Extreme flip rate');
  return { allowed: false, state: RiskState.HALTED };
} else if (flipRate > 3) {
  activateSuppression('FLIP_RATE', 15 * 60 * 1000);
  return { allowed: false, reason: 'Flip rate suppression' };
}
```

---

### 2. Chop Score Based Suppression

```
┌─────────────────────────────────────────────────────────────────┐
│ CHOP SCORE MATRIX                                               │
├─────────────┬─────────────────┬───────────────┬─────────────────┤
│ Chop Score  │ State           │ Confidence Cap│ Max Position    │
├─────────────┼─────────────────┼───────────────┼─────────────────┤
│ ≤ 0.5       │ Normal          │ 1.0           │ 100%            │
│ 0.5 - 0.7   │ Warning         │ 0.8           │ 75%             │
│ 0.7 - 0.85  │ NO_TRADE        │ 0.5           │ 50%             │
│ > 0.85      │ HALTED          │ 0.0           │ 0%              │
└─────────────┴─────────────────┴───────────────┴─────────────────┘
```

**Implementation:**
```typescript
function getChopSuppression(chopScore: number): SuppressionLevel {
  if (chopScore > 0.85) return { state: 'HALTED', cap: 0.0, maxPos: 0.0 };
  if (chopScore > 0.70) return { state: 'NO_TRADE', cap: 0.5, maxPos: 0.5 };
  if (chopScore > 0.50) return { state: 'WARNING', cap: 0.8, maxPos: 0.75 };
  return { state: 'NORMAL', cap: 1.0, maxPos: 1.0 };
}
```

---

### 3. Whipsaw Detection

```
┌─────────────────────────────────────────────────────────────────┐
│ WHIPSAW COOLDOWN                                                │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ Whipsaw Count   │ Action          │ Duration                    │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ ≤ 2 / 1min      │ Normal trading  │ N/A                         │
│ > 2 / 1min      │ Cooldown        │ 30 seconds                  │
│ > 4 / 1min      │ NO_TRADE        │ 5 minutes                   │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

**Whipsaw Definition:**
- Position açıkken 2+ entry attempt ardından hemen exit
- Veya 30 saniye içinde 2+ side değişikliği

---

## 🔄 State Transition Matrix

```
                    ┌─────────────┐
                    │  TRACKING   │
                    │   (Normal)  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ REDUCED_RISK  │  │   NO_TRADE    │  │    HALTED     │
│  (Chop 0.5-   │  │  (Flip rate,  │  │ (Extreme chop │
│    0.7)       │  │   whipsaw)    │  │  or flip rate)│
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  RECOVERY   │
                    │  (30 min    │
                    │   auto)     │
                    └─────────────┘
```

---

## 📈 Suppression Metrics

### Key Performance Indicators

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Suppression events / day | < 5 | > 10 |
| Avg suppression duration | < 10 min | > 30 min |
| False positive rate | < 10% | > 20% |
| Missed opportunity cost | < $500/day | > $1000/day |

### Telemetry Events

```typescript
interface SuppressionTelemetry {
  // Flip rate
  flipRate5m: number;
  flipRateSuppressionCount: number;
  flipRateSuppressionDuration: number;
  
  // Chop score
  currentChopScore: number;
  avgChopScore5m: number;
  chopScoreSuppressionCount: number;
  
  // Whipsaw
  whipsawCount1m: number;
  whipsawCooldownCount: number;
  
  // Combined
  totalSuppressionTimeMs: number;
  suppressionReasonBreakdown: Record<string, number>;
}
```

---

## 🛡️ Recovery Procedures

### Auto-Recovery Flow

```
HALTED State
     │
     │ 30 minutes
     ▼
Health Check
     │
     ├─► FAIL ──► Reset timer, retry in 1 min
     │
     └─► PASS ──► consecutiveStableTicks++
                      │
                      │ 10 consecutive passes
                      ▼
              REDUCED_RISK State
                      │
                      │ 10 minutes stable
                      ▼
                TRACKING State
```

### Health Check Criteria

```typescript
interface HealthCheckCriteria {
  latency: {
    p95Ms: number;        // < 50ms
    p99Ms: number;        // < 100ms
  };
  volatility: {
    chopScore: number;    // < 0.6
    trendiness: number;   // > 0.4
  };
  market: {
    spreadPct: number;    // < 0.1%
    printsPerSecond: number; // > 10
  };
}
```

---

## 📝 Configuration Reference

### Default Parameters

```typescript
const TRADE_SUPPRESSION_DEFAULTS = {
  // Flip rate
  flipRateThreshold: 3,           // per 5 minutes
  flipRateSuppressionMs: 15 * 60 * 1000,  // 15 minutes
  flipRateHaltThreshold: 5,       // per 5 minutes
  
  // Chop score
  chopScoreWarning: 0.5,
  chopScoreNoTrade: 0.7,
  chopScoreHalt: 0.85,
  
  // Whipsaw
  whipsawThreshold: 2,            // per 1 minute
  whipsawCooldownMs: 30 * 1000,   // 30 seconds
  
  // Recovery
  autoRecoveryEnabled: true,
  autoRecoveryDelayMs: 30 * 60 * 1000,  // 30 minutes
  healthCheckIntervalMs: 60 * 1000,     // 1 minute
  consecutiveStableTicksRequired: 10,
};
```

---

## 🎯 Best Practices

### 1. Gradual Rollout
- Start with monitoring only (dry run)
- Enable suppression with higher thresholds
- Gradually tighten thresholds based on data

### 2. Context Awareness
- Consider market regime (high vol vs low vol)
- Adjust thresholds for different symbols
- Time-of-day adjustments (avoid low liquidity periods)

### 3. Alerting
- Immediate alert on HALTED state
- Daily summary of suppression events
- Weekly FP/FN analysis

### 4. Documentation
- Log all suppression events with context
- Track recovery outcomes
- Regular threshold review

---

## 🔧 Integration Points

### RiskStateManager
```typescript
// New triggers to add
enum RiskStateTrigger {
  FLIP_RATE_HIGH = 'FLIP_RATE_HIGH',
  CHOP_EXTREME = 'CHOP_EXTREME',
  WHIPSAW_DETECTED = 'WHIPSAW_DETECTED',
  AUTO_RECOVERY = 'AUTO_RECOVERY',
}
```

### OrchestratorV1
```typescript
// Pre-trade check
if (suppressionActive) {
  return { allowed: false, reason: suppressionReason };
}

// Position sizing
const adjustedQty = baseQty * confidenceCap * positionMultiplier;
```

### KillSwitchManager
```typescript
// Coordinated suppression
if (stateManager.getCurrentState() === RiskState.HALTED) {
  // Ensure all trading stops
  orchestrator.suppressAll();
}
```

---

## 📊 Monitoring Dashboard

### Required Metrics

1. **Real-time**
   - Current suppression status
   - Active suppression reasons
   - Time in suppression

2. **Historical**
   - Suppression events over time
   - Duration distribution
   - Reason breakdown

3. **Performance**
   - Cost of suppression (missed opportunities)
   - Cost of false negatives (churn losses)
   - Net benefit calculation

---

## ✅ Checklist

### Implementation
- [ ] Flip rate tracking
- [ ] Chop score monitoring
- [ ] Whipsaw detection
- [ ] Suppression state machine
- [ ] Recovery procedures
- [ ] Telemetry collection

### Testing
- [ ] Unit tests for each trigger
- [ ] Integration tests for state transitions
- [ ] Backtest on historical data
- [ ] Stress test with extreme conditions

### Deployment
- [ ] Feature flags for gradual rollout
- [ ] Monitoring and alerting
- [ ] Runbook for manual intervention
- [ ] Post-deployment review
