# Health & Readiness System

Production-grade health monitoring and readiness checking for the trading bot system.

## Features

- **Health Endpoint** (`/health`): Basic alive check with system status
- **Readiness Endpoint** (`/ready`): Comprehensive trading readiness verification
- **Graceful Shutdown**: SIGTERM/SIGINT handling with connection draining
- **Dependency Tracking**: Monitor WebSocket, Risk Manager, and Kill Switch
- **Fast Response**: All checks complete in < 100ms
- **Deterministic**: No randomness, predictable behavior

## Quick Start

```typescript
import { HealthController } from './health';

// Create controller with dependencies
const healthController = new HealthController('1.0.0', 'production', {
  webSocketProvider: wsProvider,
  riskManager: riskManager,
  killSwitch: killSwitch,
});

// Initialize graceful shutdown
healthController.initializeGracefulShutdown();

// Express routes
app.get('/health', (req, res) => {
  const result = healthController.getHealth();
  res.status(result.status).json(result.body);
});

app.get('/ready', (req, res) => {
  const result = healthController.getReady();
  res.status(result.status).json(result.body);
});
```

## Endpoints

### GET /health

Basic alive check returning system health status.

**Response (200 OK):**
```json
{
  "status": "HEALTHY",
  "timestamp": 1704067200000,
  "uptime": 3600000,
  "version": "1.0.0",
  "environment": "production",
  "checks": [
    {
      "name": "server",
      "status": "HEALTHY",
      "message": "Server is running",
      "lastChecked": 1704067200000,
      "responseTimeMs": 0
    },
    {
      "name": "memory",
      "status": "HEALTHY",
      "message": "Memory usage at 45.2% (Heap: 128 MB/256 MB, RSS: 512 MB)",
      "lastChecked": 1704067200000,
      "responseTimeMs": 1
    }
  ]
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "UNHEALTHY",
  "timestamp": 1704067200000,
  "uptime": 3600000,
  "version": "1.0.0",
  "checks": [...]
}
```

### GET /ready

Trading readiness check with comprehensive verification.

**Response (200 OK - Ready):**
```json
{
  "status": "READY",
  "timestamp": 1704067200000,
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
  "timestamp": 1704067200000,
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
  "timestamp": 1704067200000,
  "checks": {
    "ws": false,
    "risk": false,
    "killSwitch": false,
    "memory": false
  },
  "message": "System not ready: WebSocket disconnected, Risk state is HALTED, Kill switch is active"
}
```

## Readiness Checks

The `/ready` endpoint performs the following checks:

| Check | Description | Threshold |
|-------|-------------|-----------|
| `ws` | WebSocket connection active | Must be connected |
| `risk` | Risk state acceptable | Must NOT be HALTED |
| `killSwitch` | Kill switch inactive | Must NOT be active |
| `memory` | Memory usage acceptable | Below 80% (configurable) |

## Graceful Shutdown

The system handles the following shutdown signals:

- **SIGTERM**: Docker/Kubernetes shutdown
- **SIGINT**: Ctrl+C / Manual interrupt
- **uncaughtException**: Unhandled errors
- **unhandledRejection**: Unhandled promise rejections

### Shutdown Process

1. Set shutdown state (prevents new requests)
2. Stop automatic health checks
3. Execute registered shutdown handlers
4. Drain active connections (configurable timeout)
5. Exit with appropriate code

### Registering Shutdown Handlers

```typescript
healthController.onShutdown(async () => {
  // Close database connections
  await db.close();
});

healthController.onShutdown(() => {
  // Close WebSocket connection
  ws.close();
});
```

## Configuration

### Health Check Config

```typescript
const healthConfig = {
  memoryThresholdPercent: 80,    // Memory threshold (0-100)
  maxCheckResponseTimeMs: 100,   // Max check time
  checkIntervalMs: 30000,        // Auto-check interval
  autoCheckEnabled: true,        // Enable auto-checks
};

const controller = new HealthController('1.0.0', 'production', deps, healthConfig);
```

### Readiness Check Config

```typescript
const readinessConfig = {
  memoryThresholdPercent: 80,  // Memory threshold
  requireWebSocket: true,      // Require WS for ready
  checkKillSwitch: true,       // Check kill switch
  checkRiskState: true,        // Check risk state
};

const checker = new ReadinessChecker(deps, readinessConfig);
```

### Shutdown Config

```typescript
const shutdownConfig = {
  gracefulTimeoutMs: 30000,   // Graceful shutdown timeout
  forcefulTimeoutMs: 5000,    // Forceful shutdown timeout
  drainConnections: true,     // Drain connections
  successExitCode: 0,         // Success exit code
  errorExitCode: 1,           // Error exit code
};

const controller = new HealthController('1.0.0', 'production', deps, {}, shutdownConfig);
```

## API Reference

### HealthController

#### Constructor

```typescript
new HealthController(
  version?: string,              // App version (default: '1.0.0')
  environment?: string,          // Environment (default: 'development')
  dependencies?: HealthDependencies,  // Dependencies
  healthConfig?: Partial<HealthCheckConfig>,  // Health config
  shutdownConfig?: Partial<ShutdownConfig>    // Shutdown config
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `getHealth()` | Get health report with status code |
| `getReady()` | Get readiness report with status code |
| `initializeGracefulShutdown()` | Setup shutdown handlers |
| `onShutdown(handler)` | Register shutdown handler |
| `shutdown(reason)` | Trigger manual shutdown |
| `getUptime()` | Get system uptime in ms |
| `isShuttingDown()` | Check if shutdown in progress |
| `updateDependencies(deps)` | Update dependencies |

### ReadinessChecker

#### Methods

| Method | Description |
|--------|-------------|
| `checkWebSocket()` | Check WS connection |
| `checkRiskState()` | Check risk state |
| `checkKillSwitch()` | Check kill switch |
| `checkMemory()` | Check memory usage |
| `getReadinessReport()` | Get full readiness report |
| `isReady()` | Quick ready check |
| `canTrade()` | Check if trading allowed |
| `getFailedChecks()` | Get list of failed checks |

## File Structure

```
server/health/
├── types.ts           # Type definitions
├── ReadinessChecker.ts # Readiness check implementation
├── HealthController.ts # Health controller with endpoints
├── index.ts           # Module exports
└── README.md          # Documentation
```

## License

MIT
