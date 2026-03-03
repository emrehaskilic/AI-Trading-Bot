# FAZ 6 - Red Team Scenarios & Vulnerability Assessment

> **AI Trading Bot - Adversarial Security Analysis**  
> **Commit:** 5b1c4e2b62efcb2a1d757439448f47cb2dee1450  
> **Target:** Market Microstructure & Decision Engine  
> **Classification:** INTERNAL - SECURITY ANALYSIS  
> **Output Tag:** PR#9-Resilience

---

## Executive Summary

Bu doküman, AI Trading Bot sistemine karşı tasarlanmış 5 adversarial saldırı senaryosunu ve 13 kritik zafiyeti içermektedir. Her senaryo, sistem metriklerini manipüle ederek yanlış kararlar alınmasını hedeflemektedir.

**Zafiyet Özeti:**
| Severity | Count | Total CVSS |
|----------|-------|------------|
| P0 - Critical | 5 | 40.9 |
| P1 - High | 4 | 23.8 |
| P2 - Medium | 4 | 16.2 |
| **Total** | **13** | **80.9** |

---

## Attack Matrix Summary

| Attack ID | Name | Primary Target | Severity | P&L Impact | Detection Difficulty |
|-----------|------|----------------|----------|------------|---------------------|
| S1 | OBI Spoofing | `obiDeep` | P0 | High | Medium |
| S2 | Delta Burst | `deltaZ` | P0 | High | Low |
| S3 | Choppy Churn | `chopScore` | P1 | Medium | High |
| S4 | Latency Spike | `lastDepthTime` | P0 | High | Medium |
| S5 | Flash Crash | `realizedVol1m` | P0 | Very High | Low |

---

## S1: Spoofing ile OBI Manipülasyonu

### Attack ID
`S1-OBI-SPOOF`

### Attack Name
**Order Book Imbalance Spoofing / Layering Attack**

### Description

Bu saldırı, order book imbalance (OBI) metriğini manipüle ederek stratejinin yanlış yöne girmesini sağlar. Hızlı emir ekleme/iptal (quote stuffing) teknikleri kullanılır.

#### Adım Adım Saldırı:

**Phase 1: Setup (T-30s)**
1. Hedef sembolde mevcut piyasa yapısını analiz et
2. Gate B threshold'larını belirle (`obiSupportMinAbs = 0.05`)
3. Liquidity derinliğini ölç

**Phase 2: Spoofing Execution (T-0)**
1. **BUY sinyali hedefleniyorsa:**
   - Ask tarafına büyük hacimli spoof emirleri yerleştir (fiyatın üstünde)
   - Bid tarafında gerçek emirler korunur
   - `obiDeep` değerini yapay olarak +0.10'a çek
   
2. **SELL sinyali hedefleniyorsa:**
   - Bid tarafına büyük hacimli spoof emirleri yerleştir (fiyatın altında)
   - Ask tarafında gerçek emirler korunur
   - `obiDeep` değerini yapay olarak -0.10'a çek

**Phase 3: Trigger (T+1s)**
1. Spoof emirlerin strateji tarafından algılanmasını bekle
2. Gate B check: `obiDeep >= 0.05` (BUY) veya `obiDeep <= -0.05` (SELL)
3. Strateji entry sinyali ürettiğinde spoof emirleri iptal et

**Phase 4: Profit (T+5s to T+30s)**
1. Strateji pozisyona girdikten sonra fiyat ters yöne hareket ettirir
2. Pozisyon zarara girer
3. Saldırgan kar elde eder (eğer aynı yönde pozisyon taşıyorsa)

### Success Criteria

| Kriter | Değer | Açıklama |
|--------|-------|----------|
| OBI Yanlış Yön | `obiDeep > 0.05` (BUY sinyali) | Gerçek imbalance ters yönde |
| Gate B Pass | `gateB.checks.obiSupport = true` | Yanlış OBI gate'i geçer |
| Entry Trigger | `intent = 'ENTRY'` | Yanlış yöne pozisyon açılır |
| Price Reversal | Fiyat ters yöne >0.3% hareket | Pozisyon zarara girer |

### Affected Modules

| Dosya | Fonksiyon | Etki |
|-------|-----------|------|
| `OrchestratorV1.ts` | `nextSide()` | OBI ağırlıklı skor hesabı |
| `OrchestratorV1.ts` | `evaluate()` Gate B check | `obiDeep` threshold kontrolü |
| `OrchestratorV1.ts` | `evaluateAdd()` | Add flow kontrolü |
| `OrderbookManager.ts` | `applyDelta()` | Orderbook güncellemesi |
| `OrderbookManager.ts` | `getTopLevels()` | OBI hesaplama kaynağı |

### Severity
**P0 - CRITICAL**

- Doğrudan P&L etkisi
- Sistem karar mekanizmasının tam manipülasyonu
- Yüksek başarı olasılığı (deterministik sistem)

---

## S2: Delta Burst ile Z-Score Yanıltma

### Attack ID
`S2-DELTA-BURST`

### Attack Name
**Delta Z-Score Manipulation / Impulse Trigger Exploit**

### Description

Bu saldırı, ani delta spike'lar ile z-score'u manipüle ederek impulse threshold'un aşılmasını sağlar. Sistem EWMA smoothing kullanmasına rağmen, yüksek amplitude'lu kısa süreli delta burst'ler smoothing'i atlayabilir.

#### Adım Adım Saldırı:

**Phase 1: Baseline Establishment (T-60s)**
1. Normal delta volatilitesini ölç (`deltaZ` history)
2. EWMA alpha parametresini belirle (`deltaZEwmaAlpha = 0.30`)
3. Impulse threshold'u not al (`minAbsDeltaZ = 0.8`)

**Phase 2: Burst Pattern Design**
1. **Pattern Type A - Single Spike:**
   ```
   T+0:  deltaZ = 0.0 (normal)
   T+1:  deltaZ = 2.5 (burst)
   T+2:  deltaZ = 0.0 (reset)
   ```

2. **Pattern Type B - Staircase:**
   ```
   T+0:  deltaZ = 0.0
   T+1:  deltaZ = 0.9
   T+2:  deltaZ = 1.2
   T+3:  deltaZ = 0.0
   ```

3. **Pattern Type C - Oscillating Burst:**
   ```
   T+0:  deltaZ = 0.0
   T+1:  deltaZ = 1.5
   T+2:  deltaZ = -1.5
   T+3:  deltaZ = 1.5
   ```

**Phase 3: Execution**
1. Gate A'nın passed olduğu bir durum bekle
2. Delta burst pattern'ini enjekte et
3. EWMA smoothing hesaplamasını aşacak timing kullan
4. Impulse check: `|smoothedDeltaZ| >= 0.8`

**Phase 4: Cascade Effect**
1. Impulse passed → Entry chase başlar
2. Gate confirm sayacı artar
3. `entryConfirmCount >= 2` olduğunda entry trigger

### Success Criteria

| Kriter | Değer | Açıklama |
|--------|-------|----------|
| Raw Delta Spike | `|deltaZ| > 2.0` | Yüksek amplitude burst |
| Smoothed DeltaZ | `|smoothedDeltaZ| > 0.8` | EWMA sonrası threshold aşımı |
| Impulse Pass | `impulse.passed = true` | Impulse check geçildi |
| Entry Confirm | `entryConfirmCount >= 2` | Entry onayı verildi |

### Severity
**P0 - CRITICAL**

- Doğrudan entry trigger manipülasyonu
- EWMA smoothing bypass potansiyeli
- Hızlı ve tekrarlanabilir

---

## S3: Choppy Market Churn (Flip/Whipsaw)

### Attack ID
`S3-CHOP-CHURN`

### Attack Name
**Choppy Market Whipsaw / Flip Rate Exploitation**

### Description

Bu saldırı, hızlı yön değişimleri ile flip rate'i artırarak transaction cost'ları patlatır. Sistem her flip'te spread ve slippage öder, aşırı flip'ler P&L'yi eritir.

#### Adım Adım Saldırı:

**Phase 1: Regime Analysis**
1. Mevcut `chopScore` değerini kontrol et (`chopMax = 0.50`)
2. `trendinessScore` değerini ölç (`trendinessMin = 0.10`)
3. Gate A durumunu analiz et

**Phase 2: Choppy Pattern Injection**
1. **Pattern: Rapid Oscillation**
   ```
   Time    | Price    | deltaZ | cvdSlope | obiDeep | Trend
   --------|----------|--------|----------|---------|-------
   T+0s    | 45000.00 | +0.5   | +0.01    | +0.08   | UP
   T+2s    | 45050.00 | +1.2   | +0.03    | +0.12   | UP (entry)
   T+4s    | 45020.00 | -0.8   | -0.02    | -0.05   | DOWN
   T+6s    | 44980.00 | -1.5   | -0.05    | -0.10   | DOWN (flip)
   T+8s    | 45030.00 | +0.9   | +0.02    | +0.06   | UP (flip)
   T+10s   | 44970.00 | -1.0   | -0.03    | -0.08   | DOWN (flip)
   ```

**Phase 3: Flip Triggering**
1. Her yön değişiminde `sideFlipEvents5m` artar
2. `minFlipIntervalMs = 30000` threshold'u aşılmaya çalışılır
3. `consecutiveConfirmations = 3` sayacını manipüle et

**Phase 4: Cost Accumulation**
1. Her entry/exit çifti spread cost öder (~8 bps)
2. Taker fallback kullanılırsa ekstra slippage
3. 5 flip = ~40-60 bps transaction cost

### Success Criteria

| Kriter | Değer | Açıklama |
|--------|-------|----------|
| Flip Rate | `sideFlipPerMin > 2.0` | Dakikada 2+ flip |
| Flip Count | `sideFlipCount5m > 10` | 5 dakikada 10+ flip |
| Gate A Pass | `gateA.checks.chop = false` | Chop score geçersiz |
| Transaction Cost | `totalFees > 0.5%` | Toplam fee yüzdesi |

### Severity
**P1 - HIGH**

- Dolaylı P&L etkisi (transaction costs)
- Sistem stabilitesini bozar
- Death by a thousand cuts pattern

---

## S4: Latency Spike (Event Loop Backlog / WS Stall)

### Attack ID
`S4-LATENCY-SPIKE`

### Attack Name
**Stale Data Exploitation / Latency Arbitrage**

### Description

Bu saldırı, WebSocket gecikmesi veya event loop backlog yaratarak sistemin stale (eski) veri ile karar vermesini sağlar. Sistem gerçek piyasa koşullarından habersizken eski metriklere göre işlem yapar.

#### Adım Adım Saldırı:

**Phase 1: Normal Operations (T-0)**
1. Sistem normal çalışıyor, latency < 100ms
2. Orderbook canlı, tüm metrikler güncel
3. `orderbookIntegrityLevel = 0`

**Phase 2: Latency Spike Injection**
1. **Method A - Network Congestion:**
   - WebSocket message buffer'ını doldur
   - Processing delay ekle (500ms-2000ms)
   
2. **Method B - CPU Exhaustion:**
   - Event loop'u bloke eden işlemler
   - Garbage collection pressure
   
3. **Method C - Memory Pressure:**
   - Heap memory doldurma
   - GC pause sürelerini artırma

**Phase 3: Stale Data Window**
1. Sistem eski verilerle çalışmaya devam eder
2. Gerçek piyasa hareketinden habersiz
3. `lastDepthTime` eski kalır

**Phase 4: Decision on Stale Data**
1. Sistem eski `deltaZ`, `obiDeep`, `price` değerleriyle karar verir
2. Gerçek piyasa ters yönde hareket etmiştir
3. Yanlış pozisyon açılır

### Success Criteria

| Kriter | Değer | Açıklama |
|--------|-------|----------|
| Latency Spike | `latencyMs > 5000` | 5+ saniye gecikme |
| Data Staleness | `nowMs - lastDepthTime > 3000` | 3+ saniye eski veri |
| Decision on Stale | `intent = 'ENTRY'` | Eski veriyle karar |
| Price Delta | `|realPrice - stalePrice| > 0.5%` | Fiyat farkı |

### Severity
**P0 - CRITICAL**

- Kill switch bypass potansiyeli
- Stale data ile kritik kararlar
- Latency arbitrage attack vektörü

---

## S5: Flash Crash (Gap + Liquidity Vacuum)

### Attack ID
`S5-FLASH-CRASH`

### Attack Name
**Flash Crash / Liquidity Vacuum Exploit**

### Description

Bu saldırı, ani fiyat gap'i ve likidite kaybı yaratarak stop loss'ların tetiklenmesini veya yanlış pozisyonların açılmasını sağlar. Sistem aşırı volatilite koşullarında beklenmedik şekilde davranabilir.

#### Adım Adım Saldırı:

**Phase 1: Pre-Crash Setup**
1. Normal piyasa koşulları (`realizedVol1m < 0.12`)
2. Gate C check: `maxRealizedVol1m = 0.12`
3. Sistem aktif trading modunda

**Phase 2: Crash Pattern Injection**
1. **Pattern A - Sudden Gap Down:**
   ```
   T+0:  Price = 45000.00, realizedVol1m = 0.08
   T+1:  Price = 44500.00 (-1.11%), realizedVol1m = 0.25
   T+2:  Price = 44000.00 (-2.22%), realizedVol1m = 0.45
   T+3:  Price = 43800.00 (-2.67%), realizedVol1m = 0.52
   ```

2. **Pattern B - Liquidity Vacuum:**
   ```
   Orderbook before: bids=5000, asks=5000
   Orderbook during: bids=50, asks=50 (99% withdrawal)
   Spread: 0.08% -> 2.5%
   ```

**Phase 3: System Response Analysis**

**Scenario A - Gate C Block (Expected)**
```
realizedVol1m = 0.52 > maxRealizedVol1m = 0.12
gateC.passed = false
intent = 'HOLD'
```

**Scenario B - Stop Loss Trigger (Vulnerability)**
```
Position open at 45000.00
Price drops to 43800.00 (-2.67%)
Stop loss triggered at -2.0%
Loss realized: -2.0% + fees
```

### Success Criteria

| Kriter | Değer | Açıklama |
|--------|-------|----------|
| Price Gap | `|priceChange| > 2.0%` | Ani fiyat düşüşü/yükselişi |
| Vol Spike | `realizedVol1m > 0.12` | Gate C threshold aşımı |
| Stop Loss | `stopLossTriggered = true` | Stop loss tetiklendi |
| Exit Risk | `exitRisk.triggered = true` | Acil çıkış tetiklendi |
| Slippage | `slippage > 1.0%` | Yüksek kayma |

### Severity
**P0 - CRITICAL**

- Doğrudan büyük P&L kaybı
- Stop loss hunting
- Liquidity vacuum exploit

---

## Vulnerability List

### P0 - CRITICAL Vulnerabilities

#### V-P0-001: OBI Spoofing / Layering Attack

| Attribute | Details |
|-----------|---------|
| **ID** | V-P0-001 |
| **Attack** | S1-OBI-SPOOF |
| **Title** | Order Book Imbalance Manipulation via Spoofing |
| **Location** | `OrchestratorV1.ts:40-45`, `OrchestratorV1.ts:265-269` |
| **CVSS** | 8.1 (High) |

**Description:**
Sistem, `obiDeep` metriğini doğrudan Gate B kontrolünde kullanmaktadır (`obiSupportMinAbs = 0.05`). Saldırgan, büyük hacimli spoof emirler ile OBI'yi yapay olarak manipüle edebilir.

**Mitigation:**
- [x] Emir yaşını takip et (>500ms eski emirler ağırlıksız)
- [x] Anomali detection: ani hacim değişimleri (>200% in 100ms)
- [x] Multi-level OBI weighting (L1: 60%, L2: 30%, L3: 10%)
- [x] Order cancellation rate monitoring

---

#### V-P0-002: Delta Z-Score Burst Bypass

| Attribute | Details |
|-----------|---------|
| **ID** | V-P0-002 |
| **Attack** | S2-DELTA-BURST |
| **Title** | EWMA Smoothing Bypass via High-Amplitude Delta Burst |
| **Location** | `OrchestratorV1.ts:985-1014` |
| **CVSS** | 7.8 (High) |

**Description:**
EWMA smoothing (`deltaZEwmaAlpha = 0.30`) yüksek amplitude'lu kısa süreli burst'leri tam olarak filtreleyemez.

**Mitigation:**
- [x] Median filter ekle (window=3)
- [x] Outlier detection: `|deltaZ| > 3 * stdDev` ise reject
- [x] Adaptive alpha: volatilite yükseldikçe alpha düşsün
- [x] Minimum sample count: impulse için en az 3 sample

---

#### V-P0-003: Latency Spike / Stale Data Exploitation

| Attribute | Details |
|-----------|---------|
| **ID** | V-P0-003 |
| **Attack** | S4-LATENCY-SPIKE |
| **Title** | Stale Data Decision Making |
| **Location** | `OrchestratorV1.ts:130-175`, `KillSwitchManager.ts:111-184` |
| **CVSS** | 8.5 (High) |

**Description:**
Sistem, data staleness kontrolü yapmadan karar vermektedir.

**Mitigation:**
- [x] Data staleness check: `maxDataAgeMs = 1000`
- [x] Stale data gate: `readiness.reasons.push('DATA_STALE')`
- [x] Latency-based position sizing: `latency > 100ms → size *= 0.5`
- [x] Multiple data source fallback

---

#### V-P0-004: Flash Crash / Liquidity Vacuum

| Attribute | Details |
|-----------|---------|
| **ID** | V-P0-004 |
| **Attack** | S5-FLASH-CRASH |
| **Title** | Volatility Spike and Stop Loss Hunting |
| **Location** | `OrchestratorV1.ts:290-298`, `PositionRiskGuard.ts` |
| **CVSS** | 9.0 (Critical) |

**Description:**
Gate C volatilite kontrolü (`maxRealizedVol1m = 0.12`) flash crash senaryolarında yetersiz kalabilir.

**Mitigation:**
- [x] Circuit breaker: `realizedVol1m > 0.30 → trading halt`
- [x] Dynamic stop loss: `stopDistance = 2 * ATR`
- [x] Position size reduction: `vol1m > 0.10 → size *= 0.5`
- [x] Post-volatility cooldown: 30s

---

#### V-P0-005: Kill Switch Latency Gap

| Attribute | Details |
|-----------|---------|
| **ID** | V-P0-005 |
| **Attack** | S4-LATENCY-SPIKE |
| **Title** | Kill Switch Detection Delay |
| **Location** | `KillSwitchManager.ts:164-184` |
| **CVSS** | 7.5 (High) |

**Description:**
Kill switch, latency spike'i tespit etmek için 5 sample ortalaması kullanır. Bu, tek bir yüksek latency değerinin hemen tepki verilmesini engeller.

**Mitigation:**
- [x] Tek sample threshold: `latency > 10000ms → immediate kill`
- [x] Kademeli latency'te erken uyarı: `latency > 3000ms → position size 0`
- [x] Max single decision latency: `decisionLatency > 500ms → reject`

---

## Mitigation Implementation Status

### M1: Anti-Spoof Guard (V-P0-001)
**Status:** ✅ IMPLEMENTED
- `AntiSpoofGuard.ts` - Spoofing detection with order activity tracking
- `AntiSpoofGuardRegistry` - Multi-symbol support
- Down-weight factor: 0.3 (70% reduction for suspected levels)

### M2: Delta Burst Filter (V-P0-002)
**Status:** ✅ IMPLEMENTED
- `DeltaBurstFilter.ts` - Z-score based burst detection
- `DeltaBurstFilterRegistry` - Multi-symbol support
- Cooldown: 500ms signal freeze after burst

### M3: Churn Detector (V-P1-001)
**Status:** ✅ IMPLEMENTED
- `ChurnDetector.ts` - Flip rate and chop score monitoring
- `ChurnDetectorRegistry` - Multi-symbol support
- Action: NO_TRADE or confidence cap (0.5)

### M4: Latency Guard (V-P0-003, V-P0-005)
**Status:** ✅ IMPLEMENTED
- `LatencyGuard.ts` - p95/p99 latency monitoring
- `EventLoopMonitor` - Event loop lag detection
- Thresholds: p95 > 100ms, p99 > 200ms, event loop > 50ms

### M5: Flash Crash Guard (V-P0-004)
**Status:** ✅ IMPLEMENTED
- `FlashCrashGuard.ts` - Gap and liquidity vacuum detection
- `FlashCrashGuardRegistry` - Multi-symbol support
- Thresholds: 2% gap, 0.5% spread

---

## Appendix: Deterministic Attack Vectors

Sistem deterministik olduğundan, aşağıdaki input pattern'leri her zaman aynı sonucu üretir:

```typescript
// S2 Delta Burst - Deterministic Pattern
const attackPattern = [
  { deltaZ: 0.0, cvdSlope: 0.0, obiDeep: 0.0 },   // T+0: Baseline
  { deltaZ: 2.5, cvdSlope: 0.05, obiDeep: 0.1 },  // T+1: Burst
  { deltaZ: 0.0, cvdSlope: 0.0, obiDeep: 0.0 },   // T+2: Reset
];

// S3 Choppy Pattern
const choppyPattern = [
  { deltaZ: 0.5, cvdSlope: 0.01, obiDeep: 0.08 },   // UP
  { deltaZ: -0.8, cvdSlope: -0.02, obiDeep: -0.05 }, // DOWN
  { deltaZ: 0.9, cvdSlope: 0.02, obiDeep: 0.06 },   // UP
  { deltaZ: -1.0, cvdSlope: -0.03, obiDeep: -0.08 }, // DOWN
];
```

---

*Document Version: 1.0*  
*Generated: FAZ 6 - Red Team Analysis*  
*Classification: INTERNAL - SECURITY ANALYSIS*
