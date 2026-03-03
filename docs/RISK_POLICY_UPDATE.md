# Risk & Safety Policy Update - FAZ 6

## 📋 Executive Summary

Bu doküman, AI Trading Bot'un risk yönetimi sistemindeki kill switch ve trade suppression politikalarının güncellenmiş versiyonunu içerir. Mevcut threshold'ların optimize edilmesi, false positive/negative dengesinin iyileştirilmesi ve choppy market koşullarında trade suppression stratejilerinin eklenmesi hedeflenmektedir.

---

## 🚨 Kill Switch Tetikleme Koşulları (Güncellenmiş)

### 1. Latency-Based Triggers

| Metrik | Eski Threshold | Yeni Threshold | Tetikleyici | State Geçişi |
|--------|---------------|----------------|-------------|--------------|
| Latency p95 | 5000ms | **100ms** (3 tick üst üste) | LATENCY_SPIKE | KILL_SWITCH |
| Latency p99 | 5000ms | **200ms** (1 tick) | LATENCY_SPIKE | KILL_SWITCH |
| Event Loop Lag | Yok | **50ms** (sürekli) | LATENCY_SPIKE | REDUCED_RISK → HALTED |

**Rationale:**
- 5 saniyelik threshold çok yüksek, 100ms p95 latency institutional trading için kabul edilebilir sınır
- 3 tick üst üste kuralı tek seferlik spike'ları filtreler (false positive önlemi)
- Event loop lag, Node.js performansının kritik göstergesi

### 2. Volatilite-Based Triggers

| Metrik | Eski Threshold | Yeni Threshold | Tetikleyici | State Geçişi |
|--------|---------------|----------------|-------------|--------------|
| Realized Vol 1m | 5% | **2x son 10m ortalama** | VOLATILITY_SPIKE | HALTED |
| Flash Crash Gap | 5% | **%2+ (1 tick)** | VOLATILITY_SPIKE | KILL_SWITCH |
| Vol of Vol | Yok | > 3.0 | VOLATILITY_SPIKE | REDUCED_RISK |

**Rationale:**
- Volatilite spike'ları relative olarak ölçmek daha anlamlı (2x average)
- Flash crash'lerde 1 tick'te %2 gap kritik bir erken uyarı sinyalidir
- Vol of Vol (volatilitenin volatilitesi) market kararsızlığını gösterir

### 3. Disconnect & Connection Health

| Metrik | Eski Threshold | Yeni Threshold | Tetikleyici | State Geçişi |
|--------|---------------|----------------|-------------|--------------|
| Disconnect Timeout | 30s | **10s** (3 attempts) | DISCONNECT_DETECTED | KILL_SWITCH |
| Heartbeat Miss | Yok | **3 üst üste** | DISCONNECT_DETECTED | HALTED |
| Orderbook Stale | Yok | **> 5s** | EXECUTION_TIMEOUT | REDUCED_RISK |

---

## 🛡️ Trade Suppression (NO_TRADE) Politikası

### Churn/Choppy Market Detection

#### 1. Flip Rate Monitoring

```typescript
interface FlipSuppressionConfig {
  // 5 dakikalık pencere içindeki side flip sayısı
  maxFlipsPer5Min: number;      // 3
  
  // Suppression süresi (ms)
  suppressionDurationMs: number; // 15 * 60 * 1000 = 15 min
  
  // Cooldown süresi (ms)
  cooldownMs: number;           // 30 * 1000 = 30s
}
```

**Tetikleme Koşulları:**
- `flipRate > 3 per 5min` → **NO_TRADE** (15 dakika)
- `flipRate > 5 per 5min` → **HALTED** (manuel reset gerektirir)

#### 2. Chop Score Based Suppression

| Chop Score | Eylem | Confidence Cap | Max Position |
|------------|-------|----------------|--------------|
| 0.5 - 0.7 | Uyarı | 0.8 | %75 |
| 0.7 - 0.85 | NO_TRADE | 0.5 | %50 |
| > 0.85 | HALTED | 0.0 | %0 |

**Implementation:**
```typescript
if (chopScore > 0.85) {
  return { allowed: false, state: RiskState.HALTED, reason: 'EXTREME_CHOP' };
}
if (chopScore > 0.7) {
  return { allowed: true, confidenceCap: 0.5, positionMultiplier: 0.5 };
}
```

#### 3. Whipsaw Detection

```typescript
interface WhipsawConfig {
  // 1 dakikalık pencere
  maxWhipsawsPer1Min: number;  // 2
  
  // Cooldown süresi
  cooldownMs: number;          // 30 * 1000 = 30s
  
  // Minimum fiyat hareketi (ATR bazlı)
  minMoveAtrMultiple: number;  // 0.5
}
```

**Whipsaw Tanımı:**
- Aynı yönde 2+ entry attempt, ardından hemen exit
- Veya 30 saniye içinde 2+ side değişikliği

---

## ⚖️ Risk State Machine Entegrasyonu

### Güncellenmiş State Transition Matrix

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│   FROM / TO     │   TRACKING      │  REDUCED_RISK   │    HALTED       │  KILL_SWITCH    │
├─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ TRACKING        │      ---        │  Daily loss >5% │  Daily loss >8% │ Manual /        │
│                 │                 │  Chop >0.7      │  Latency p99    │ Disconnect      │
│                 │                 │  Vol spike 2x   │  >200ms         │ >10s            │
├─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ REDUCED_RISK    │  System stable  │      ---        │  Flip rate >5   │ Latency p95     │
│                 │  10min          │                 │  Chop >0.85     │ >100ms (3x)     │
│                 │                 │                 │                 │ Flash crash     │
├─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ HALTED          │  Manual reset   │  Risk reduced   │      ---        │  Manual kill    │
│                 │  OR             │  (auto)         │                 │                 │
│                 │  Auto: 30min    │                 │                 │                 │
├─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ KILL_SWITCH     │  Manual reset   │      N/A        │      N/A        │      ---        │
│                 │  ONLY           │                 │                 │                 │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

### Recovery Prosedürleri

#### HALTED → NORMAL Geçiş

```typescript
interface RecoveryConfig {
  // Otomatik recovery süresi (opsiyonel)
  autoRecoveryMs: number;        // 30 * 60 * 1000 = 30 min
  
  // Health check requirements
  healthCheck: {
    consecutiveStableTicks: number;  // 10
    maxLatencyMs: number;            // 50
    maxChopScore: number;            // 0.6
    minTrendinessScore: number;      // 0.4
  };
  
  // Manuel reset şartları
  manualReset: {
    requireConfirmation: boolean;    // true
    requireTwoFactor: boolean;       // true for KILL_SWITCH
    auditLogRequired: boolean;       // true
  };
}
```

**Recovery Akışı:**
1. **HALTED** state'e girildiğinde timer başlat
2. 30 dakika sonra health check çalıştır
3. Health check geçilirse → **REDUCED_RISK**
4. 10 dakika daha stabil kalınırsa → **TRACKING**
5. Health check başarısız olursa → timer reset

---

## 📊 Position Size Multiplier Matrix

| State | Normal PnL | Consecutive Loss | Chop Score >0.7 | Combined |
|-------|-----------|------------------|-----------------|----------|
| TRACKING | 1.0x | 0.75x | 0.5x | 0.5x |
| REDUCED_RISK | 0.5x | 0.5x | 0.25x | 0.25x |
| HALTED | 0.0x | 0.0x | 0.0x | 0.0x |
| KILL_SWITCH | 0.0x | 0.0x | 0.0x | 0.0x |

---

## 🔧 Implementation Checklist

### KillSwitchManager.ts Güncellemeleri
- [ ] Yeni latency threshold'ları (p95/p99)
- [ ] Event loop lag monitoring
- [ ] Volatilite spike relative threshold
- [ ] Flash crash detection
- [ ] Consecutive tick counting

### RiskStateManager.ts Güncellemeleri
- [ ] Yeni trigger tipleri (FLIP_RATE_HIGH, CHOP_EXTREME, WHIPSAW_DETECTED)
- [ ] Recovery state machine
- [ ] Health check entegrasyonu
- [ ] Auto-recovery timer

### OrchestratorV1.ts Güncellemeleri
- [ ] Flip rate tracking (5min window)
- [ ] Whipsaw detection
- [ ] NO_TRADE state entegrasyonu
- [ ] Confidence cap uygulaması

### InstitutionalRiskEngine.ts Güncellemeleri
- [ ] Trade suppression check
- [ ] Choppy market detection
- [ ] Position multiplier coordination

---

## 📈 Monitoring & Alerting

### Metrics to Track

```typescript
interface RiskMetrics {
  // Kill switch metrics
  killSwitchTriggers: Counter;
  killSwitchLatency: Histogram;
  
  // Trade suppression metrics
  suppressionEvents: Counter;
  suppressionDuration: Histogram;
  
  // False positive tracking
  fpLatencySpike: Counter;  // Recovered within 30s
  fnLatencySpike: Counter;  // Missed actual spike
  
  // State duration
  stateDuration: Gauge;     // Time spent in each state
  stateTransitions: Counter;
}
```

### Alert Rules

| Condition | Severity | Notification |
|-----------|----------|--------------|
| Kill switch triggered | CRITICAL | Email + SMS + Webhook |
| HALTED state > 30min | HIGH | Email + Webhook |
| Flip rate > 3/5min | WARNING | Webhook |
| Latency p95 > 50ms | WARNING | Webhook |
| Chop score > 0.7 | INFO | Log only |

---

## 🔄 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Initial | FAZ-2 baseline |
| 2.0 | FAZ 6 | Updated thresholds, trade suppression, recovery procedures |

---

## ✅ Approval

- [ ] Risk Manager Review
- [ ] Engineering Review
- [ ] QA Testing Complete
- [ ] Production Deployment Approved
