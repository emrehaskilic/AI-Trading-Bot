# AI Trading Bot - Strateji Dokumani (Detayli)

Bu dokuman, projede aktif olan asagidaki 3 stratejiyi teknik olarak detayli anlatir:

- `trend-follow-v1`
- `mean-revert-v1`
- `chop-filter-v1`

Dokuman, stratejilerin tek tek calisma mantigini, confidence hesaplamasini, consensus etkisini, risk-state etkisini ve operasyonel tuning noktalarini kapsar.

---

## 1) Sistem Icindeki Konumlari

Bu 3 strateji runtime'da registry'e burada eklenir:

- `server/index.ts`
  - `strategyRegistry.register(new ExampleTrendFollowStrategy())`
  - `strategyRegistry.register(new ExampleMeanRevertStrategy())`
  - `strategyRegistry.register(new ExampleChopFilterStrategy())`

Signal akisi kisaca su sekildedir:

1. Market ve risk verisi `StrategyContextBuilder` ile normalize edilir.
2. Her strateji bu context'i `evaluate()` ile yorumlar.
3. Uretilen sinyaller `ConsensusEngine` tarafinda filtrelenir/oylanir.
4. Consensus sonucu risk gate'den gecer.
5. Son karar orchestrator tarafinda trade aksiyonuna donusur.

---

## 2) Ortak Veri Modeli ve Ortak Kurallar

### 2.1 StrategyContext (tum stratejilerin girdisi)

Ana girdiler:

- `m3TrendScore` (yaklasik -1..1)
- `m5TrendScore` (yaklasik -1..1)
- `obiDeep` (orderbook imbalance, -1..1)
- `deltaZ` (delta z-score)
- `volatilityIndex`
- `timestamp`, `symbol`, `price`
- `marketData.riskState`, `marketData.riskMultiplier`

Builder tarafinda clamp/normalize yapilarak stratejilere daha stabil input verilir.

### 2.2 Ortak signal kurali

Tum stratejiler `BaseStrategy` sinifindan gelir:

- Signal side: `LONG | SHORT | FLAT`
- Confidence: `0..1` araligina clamp edilir.
- Varsayilan signal gecerlilik suresi: `5000ms`

### 2.3 Consensus icindeki ortak filtreler

`ConsensusEngine` default ayarlari:

- `minQuorumSize = 2`
- `minConfidenceThreshold = 0.3` (signal kabul edilmesi icin alt limit)
- `maxSignalAgeMs = 5000`
- `minActionConfidence = 0.5`
- `includeFlatSignals = false`

Yani bir strateji signal uretse bile:

- confidence `0.3` altindaysa consensus girisinde elenir,
- yeterli quorum yoksa trade cikmaz,
- karar confidence'i `0.5` altinda kalirsa trade cikmaz.

---

## 3) `trend-follow-v1` (Example Trend Follow)

Kaynak: `server/strategies/examples/ExampleTrendFollow.ts`

### 3.1 Amac

Kisa ve orta trend skorlarini birlestirip momentum yonunde pozisyon onerir.

### 3.2 Varsayilan parametreler

- `longThreshold: 0.3`
- `shortThreshold: -0.3`
- `m3Weight: 0.4`
- `m5Weight: 0.6`
- `maxConfidence: 0.95`

Not: `m3Weight + m5Weight` toplamı 1 degilse constructor'da normalize edilir.

### 3.3 Signal uretim mantigi

Hesap:

`weightedTrendScore = (m3TrendScore * 0.4) + (m5TrendScore * 0.6)`

Karar:

- `weightedTrendScore >= 0.3` -> `LONG`
- `weightedTrendScore <= -0.3` -> `SHORT`
- aralikta kalirsa -> `FLAT`

### 3.4 Confidence mantigi

Trend threshold'dan ne kadar uzaksa confidence artar.

- Esik seviyede confidence dusuk baslar.
- Score mutlak olarak buyudukce confidence artar.
- `maxConfidence` ile sinirlanir (`<= 0.95`).

### 3.5 Pratik yorum

Guclu yanlar:

- Yonu olan piyasada hizli uyum.
- Hesap basit ve deterministik.

Zayif yanlar:

- Range/chop donemlerinde false direction riski.
- Tek basina kullanildiginda pullback'te gecikme.

Ne zaman iyi calisir:

- Trend+momentum net oldugunda.
- Spread ve execution maliyeti makulken.

---

## 4) `mean-revert-v1` (Example Mean Revert)

Kaynak: `server/strategies/examples/ExampleMeanRevert.ts`

### 4.1 Amac

OBI'deki asiri sapmayi tespit edip ortalamaya donus yonunde sinyal vermek.

### 4.2 Varsayilan parametreler

- `oversoldThreshold: -0.4`
- `overboughtThreshold: 0.4`
- `deltaZThreshold: 1.5`
- `obiWeight: 0.6`
- `deltaZWeight: 0.4`
- `maxConfidence: 0.9`

Not: `obiWeight + deltaZWeight` toplamı 1 degilse normalize edilir.

### 4.3 Signal uretim mantigi

Girdi:

- `obiDeep`
- `deltaZ`

Kurallar:

- `obiDeep <= -0.4` ise potansiyel `LONG` (oversold)
- `obiDeep >= 0.4` ise potansiyel `SHORT` (overbought)
- Bu kosullar yoksa `FLAT`

`deltaZ` dogrudan side secimi degil, confidence teyidi icin kullanilir:

- `abs(deltaZ) >= 1.5` ise `deltaZConfirmation = true`
- teyit varsa confidence'a boost uygulanir.

### 4.4 Confidence mantigi

Confidence iki bilesenden gelir:

1. OBI sapmasi (threshold disina ne kadar cikildigi)
2. DeltaZ sapmasi (`abs(deltaZ) - 1.5`)

Karmasi:

`confidence = obiPart * 0.6 + deltaPart * 0.4`

Ek kural:

- `deltaZConfirmation == true` ise confidence `* 1.2` boost alir.
- Sonrasinda `0..0.9` araligina clamp edilir.

### 4.5 Pratik yorum

Guclu yanlar:

- Asiri fiyat/akim sapmasinda iyi calisir.
- Counter-move firsatlarini yakalayabilir.

Zayif yanlar:

- Guclu trendde erken ters islem riski.
- Yanlis threshold ile whipsaw uretebilir.

Ne zaman iyi calisir:

- Mikro asiriliklarin geri alinma olasiliginin yuksek oldugu donemlerde.
- OBI anomalisi ile deltaZ birlikte anlamli ise.

---

## 5) `chop-filter-v1` (Example Chop Filter)

Kaynak: `server/strategies/examples/ExampleChopFilter.ts`

### 5.1 Amac

Trade acan strateji degildir. Piyasa cok chop/low-vol ise diger stratejileri veto ederek sistemi korur.

### 5.2 Varsayilan parametreler

- `chopThreshold: 0.15`
- `minVolatility: 0.1`
- `hysteresis: 0.02`
- `cooldownMs: 10000`

### 5.3 Veto yetkisi

Bu strateji `canVeto()` ile `true` dondurur.

Consensus tarafinda veto kurali:

- `FLAT` ve `metadata.canVeto === true` bir signal varsa,
- consensus sadece `FLAT` sinyalleri tutar.
- Sonuc trade acilmasini efektif olarak engeller.

### 5.4 Signal uretim mantigi

Girdi:

- `volatilityIndex`

Durumlar:

- `isChoppy = volatilityIndex < effectiveThreshold`
- `isTooLow = volatilityIndex < minVolatility`
- `inCooldown = (timestamp - lastChopTimestamp) < cooldownMs`

Hysteresis:

- Chop state'den cikis esigi daha yuksek tutulur:
  - chop icindeyken cikis icin `chopThreshold + hysteresis`
  - chop'a giris icin `chopThreshold`

Signal:

- Chop/low vol/cooldown aktifse: `FLAT`, `metadata.canVeto = true`
- Normal kosulda: `FLAT`, dusuk confidence, `canVeto = false`

### 5.5 Pratik yorum

Guclu yanlar:

- Kotu market rejiminde gereksiz trade frekansini keser.
- Trend ve mean-revert stratejilerini koruyucu katman gibi filtreler.

Zayif yanlar:

- Esik cok agresifse firsat kacirabilir.
- Volatilite olcumu noisy ise gereksiz veto yaratabilir.

Ne zaman iyi calisir:

- Spread/genel noise yuksekken.
- Backtest'te chop donemleri net zarar getiriyorsa.

---

## 6) Bu 3 Stratejinin Birlikte Davranisi

### 6.1 Birbirlerini nasil etkiler?

- `trend-follow-v1`: yon onerir.
- `mean-revert-v1`: ters yone donus onerir.
- `chop-filter-v1`: piyasa uygunsuzsa ikisini de bloke eder.

### 6.2 Ornek durumlar

Durum A - Trend guclu, vol yeterli:

- trend-follow `LONG` (yuksek confidence)
- mean-revert `FLAT` veya zayif ters
- chop-filter `FLAT + canVeto=false`
- consensus -> buyuk olasilikla `LONG`

Durum B - OBI asiri, vol yeterli:

- mean-revert kuvvetli `SHORT` veya `LONG` (asirilik yone gore)
- trend-follow zayif kalabilir
- chop-filter veto etmez
- consensus -> quorum ve confidence'a gore aksiyon

Durum C - Chop market:

- chop-filter `FLAT + canVeto=true`
- digerleri sinyal verse bile veto devreye girebilir
- consensus genelde `FLAT`

---

## 7) Risk State Etkisi (Consensus Sonrasi)

Risk state consensus sonucunu son adimda degistirebilir:

- `TRACKING`: normal calisir
- `REDUCED_RISK`: confidence dusurulur (trade alma ihtimali azalir)
- `HALTED`: zorla `FLAT`
- `KILL_SWITCH`: zorla `FLAT`

Yani stratejiler sinyal uretse bile risk katmani nihai karari baskilayabilir.

---

## 8) Tuning Rehberi (Operasyonel)

### 8.1 Trend-follow tuning

- Daha agresif icin:
  - `longThreshold`/`shortThreshold` mutlak degerini dusur.
- Daha secici icin:
  - threshold'lari artir.
- Kisa vadeyi guclendirmek icin:
  - `m3Weight` yukari cek.
- Orta vadeyi guclendirmek icin:
  - `m5Weight` yukari cek.

### 8.2 Mean-revert tuning

- Daha cok signal icin:
  - `oversoldThreshold` ve `overboughtThreshold` mutlak degerini dusur.
- Daha kaliteli ama az signal icin:
  - thresholdlari buyut, `deltaZThreshold` artir.
- OBI etkisini artirmak icin:
  - `obiWeight` artir.

### 8.3 Chop-filter tuning

- Veto sayisi coksa:
  - `chopThreshold` dusur veya `minVolatility` dusur.
- Chop'tan gec cikiyorsa:
  - `hysteresis` azalt.
- Veto salinimi varsa:
  - `cooldownMs` arttir.

---

## 9) Canli Takipte Bakilacak Metrikler

Asagidaki metrikleri birlikte izle:

- Strategy panel:
  - her stratejinin side/confidence dagilimi
- Consensus:
  - quorum met orani
  - veto applied sayisi
  - side mismatch olaylari
- Risk:
  - `REDUCED_RISK/HALTED/KILL_SWITCH` gecisleri
- Resilience:
  - chop/veto benzeri supress pattern'leri

Ideal isletim:

- Trend doneminde veto dusuk,
- Chop doneminde veto yuksek,
- Net getiride drawdown disiplinli.

---

## 10) Ozet Tablo

| Strateji | Ana Input | Ana Amac | Signal Tipi | Veto Yetkisi |
|---|---|---|---|---|
| `trend-follow-v1` | `m3Trend`, `m5Trend` | Momentum yonunde gitmek | LONG/SHORT/FLAT | Hayir |
| `mean-revert-v1` | `obiDeep`, `deltaZ` | Asiri sapmadan donus | LONG/SHORT/FLAT | Hayir |
| `chop-filter-v1` | `volatilityIndex` | Chop markette trade'i kesmek | FLAT (filtre) | Evet |

---

## 11) Sonuc

Bu uc strateji birlikte calistiginda:

- Trend takip + mean reversion ile yon/firsat kapsami genisler.
- Chop filter yanlis rejimdeki islemleri kisar.
- Consensus ve risk gate, ham strateji sinyallerini production davranisina cevirir.

En kritik nokta: parametre tuning'i tek tek degil, uc strateji + consensus + risk state birlikte degerlendirilmelidir.
