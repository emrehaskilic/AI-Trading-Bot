# FAZ-5 Strategy Framework Architecture

## Overview

The FAZ-5 Strategy Framework provides a modular, deterministic system for trading strategy evaluation, signal lifecycle management, and consensus-based decision making. It integrates with existing FAZ-1 through FAZ-4 components while maintaining clean separation of concerns.

## Core Principles

1. **Deterministic Behavior**: All timestamps are explicit parameters (no `Date.now()`)
2. **No Hidden State**: All state changes are explicit and traceable
3. **Clean Separation**: Each module has a single, well-defined responsibility
4. **Integration First**: Designed to work with existing RiskStateManager, Orchestrator, and Position systems

## File Structure

```
/mnt/okcomputer/output/
├── ARCHITECTURE.md                          # This document
├── server/
│   ├── risk/
│   │   └── RiskStateManager.ts              # Risk state definitions (TRACKING, REDUCED_RISK, HALTED, KILL_SWITCH)
│   ├── strategies/
│   │   ├── types.ts                         # Core type definitions (StrategyContext, StrategySignal, etc.)
│   │   ├── StrategyContextBuilder.ts        # Builds StrategyContext from system inputs
│   │   └── SignalLifecycleManager.ts        # Manages signal lifecycle (VALID -> EXPIRED/INVALIDATED/SUPERSEDED)
│   └── consensus/
│       └── ConsensusConfig.ts               # Consensus configuration and regime-specific overrides
```

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STRATEGY FRAMEWORK                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐                                                     │
│  │   RiskStateManager  │◄─────────────────────────────────────────┐         │
│  │   (FAZ-2)           │                                          │         │
│  │                     │    RiskState, riskMultiplier             │         │
│  └─────────────────────┘                                          │         │
│           ▲                                                       │         │
│           │                                                       │         │
│  ┌────────┴────────────┐                                          │         │
│  │ StrategyContext     │                                          │         │
│  │ Builder             │◄─────────────────────────────────────────┤         │
│  │                     │    OrchestratorMetricsInput              │         │
│  │  - extractMetrics() │                                          │         │
│  │  - calculateOB()    │◄─────────────────────────────────────────┤         │
│  │  - determineRegime()│    PositionState                         │         │
│  └────────┬────────────┘                                          │         │
│           │                                                       │         │
│           │ StrategyContext                                       │         │
│           ▼                                                       │         │
│  ┌─────────────────────┐                                          │         │
│  │   IStrategy         │                                          │         │
│  │   Implementations   │                                          │         │
│  │                     │                                          │         │
│  │  - evaluate()       │                                          │         │
│  │  - isApplicable()   │                                          │         │
│  └────────┬────────────┘                                          │         │
│           │                                                       │         │
│           │ StrategySignal                                        │         │
│           ▼                                                       │         │
│  ┌─────────────────────┐                                          │         │
│  │ SignalLifecycle     │                                          │         │
│  │ Manager             │                                          │         │
│  │                     │                                          │         │
│  │  - registerSignal() │                                          │         │
│  │  - isValid()        │                                          │         │
│  │  - expireSignals()  │                                          │         │
│  │  - invalidate()     │                                          │         │
│  └────────┬────────────┘                                          │         │
│           │                                                       │         │
│           │ Valid Signals[]                                       │         │
│           ▼                                                       │         │
│  ┌─────────────────────┐                                          │         │
│  │ ConsensusEngine     │◄─────────────────────────────────────────┘         │
│  │ (to be implemented) │    ConsensusConfig (regime-specific)               │
│  │                     │                                                     │
│  │  - aggregate()      │◄──────────────────────────────────────────────────┤
│  │  - applyVeto()      │                                                     │
│  │  - resolveConflict()│                                                     │
│  └────────┬────────────┘                                                     │
│           │                                                                   │
│           │ ConsensusResult                                                   │
│           ▼                                                                   │
│  ┌─────────────────────┐                                                     │
│  │   Orchestrator      │                                                     │
│  │   (FAZ-3/4)         │                                                     │
│  │                     │                                                     │
│  │  - executeDecision()│                                                     │
│  └─────────────────────┘                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   Phase 1: Context Building                                                   │
│   ═══════════════════════                                                     │
│                                                                               │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│   │   Metrics    │    │   Position   │    │    Risk      │                   │
│   │   System     │    │   Manager    │    │   State      │                   │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                   │
│          │                   │                   │                            │
│          │                   │                   │                            │
│          ▼                   ▼                   ▼                            │
│   ┌────────────────────────────────────────────────────┐                     │
│   │         StrategyContextBuilder.build()             │                     │
│   │                                                    │                     │
│   │  • extractMetrics()     → metrics snapshot         │                     │
│   │  • calculateOrderbook() → bid/ask depth, imbalance │                     │
│   │  • determineRegime()    → regime + confidence      │                     │
│   │  • mapPositionState()   → position summary         │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│                            │ StrategyContext                                   │
│                            ▼                                                  │
│                                                                               │
│   Phase 2: Strategy Evaluation                                                │
│   ═══════════════════════════                                                 │
│                                                                               │
│   ┌────────────────────────────────────────────────────┐                     │
│   │              StrategyContext                       │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│           ┌────────────────┼────────────────┐                                 │
│           │                │                │                                 │
│           ▼                ▼                ▼                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                          │
│   │ Strategy A  │  │ Strategy B  │  │ Strategy C  │                          │
│   │  evaluate() │  │  evaluate() │  │  evaluate() │                          │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                          │
│          │                │                │                                  │
│          │ StrategySignal │ StrategySignal │ StrategySignal                   │
│          │ (or null)      │ (or null)      │ (or null)                        │
│          ▼                ▼                ▼                                  │
│   ┌────────────────────────────────────────────────────┐                     │
│   │         SignalLifecycleManager                     │                     │
│   │         registerSignal()                           │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│                            │ Registered Signals                              │
│                            ▼                                                  │
│                                                                               │
│   Phase 3: Lifecycle Management                                               │
│   ═════════════════════════════                                               │
│                                                                               │
│   ┌────────────────────────────────────────────────────┐                     │
│   │         SignalLifecycleManager                     │                     │
│   │                                                    │                     │
│   │  VALID ──► EXPIRED     (time > validUntil)         │                     │
│   │  VALID ──► INVALIDATED (event-based)               │                     │
│   │  VALID ──► SUPERSEDED  (newer signal)              │                     │
│   │                                                    │                     │
│   │  expireSignals(currentTime)                        │                     │
│   │  invalidateSignal(id, reason, time)                │                     │
│   │  getValidSignals(currentTime)                      │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│                            │ Valid Signals Only                               │
│                            ▼                                                  │
│                                                                               │
│   Phase 4: Consensus Aggregation                                              │
│   ══════════════════════════════                                              │
│                                                                               │
│   ┌────────────────────────────────────────────────────┐                     │
│   │              Valid Signals[]                       │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│                            ▼                                                  │
│   ┌────────────────────────────────────────────────────┐                     │
│   │         ConsensusEngine.aggregate()                │                     │
│   │                                                    │                     │
│   │  1. Filter by confidence threshold                 │                     │
│   │  2. Apply category weights                         │                     │
│   │  3. Calculate weighted scores                      │                     │
│   │  4. Check for veto conditions                      │                     │
│   │  5. Resolve conflicts                              │                     │
│   │  6. Determine consensus                            │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│                            │ ConsensusResult                                   │
│                            │ (hasConsensus, direction, action, confidence)    │
│                            ▼                                                  │
│                                                                               │
│   Phase 5: Decision Execution                                                 │
│   ═══════════════════════════                                                 │
│                                                                               │
│   ┌────────────────────────────────────────────────────┐                     │
│   │              ConsensusResult                       │                     │
│   └────────────────────────┬───────────────────────────┘                     │
│                            │                                                  │
│                            ▼                                                  │
│   ┌────────────────────────────────────────────────────┐                     │
│   │         Orchestrator.executeDecision()             │                     │
│   │                                                    │                     │
│   │  • Risk gate check                                 │                     │
│   │  • Position sizing                                 │                     │
│   │  • Order execution                                 │                     │
│   │  • Position tracking                               │                     │
│   └────────────────────────────────────────────────────┘                     │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Module Descriptions

### 1. RiskStateManager (`server/risk/RiskStateManager.ts`)

**Purpose**: Define risk states and their configurations.

**Exports**:
- `RiskState` enum: TRACKING, REDUCED_RISK, HALTED, KILL_SWITCH
- `RiskStateConfig` interface
- `getRiskMultiplier(state)`: Returns 1.0, 0.5, 0.0, 0.0 respectively
- `canOpenNewPositions(state)`: Permission check
- `canIncreasePositions(state)`: Permission check

**Integration Points**:
- Used by StrategyContextBuilder to set riskMultiplier
- Used by ConsensusConfig for risk-based adjustments

### 2. Strategy Types (`server/strategies/types.ts`)

**Purpose**: Define all types used by the strategy framework.

**Key Types**:
- `StrategyContext`: Unified input for all strategies
- `IStrategy`: Base interface for strategy implementations
- `StrategySignal`: Output from strategy evaluation
- `StrategySignalState`: VALID, EXPIRED, INVALIDATED, SUPERSEDED
- `TTLConfig`: Time-to-live configuration
- `ConsensusConfig`: Consensus aggregation settings
- `ConsensusResult`: Output from consensus engine

**Integration Points**:
- `OrchestratorMetricsInput`: Mirrors existing orchestrator interface
- `PositionState`: Mirrors existing position system
- `GateResult`: Mirrors existing risk gate interface
- `DecisionAction`: Mirrors existing decision types

### 3. StrategyContextBuilder (`server/strategies/StrategyContextBuilder.ts`)

**Purpose**: Build StrategyContext from disparate system inputs.

**Key Methods**:
- `build(metricsInput, positionState, riskState, timestamp)`: Main entry point
- `extractMetrics(input, timestamp)`: Normalize metrics
- `calculateOrderbookState(input)`: Compute depth and imbalance
- `determineRegime(input, metrics)`: Classify market regime

**Deterministic Guarantees**:
- All outputs depend only on inputs and timestamp
- No external state access
- No `Date.now()` calls

**Configuration**:
- `ContextBuilderConfig`: Customizable thresholds
- `DEFAULT_CONTEXT_BUILDER_CONFIG`: Sensible defaults

### 4. SignalLifecycleManager (`server/strategies/SignalLifecycleManager.ts`)

**Purpose**: Manage signal lifecycle with explicit timestamps.

**State Machine**:
```
                    ┌─────────────┐
                    │   VALID     │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   EXPIRED   │ │ INVALIDATED │ │  SUPERSEDED │
    │  (time >    │ │  (event)    │ │  (new sig)  │
    │  validUntil)│ │             │ │             │
    └─────────────┘ └─────────────┘ └─────────────┘
```

**Key Methods**:
- `registerSignal(signal)`: Add new signal
- `isValid(signalId, currentTime)`: Check validity
- `expireSignals(currentTime)`: Expire old signals
- `invalidateSignal(signalId, reason, timestamp)`: Event-based invalidation
- `getValidSignals(currentTime)`: Get all valid signals

**TTL Configuration**:
- `defaultTTLMs`: Base time-to-live
- `maxTTLMs`: Upper bound
- `minTTLMs`: Lower bound
- `regimeAdjustments`: Per-regime multipliers
- `volatilityMultiplier`: Volatility-based adjustments

### 5. ConsensusConfig (`server/consensus/ConsensusConfig.ts`)

**Purpose**: Define consensus configurations with regime and risk overrides.

**Configurations**:
- `DEFAULT_CONSENSUS_CONFIG`: Balanced defaults
- `REGIME_SPECIFIC_CONFIG`: Per-regime overrides
- `RISK_STATE_ADJUSTMENTS`: Per-risk-state overrides

**Resolution Logic**:
```typescript
config = { ...DEFAULT_CONSENSUS_CONFIG }
config = { ...config, ...REGIME_SPECIFIC_CONFIG[regime] }
config = { ...config, ...RISK_STATE_ADJUSTMENTS[riskState] }
```

**Presets**:
- `CONSERVATIVE`: High thresholds, diverse categories required
- `AGGRESSIVE`: Low thresholds, fast entry
- `BALANCED`: Default settings
- `TESTING`: Minimal requirements for testing

## Integration Points with Existing Systems

### With RiskStateManager (FAZ-2)

```typescript
// RiskStateManager provides:
enum RiskState { TRACKING, REDUCED_RISK, HALTED, KILL_SWITCH }
function getRiskMultiplier(state: RiskState): number

// StrategyContextBuilder uses:
const riskMultiplier = getRiskMultiplier(riskState);

// ConsensusConfig uses:
const config = resolveConsensusConfig(regime, riskState);
```

### With Orchestrator (FAZ-3/4)

```typescript
// Orchestrator provides:
interface OrchestratorMetricsInput {
  symbol: string;
  timestamp: number;
  metrics: { ... };
  position?: PositionState;
}

// StrategyContextBuilder uses:
const context = builder.build(metricsInput, positionState, riskState, timestamp);

// Orchestrator receives:
interface ConsensusResult {
  hasConsensus: boolean;
  direction: SignalDirection | null;
  action: SignalAction | null;
  confidence: number;
}
```

### With Position Management

```typescript
// Position system provides:
interface PositionState {
  hasPosition: boolean;
  side: 'LONG' | 'SHORT' | null;
  size: number;
  entryPrice: number | null;
  unrealizedPnl: number | null;
}

// StrategyContext maps to:
position: {
  hasPosition: boolean;
  side: 'LONG' | 'SHORT' | null;
  size: number;
  entryPrice: number | null;
  unrealizedPnl: number | null;
}
```

## Deterministic Behavior Guarantees

1. **Explicit Timestamps**: Every method that depends on time receives `timestamp` or `currentTime` as a parameter
2. **No Date.now()**: Framework never calls `Date.now()` internally
3. **Pure Functions**: All builder methods are pure functions of their inputs
4. **Immutable State**: Signal storage uses clones to prevent external mutation
5. **Predictable TTL**: Signal expiration is based solely on `validUntil` timestamp

## Example Usage

```typescript
// 1. Build context
const builder = new StrategyContextBuilder();
const context = builder.build(
  metricsInput,
  positionState,
  RiskState.TRACKING,
  1704067200000  // Explicit timestamp
);

// 2. Evaluate strategies
const signals: StrategySignal[] = [];
for (const strategy of strategies) {
  if (strategy.isApplicable(context)) {
    const signal = strategy.evaluate(context, 1704067200000);
    if (signal) signals.push(signal);
  }
}

// 3. Register signals
const lifecycleManager = new SignalLifecycleManager();
for (const signal of signals) {
  lifecycleManager.registerSignal(signal);
}

// 4. Get valid signals
const validSignals = lifecycleManager.getValidSignals(1704067200500);

// 5. Resolve consensus config
const consensusConfig = resolveConsensusConfig(
  context.regime.current,
  context.riskState
);

// 6. Aggregate (ConsensusEngine to be implemented)
// const result = consensusEngine.aggregate(validSignals, consensusConfig);
```

## Future Extensions

1. **ConsensusEngine**: Implement signal aggregation logic
2. **StrategyRegistry**: Dynamic strategy loading and management
3. **BacktestingAdapter**: Run strategies against historical data
4. **PerformanceTracker**: Track strategy performance metrics
5. **RegimeDetector**: More sophisticated regime classification

## Testing Strategy

1. **Unit Tests**: Each module in isolation
2. **Integration Tests**: Module interactions
3. **Determinism Tests**: Same inputs always produce same outputs
4. **Timestamp Tests**: Verify explicit timestamp handling
5. **Lifecycle Tests**: State transitions work correctly

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-01 | Initial FAZ-5 architecture |
