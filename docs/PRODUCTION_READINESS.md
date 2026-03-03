# Production Readiness Guide

## Overview

This document describes the production readiness features implemented for the AI Trading Bot. These features provide comprehensive observability, telemetry, health monitoring, and configuration management to ensure the system operates safely and reliably in production environments.

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Module Overview](#module-overview)
4. [Setup Instructions](#setup-instructions)
5. [Configuration Guide](#configuration-guide)
6. [Monitoring Endpoints](#monitoring-endpoints)
7. [Integration Guide](#integration-guide)
8. [Troubleshooting](#troubleshooting)

## Features

### Observability

- **Structured Logging**: JSON-formatted logs with correlation IDs for distributed tracing
- **Module-based Logging**: Separate loggers for risk, strategy, execution, WebSocket, and other modules
- **Log Throttling**: Prevents error spam through intelligent deduplication
- **Sampling**: Configurable sampling for high-volume log scenarios
- **Performance Logging**: Built-in utilities for timing operations

### Telemetry

- **Metrics Collection**: Counter, Gauge, and Histogram metric types
- **Pre-defined Metrics**: Trade attempts, rejections, PnL, risk state, latency measurements
- **Export Formats**: JSON and Prometheus exposition format
- **Decision Logging**: Audit trail for all trading decisions
- **System Snapshots**: Capture and store complete system state

### Health & Readiness

- **Health Endpoint**: Basic alive check with system status
- **Readiness Endpoint**: Comprehensive check for trading readiness
- **Dependency Checks**: WebSocket, risk manager, kill switch, memory
- **Graceful Shutdown**: Proper handling of SIGTERM, SIGINT signals
- **Auto Health Checks**: Periodic background health monitoring

### Configuration

- **Safe Defaults**: Conservative defaults prioritizing safety
- **Environment Variable Mapping**: Easy configuration via env vars
- **Zod Schema Validation**: Type-safe configuration with detailed error messages
- **Dangerous Value Detection**: Warnings for risky configurations
- **Fail-Fast Validation**: Application crashes immediately on invalid config

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Production Readiness System                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Logging    │  │   Telemetry  │  │    Health    │          │
│  │   Module     │  │   Module     │  │   Module     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│              ┌────────────┴────────────┐                       │
│              │   Integration Module    │                       │
│              └────────────┬────────────┘                       │
│                           │                                     │
│              ┌────────────┴────────────┐                       │
│              │   Configuration Module  │                       │
│              └─────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

## Module Overview

### 1. Logging Module (`server/logging/`)

**Files:**
- `types.ts` - LogLevel, LogEntry, LogContext, LoggerConfig types
- `Logger.ts` - Main Logger class implementation
- `index.ts` - Exports and factory functions

**Key Features:**
```typescript
import { getLogger, logger } from './server/logging';

// Module-specific logger
const riskLogger = getLogger('risk');
riskLogger.info('Position limit check', { position: 100, limit: 150 });

// With correlation ID
const executionLogger = getLogger('execution', 'req-123');
executionLogger.info('Order submitted', { orderId: 'ord-456' });

// Error logging with throttling
executionLogger.error('Order failed', error, { orderId: 'ord-456' });
```

**Environment Variables:**
- `LOG_LEVEL` - debug, info, warn, error
- `LOG_THROTTLE_MS` - Error throttling interval (default: 60000)
- `LOG_SAMPLE_RATE` - Log sampling rate 0.0-1.0 (default: 1.0)

### 2. Telemetry Module (`server/telemetry/`)

**Files:**
- `types.ts` - Metric type definitions and constants
- `MetricsCollector.ts` - Counter, Gauge, Histogram implementations
- `TelemetryExporter.ts` - Export functions for JSON/Prometheus formats
- `Snapshot.ts` - System state capture
- `DecisionLog.ts` - Decision audit trail
- `index.ts` - Main exports and TradingBotMetrics class

**Key Features:**
```typescript
import { metrics, MetricNames, RiskState } from './server/telemetry';

// Record metrics
metrics.recordTradeAttempt();
metrics.recordTradeRejected();
metrics.setRiskState(RiskState.WARNING);
metrics.setPnL(150.75);
metrics.recordWsLatency(45);

// Get telemetry snapshot
const snapshot = metrics.getSnapshot();

// Export metrics
const jsonMetrics = metrics.toJSON();
const prometheusMetrics = metrics.toPrometheus();
```

**Pre-defined Metrics:**
- `trade_attempt_total` - Counter
- `trade_rejected_total` - Counter
- `kill_switch_triggered_total` - Counter
- `risk_state_current` - Gauge (0=normal, 1=warning, 2=halted)
- `analytics_pnl_gauge` - Gauge
- `ws_latency_histogram` - Histogram

### 3. Health Module (`server/health/`)

**Files:**
- `types.ts` - HealthStatus, ReadinessStatus, HealthReport types
- `ReadinessChecker.ts` - WS, risk, killSwitch, memory checks
- `HealthController.ts` - /health and /ready endpoints, graceful shutdown
- `index.ts` - Module exports

**Key Features:**
```typescript
import { HealthController, initializeGracefulShutdown } from './server/health';

// Create controller
const controller = new HealthController('1.0.0', 'production');

// Initialize graceful shutdown
controller.initializeGracefulShutdown();

// Get health status
const health = controller.getHealth();
console.log(health.body.status); // HEALTHY, DEGRADED, or UNHEALTHY

// Get readiness status
const ready = controller.getReady();
console.log(ready.body.status); // READY, DEGRADED, or NOT_READY
```

**Readiness Checks:**
- WebSocket connection active
- Risk state NOT HALTED
- Kill switch NOT active
- Memory usage below threshold

### 4. Configuration Module (`server/config/`)

**Files:**
- `types.ts` - Configuration type definitions
- `SafeDefaults.ts` - SAFE_DEFAULTS constant
- `ConfigSchema.ts` - Zod schemas for validation
- `ConfigValidator.ts` - Validation logic
- `index.ts` - Main entry point with auto-initialization

**Key Features:**
```typescript
import { getConfig, getTradingConfig } from './server/config';

// Get full configuration (auto-initialized on import)
const config = getConfig();

// Get specific sections
const trading = getTradingConfig();
const system = getSystemConfig();

// Access values
console.log(trading.latencyThreshold);
console.log(system.logLevel);
```

**Environment Variables:**
- `LATENCY_THRESHOLD` - Max acceptable latency in ms
- `FLASH_CRASH_THRESHOLD` - Price drop detection threshold
- `MAX_DRAWDOWN` - Max drawdown before halt
- `CONFIDENCE_THRESHOLD` - Min confidence for trades
- `TRADING_ENABLED` - Enable trading (default: false)
- `PAPER_TRADING` - Use paper trading (default: true)
- `EXCHANGE_TESTNET` - Use testnet (default: true)
- `LOG_LEVEL` - Logging level
- `MEMORY_THRESHOLD` - Memory usage threshold
- `DAILY_LOSS_LIMIT` - Daily loss limit percentage
- `CIRCUIT_BREAKER_ENABLED` - Enable circuit breaker

### 5. Integration Module (`server/integration/`)

**Files:**
- `index.ts` - Integration points between all modules

**Key Features:**
```typescript
import { ProductionReadinessSystem, setupExpressEndpoints } from './server/integration';

// Initialize complete system
const system = new ProductionReadinessSystem({
  version: '1.0.0',
  environment: 'production',
});
system.initialize();

// Use with Express
import express from 'express';
const app = express();
setupExpressEndpoints(app, system);

// Record trading activity
system.recordTradeAttempt();
system.recordTradeRejected('Risk limit exceeded');
system.setRiskState(RiskState.HALTED);
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install zod  # Required for configuration validation
```

### 2. Environment Configuration

Create a `.env` file:

```bash
# Required
NODE_ENV=production

# Trading Configuration
TRADING_ENABLED=false
PAPER_TRADING=true
EXCHANGE_TESTNET=true

# Exchange API (required when TRADING_ENABLED=true)
EXCHANGE_API_KEY=your_api_key
EXCHANGE_API_SECRET=your_api_secret

# System Configuration
LOG_LEVEL=info
MEMORY_THRESHOLD=80
PORT=3000

# Risk Management
DAILY_LOSS_LIMIT=5
CIRCUIT_BREAKER_ENABLED=true
```

### 3. Basic Integration

```typescript
import express from 'express';
import { ProductionReadinessSystem, setupExpressEndpoints } from './server/integration';

const app = express();

// Initialize production readiness system
const system = new ProductionReadinessSystem({
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
});

system.initialize();

// Setup monitoring endpoints
setupExpressEndpoints(app, system);

// Your trading bot routes
app.post('/trade', (req, res) => {
  // Check readiness before trading
  if (!system.canTrade()) {
    return res.status(503).json({ error: 'System not ready for trading' });
  }
  
  // Record trade attempt
  system.recordTradeAttempt();
  
  // ... trading logic ...
});

app.listen(3000, () => {
  system.getLogger().info('Server started on port 3000');
});
```

## Configuration Guide

### Safe Defaults

The system uses conservative defaults prioritizing safety:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `tradingEnabled` | false | Trading disabled by default |
| `paperTrading` | true | Paper trading by default |
| `testnet` | true | Testnet by default |
| `latencyThreshold` | 500ms | Max acceptable latency |
| `maxDrawdown` | 10% | Max drawdown before halt |
| `confidenceThreshold` | 0.7 | Min confidence (70%) |
| `dailyLossLimit` | 5% | Daily loss limit |
| `circuitBreakerEnabled` | true | Circuit breaker enabled |

### Dangerous Values

The system detects and warns about dangerous configurations:

- **LIVE TRADING**: Trading enabled without paper trading
- **HIGH DRAWDOWN**: Max drawdown > 25%
- **LOW CONFIDENCE**: Confidence threshold < 50%
- **LARGE POSITIONS**: Max position size > 50%
- **DISABLED CIRCUIT BREAKER**: No protection from runaway losses
- **LIVE EXCHANGE**: Testnet disabled

### Custom Configuration

```typescript
import { initializeConfig } from './server/config';

// Initialize with custom environment
initializeConfig({
  NODE_ENV: 'production',
  TRADING_ENABLED: 'true',
  PAPER_TRADING: 'false',
  LATENCY_THRESHOLD: '1000',
  MAX_DRAWDOWN: '15',
  DAILY_LOSS_LIMIT: '10',
});
```

## Monitoring Endpoints

### GET /health

Basic alive check with system status.

**Response (200 OK):**
```json
{
  "status": "HEALTHY",
  "timestamp": 1699123456789,
  "uptime": 3600000,
  "version": "1.0.0",
  "environment": "production",
  "checks": [
    {
      "name": "server",
      "status": "HEALTHY",
      "message": "Server is running",
      "lastChecked": 1699123456789,
      "responseTimeMs": 1
    },
    {
      "name": "memory",
      "status": "HEALTHY",
      "message": "Memory usage at 45.2%",
      "lastChecked": 1699123456789,
      "responseTimeMs": 2
    }
  ]
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "UNHEALTHY",
  "timestamp": 1699123456789,
  "uptime": 3600000,
  "version": "1.0.0",
  "environment": "production",
  "checks": [...]
}
```

### GET /ready

Comprehensive readiness check for trading operations.

**Response (200 OK - Ready):**
```json
{
  "status": "READY",
  "timestamp": 1699123456789,
  "checks": {
    "ws": true,
    "risk": true,
    "killSwitch": true,
    "memory": true
  },
  "details": {
    "wsConnected": true,
    "riskState": "NORMAL",
    "killSwitchActive": false,
    "memoryUsagePercent": 45.2
  },
  "message": "System is ready for trading operations"
}
```

**Response (200 OK - Degraded):**
```json
{
  "status": "DEGRADED",
  "timestamp": 1699123456789,
  "checks": {
    "ws": true,
    "risk": true,
    "killSwitch": true,
    "memory": false
  },
  "details": {
    "wsConnected": true,
    "riskState": "NORMAL",
    "killSwitchActive": false,
    "memoryUsagePercent": 85.5
  },
  "message": "System degraded: Memory usage at 85.5%"
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "NOT_READY",
  "timestamp": 1699123456789,
  "checks": {
    "ws": false,
    "risk": false,
    "killSwitch": false,
    "memory": true
  },
  "message": "System not ready: WebSocket disconnected, Risk state is HALTED, Kill switch is active"
}
```

### GET /metrics

Metrics in JSON or Prometheus format.

**JSON Response:**
```json
{
  "timestamp": 1699123456789,
  "metrics": {
    "counters": [
      { "name": "trade_attempt_total", "value": 42 }
    ],
    "gauges": [
      { "name": "risk_state_current", "value": 0 }
    ],
    "histograms": [
      {
        "name": "ws_latency_histogram",
        "percentiles": {
          "p50": 25,
          "p95": 75,
          "p99": 150,
          "count": 1000
        }
      }
    ]
  }
}
```

**Prometheus Response:**
```
# HELP trade_attempt_total Total number of trade attempts
# TYPE trade_attempt_total counter
trade_attempt_total 42 1699123456789

# HELP risk_state_current Current risk state
# TYPE risk_state_current gauge
risk_state_current 0 1699123456789
```

### GET /system/state

Complete integrated system state.

**Response:**
```json
{
  "timestamp": 1699123456789,
  "config": {
    "initialized": true,
    "logLevel": "info",
    "environment": "production"
  },
  "health": {
    "status": "HEALTHY",
    "uptime": 3600000
  },
  "readiness": {
    "status": "READY",
    "canTrade": true
  },
  "telemetry": {
    "counters": {
      "trade_attempt_total": 42,
      "trade_rejected_total": 3
    },
    "gauges": {
      "risk_state_current": 0,
      "analytics_pnl_gauge": 150.75
    }
  }
}
```

## Integration Guide

### Express Integration

```typescript
import express from 'express';
import { ProductionReadinessSystem, setupExpressEndpoints } from './server/integration';

const app = express();
const system = new ProductionReadinessSystem();
system.initialize();

// Setup all endpoints
setupExpressEndpoints(app, system);

// Custom middleware for correlation IDs
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();
  req.correlationId = correlationId;
  next();
});

// Trading endpoint with readiness check
app.post('/api/trade', (req, res) => {
  if (!system.canTrade()) {
    system.recordTradeRejected('System not ready');
    return res.status(503).json({ error: 'System not ready for trading' });
  }
  
  system.recordTradeAttempt();
  
  // ... trading logic ...
  
  system.getLogger().info('Trade executed', { 
    correlationId: req.correlationId,
    symbol: req.body.symbol 
  });
  
  res.json({ success: true });
});
```

### WebSocket Integration

```typescript
import { getDefaultHealthController } from './server/health';
import { metrics } from './server/telemetry';

class WebSocketProvider {
  private connected = false;
  private lastPingTime: number | null = null;
  
  connect() {
    // ... connection logic ...
    this.connected = true;
    
    // Update health controller
    getDefaultHealthController().updateDependencies({
      webSocketProvider: this
    });
  }
  
  onMessage(latencyMs: number) {
    this.lastPingTime = Date.now();
    metrics.recordWsLatency(latencyMs);
  }
  
  isConnected() {
    return this.connected;
  }
  
  getConnectionTime() {
    return Date.now();
  }
  
  getLastPingTime() {
    return this.lastPingTime;
  }
}
```

### Risk Manager Integration

```typescript
import { metrics, RiskState } from './server/telemetry';
import { getDefaultHealthController } from './server/health';
import { recordKillSwitchDecision } from './server/telemetry/DecisionLog';

class RiskManager {
  private state: RiskState = RiskState.NORMAL;
  
  constructor() {
    // Register with health controller
    getDefaultHealthController().updateDependencies({
      riskManager: this
    });
  }
  
  halt(reason: string) {
    this.state = RiskState.HALTED;
    metrics.setRiskState(RiskState.HALTED);
    recordKillSwitchDecision('executed', reason, 1.0);
    
    systemLogger.error('Trading halted', { reason });
  }
  
  getState() {
    return this.state;
  }
  
  isHalted() {
    return this.state === RiskState.HALTED;
  }
}
```

## Troubleshooting

### Configuration Validation Fails

**Problem:** Application crashes on startup with configuration errors.

**Solution:**
1. Check environment variables are set correctly
2. Review error messages for specific field issues
3. Use safe defaults by removing custom values
4. Check for dangerous value warnings

```bash
# Debug configuration
node -e "const { validateEnvVars } = require('./server/config'); console.log(validateEnvVars(process.env));"
```

### Health Check Returns UNHEALTHY

**Problem:** /health endpoint returns 503 status.

**Solution:**
1. Check memory usage - may be above threshold
2. Review dependency status (WebSocket, risk manager)
3. Check for shutdown in progress
4. Review logs for error details

### Readiness Check Returns NOT_READY

**Problem:** /ready endpoint returns 503 status.

**Solution:**
1. Check WebSocket connection status
2. Verify risk state is not HALTED
3. Confirm kill switch is not active
4. Check memory usage is below threshold

### Metrics Not Recording

**Problem:** Metrics endpoint shows no data.

**Solution:**
1. Ensure metrics are being recorded in code
2. Check TradingBotMetrics is initialized
3. Verify metric names match pre-defined constants
4. Review logs for metric recording errors

### Logs Not Appearing

**Problem:** No logs in console or log files.

**Solution:**
1. Check LOG_LEVEL environment variable
2. Verify enableConsole is true in Logger config
3. Check for log sampling (sampleRate < 1.0)
4. Review log throttling settings

## Best Practices

1. **Always use paper trading first** - Verify functionality before live trading
2. **Monitor /ready endpoint** - Don't trade if system is not ready
3. **Set up alerts** - Alert on UNHEALTHY status and critical metrics
4. **Review decision logs** - Regularly audit trading decisions
5. **Use correlation IDs** - Enable distributed tracing across requests
6. **Test graceful shutdown** - Verify proper cleanup on SIGTERM
7. **Keep configuration safe** - Avoid dangerous values in production
