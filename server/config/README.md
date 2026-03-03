# Trading Bot Configuration System

Production-grade configuration validation and safe defaults for the trading bot system.

## Overview

This configuration system provides:

- **Type-safe configuration** with TypeScript interfaces and Zod schemas
- **Fail-fast validation** at boot time with clear error messages
- **Safe defaults** for all configuration values
- **Dangerous value detection** with warnings for risky settings
- **Environment variable mapping** with type conversion
- **Cross-field validation** for complex constraints

## Quick Start

```typescript
import { getConfig, getTradingConfig } from './config';

// Get the complete validated configuration
const config = getConfig();

// Get a specific section
const tradingConfig = getTradingConfig();
console.log(`Latency threshold: ${tradingConfig.latencyThreshold}ms`);
console.log(`Trading enabled: ${tradingConfig.tradingEnabled}`);
```

## File Structure

```
server/config/
├── index.ts           # Main entry point, exports all utilities
├── types.ts           # TypeScript interfaces and types
├── SafeDefaults.ts    # Safe default values and constraints
├── ConfigSchema.ts    # Zod schemas for validation
├── ConfigValidator.ts # Validation logic and boot-time checks
└── .env.example       # Example environment variables
```

## Configuration Sections

### Trading Configuration

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `LATENCY_THRESHOLD` | 500 | 100-5000 | Max acceptable latency (ms) |
| `FLASH_CRASH_THRESHOLD` | 5 | 1-50 | Flash crash detection (%) |
| `MAX_DRAWDOWN` | 10 | 1-100 | Max drawdown before halt (%) |
| `QUORUM_SIZE` | 3 | 1-10 | Minimum consensus size |
| `CONFIDENCE_THRESHOLD` | 0.7 | 0.1-1.0 | Minimum confidence (0-1) |
| `MAX_POSITION_SIZE` | 20 | 1-100 | Max position size (%) |
| `STOP_LOSS_PERCENT` | 2 | 0.1-50 | Stop loss percentage |
| `TAKE_PROFIT_PERCENT` | 5 | 0.1-100 | Take profit percentage |
| `MAX_CONCURRENT_TRADES` | 5 | 1-100 | Max concurrent trades |
| `TRADING_ENABLED` | false | - | Enable trading |
| `PAPER_TRADING` | true | - | Paper trading mode |

### System Configuration

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `MEMORY_THRESHOLD` | 80 | 50-99 | Memory limit (%) |
| `WS_TIMEOUT` | 30000 | 5000-300000 | WebSocket timeout (ms) |
| `HEALTH_CHECK_INTERVAL` | 30000 | 5000-300000 | Health check interval (ms) |
| `GRACEFUL_SHUTDOWN_TIMEOUT` | 10000 | 1000-60000 | Shutdown timeout (ms) |
| `LOG_LEVEL` | info | debug/warn/error | Log level |
| `MAX_LOG_FILE_SIZE` | 100 | 10-1000 | Max log file size (MB) |
| `LOG_FILE_COUNT` | 5 | 1-20 | Number of log files |
| `PORT` | 3000 | 1-65535 | HTTP server port |
| `ENABLE_METRICS` | true | - | Enable metrics endpoint |

### Exchange Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `EXCHANGE_ID` | binance | Exchange identifier |
| `EXCHANGE_API_KEY` | - | API key (required for trading) |
| `EXCHANGE_API_SECRET` | - | API secret (required for trading) |
| `EXCHANGE_TESTNET` | true | Use testnet |
| `EXCHANGE_RATE_LIMIT` | 10 | Rate limit (req/s) |
| `EXCHANGE_ENABLE_RATE_LIMIT` | true | Enable rate limiting |

### Risk Configuration

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `DAILY_LOSS_LIMIT` | 5 | 0.1-100 | Daily loss limit (%) |
| `MAX_TRADES_PER_DAY` | 50 | 1-1000 | Max trades per day |
| `COOLDOWN_AFTER_LOSS` | 60000 | 0-3600000 | Cooldown after loss (ms) |
| `CONFIRM_LARGE_TRADES` | true | - | Confirm large trades |
| `LARGE_TRADE_THRESHOLD` | 10000 | 100-1000000 | Large trade threshold (USD) |
| `CIRCUIT_BREAKER_ENABLED` | true | - | Enable circuit breaker |
| `CIRCUIT_BREAKER_THRESHOLD` | 3 | 1-20 | Consecutive losses threshold |

## Usage

### Basic Usage

```typescript
import { getConfig, getTradingConfig, getSystemConfig } from './config';

// Configuration is auto-initialized on import
const config = getConfig();

// Access specific sections
const trading = getTradingConfig();
const system = getSystemConfig();
```

### Manual Initialization

```typescript
import { initializeConfig } from './config';

// Initialize with custom environment variables
const config = initializeConfig({
  LATENCY_THRESHOLD: '1000',
  TRADING_ENABLED: 'true',
  // ...
});
```

### Validation Only

```typescript
import { validateConfig } from './config';

// Validate without applying
const result = validateConfig({
  trading: {
    latencyThreshold: 1000,
  },
});

if (!result.valid) {
  console.error('Validation errors:', result.errors);
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

### Safe Defaults

```typescript
import { SAFE_DEFAULTS, applySafeDefaults } from './config';

// Access safe defaults
console.log(SAFE_DEFAULTS.latencyThreshold); // 500

// Apply safe defaults to partial config
const config = applySafeDefaults({
  trading: {
    latencyThreshold: 1000, // Override default
  },
});
```

## Safety Features

### Fail-Fast Validation

The configuration is validated immediately on import. Invalid configuration causes the application to crash with clear error messages:

```
❌ Configuration validation failed:
   [REQUIRED_FIELD_MISSING] EXCHANGE_API_KEY: EXCHANGE_API_KEY is required when trading is enabled
   [RANGE_ERROR] trading.latencyThreshold: latencyThreshold must be at least 100, got 50
```

### Dangerous Value Warnings

Potentially dangerous settings trigger warnings:

```
⚠️  CRITICAL: LIVE TRADING ENABLED - Real money is at risk!
⚠️  HIGH RISK: Max drawdown > 25% - excessive risk!
⚠️  WARNING: Circuit breaker disabled - no protection from runaway losses!
```

### Safe Defaults

All configuration values have safe defaults:

- `TRADING_ENABLED: false` - Trading disabled by default
- `PAPER_TRADING: true` - Paper trading by default
- `EXCHANGE_TESTNET: true` - Testnet by default
- `MAX_DRAWDOWN: 10` - Conservative drawdown limit

## Environment Variables

Copy `.env.example` to `.env` and customize:

```bash
cp server/config/.env.example .env
```

Edit `.env` with your values:

```env
NODE_ENV=production
TRADING_ENABLED=true
PAPER_TRADING=false
EXCHANGE_API_KEY=your_api_key
EXCHANGE_API_SECRET=your_api_secret
```

## API Reference

### Functions

#### `getConfig(): ReadonlyConfig`
Returns the validated configuration. Auto-initializes if not already done.

#### `getTradingConfig(): Readonly<TradingConfig>`
Returns the trading configuration section.

#### `getSystemConfig(): Readonly<SystemConfig>`
Returns the system configuration section.

#### `getExchangeConfig(): Readonly<ExchangeConfig>`
Returns the exchange configuration section.

#### `getRiskConfig(): Readonly<RiskConfig>`
Returns the risk configuration section.

#### `initializeConfig(env?): ReadonlyConfig`
Manually initialize the configuration with environment variables.

#### `validateConfig(partialConfig?): ConfigValidationResult`
Validate a partial configuration without applying it.

#### `validateEnvVars(env?): ConfigValidationResult`
Validate environment variables and return a result.

#### `validateNumericRange(name, value, min, max): boolean`
Validate a numeric value is within a range.

#### `applySafeDefaults(partialConfig?): AppConfig`
Apply safe defaults to a partial configuration.

#### `bootValidation(env?): AppConfig`
Perform boot-time validation that fails fast on invalid config.

### Constants

#### `SAFE_DEFAULTS`
Object containing all safe default values.

#### `DEFAULT_APP_CONFIG`
Complete default configuration object.

#### `VALUE_CONSTRAINTS`
Valid ranges for all numeric configuration values.

#### `DANGEROUS_VALUES`
Dangerous value detection rules.

### Schemas

#### `AppConfigSchema`
Zod schema for complete application configuration.

#### `TradingConfigSchema`
Zod schema for trading configuration.

#### `SystemConfigSchema`
Zod schema for system configuration.

#### `ExchangeConfigSchema`
Zod schema for exchange configuration.

#### `RiskConfigSchema`
Zod schema for risk configuration.

## Error Codes

| Code | Description |
|------|-------------|
| `PARSE_ERROR` | Failed to parse environment variable |
| `SCHEMA_VALIDATION_ERROR` | Failed Zod schema validation |
| `RANGE_ERROR` | Value outside valid range |
| `REQUIRED_FIELD_MISSING` | Required field not provided |
| `CROSS_FIELD_ERROR` | Cross-field validation failed |
| `SECTION_VALIDATION_ERROR` | Section validation failed |

## Best Practices

1. **Always use safe defaults** - Don't override defaults unless necessary
2. **Enable paper trading first** - Test thoroughly before live trading
3. **Set conservative limits** - Use lower limits for production
4. **Monitor warnings** - Pay attention to dangerous value warnings
5. **Validate in CI/CD** - Run validation in your deployment pipeline

## License

MIT
