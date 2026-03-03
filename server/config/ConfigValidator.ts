/**
 * Configuration Validator
 * 
 * This file contains comprehensive configuration validation logic.
 * Validates environment variables, numeric ranges, and applies safe defaults.
 * Fails fast on invalid configuration with clear error messages.
 * 
 * CRITICAL: All validation is deterministic - no randomness, no AI/ML.
 * 
 * @module ConfigValidator
 */

import { z } from 'zod';
import type { 
  ConfigValidationResult, 
  ConfigValidationError, 
  AppConfig, 
  PartialConfig 
} from './types';
import { 
  AppConfigSchema, 
  TradingConfigSchema,
  SystemConfigSchema,
  ExchangeConfigSchema,
  RiskConfigSchema,
  ENV_VAR_MAPPING,
  EnvVarSchemas,
} from './ConfigSchema';
import { 
  SAFE_DEFAULTS, 
  DANGEROUS_VALUES, 
  VALUE_CONSTRAINTS,
  DEFAULT_APP_CONFIG,
  mergeWithDefaults,
  createSafeConfig,
} from './SafeDefaults';

// ============================================================================
// Validation State
// ============================================================================

/** Whether the configuration has been validated */
let isValidated = false;

/** Cached validated configuration */
let cachedConfig: AppConfig | null = null;

/** Validation errors from last validation */
let lastValidationErrors: ConfigValidationError[] = [];

/** Warnings from last validation */
let lastValidationWarnings: string[] = [];

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Validates environment variables and returns a validation result
 * This is the main entry point for boot-time validation
 * 
 * @param env - Environment variables object (defaults to process.env)
 * @returns Validation result with errors, warnings, and validated config
 */
export function validateEnvVars(
  env: Record<string, string | undefined> = process.env || {}
): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const warnings: string[] = [];

  // Parse environment variables into partial config
  const partialConfig = parseEnvVars(env, errors);

  // Check for dangerous values
  checkDangerousValues(partialConfig, warnings);

  // Validate required fields
  const requiredErrors = validateRequiredFields(partialConfig, env);
  errors.push(...requiredErrors);

  // If there are parsing errors, return early
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // Merge with safe defaults
  const mergedConfig = mergeWithDefaults(partialConfig);

  // Validate with Zod schema
  const schemaResult = validateWithSchema(mergedConfig);
  
  if (!schemaResult.success) {
    errors.push(...schemaResult.errors);
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // Additional cross-field validation
  const crossFieldErrors = validateCrossFields(schemaResult.config);
  errors.push(...crossFieldErrors);

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // Cache the validated configuration
  cachedConfig = schemaResult.config;
  isValidated = true;
  lastValidationErrors = [];
  lastValidationWarnings = warnings;

  return {
    valid: true,
    errors: [],
    warnings,
    config: schemaResult.config,
  };
}

/**
 * Parse environment variables into a partial configuration
 * @param env - Environment variables
 * @param errors - Array to collect parsing errors
 * @returns Partial configuration
 */
function parseEnvVars(
  env: Record<string, string | undefined>,
  errors: ConfigValidationError[]
): PartialConfig {
  const partial: PartialConfig = {};

  for (const [envVar, mapping] of Object.entries(ENV_VAR_MAPPING)) {
    const value = env[envVar];
    
    if (value === undefined || value === '') {
      continue; // Use default value
    }

    try {
      const parsedValue = parseEnvVarValue(envVar, value, mapping.type, (mapping as { values?: string[] }).values);
      setNestedValue(partial, mapping.path, parsedValue);
    } catch (error) {
      errors.push({
        field: envVar,
        value,
        message: error instanceof Error ? error.message : `Invalid value for ${envVar}`,
        code: 'PARSE_ERROR',
      });
    }
  }

  return partial;
}

/**
 * Parse a single environment variable value
 * @param name - Environment variable name
 * @param value - Raw value
 * @param type - Expected type
 * @param enumValues - Allowed values for enum type
 * @returns Parsed value
 */
function parseEnvVarValue(
  name: string,
  value: string,
  type: string,
  enumValues?: string[]
): unknown {
  switch (type) {
    case 'int':
      return EnvVarSchemas.int(name).parse(value);
    case 'number':
      return EnvVarSchemas.number(name).parse(value);
    case 'boolean':
      return EnvVarSchemas.boolean(name).parse(value);
    case 'string':
      return EnvVarSchemas.string().parse(value);
    case 'enum':
      if (!enumValues) {
        throw new Error(`Enum values not provided for ${name}`);
      }
      return EnvVarSchemas.enum(name, enumValues).parse(value);
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

/**
 * Set a nested value in an object using dot notation
 * @param obj - Object to modify
 * @param path - Dot-notation path
 * @param value - Value to set
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Validate configuration against Zod schema
 * @param config - Configuration to validate
 * @returns Validation result
 */
function validateWithSchema(config: AppConfig): 
  { success: true; config: AppConfig } | { success: false; errors: ConfigValidationError[] } {
  const result = AppConfigSchema.safeParse(config);

  if (result.success) {
    return { success: true, config: result.data };
  }

  const errors: ConfigValidationError[] = result.error.errors.map((err: z.ZodIssue) => ({
    field: err.path.join('.'),
    value: err.path.reduce((obj: unknown, key: string | number) => {
      if (obj && typeof obj === 'object') {
        return (obj as Record<string | number, unknown>)[key];
      }
      return undefined;
    }, config as unknown),
    message: err.message,
    code: 'SCHEMA_VALIDATION_ERROR',
  }));

  return { success: false, errors };
}

// ============================================================================
// Range Validation
// ============================================================================

/**
 * Validates a numeric value is within a specified range
 * 
 * @param name - Field name for error messages
 * @param value - Value to validate
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns True if valid, false otherwise
 */
export function validateNumericRange(
  name: string,
  value: unknown,
  min: number,
  max: number
): boolean {
  // Check if value is a number
  if (typeof value !== 'number' || isNaN(value)) {
    return false;
  }

  return value >= min && value <= max;
}

/**
 * Validates a numeric value and returns detailed result
 * @param name - Field name
 * @param value - Value to validate
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Validation result with error message if invalid
 */
export function validateNumericRangeDetailed(
  name: string,
  value: unknown,
  min: number,
  max: number
): { valid: boolean; error?: string } {
  if (typeof value !== 'number' || isNaN(value)) {
    return { valid: false, error: `${name} must be a valid number` };
  }

  if (value < min) {
    return { valid: false, error: `${name} must be at least ${min}, got ${value}` };
  }

  if (value > max) {
    return { valid: false, error: `${name} must be at most ${max}, got ${value}` };
  }

  return { valid: true };
}

/**
 * Validates all numeric fields in the configuration
 * @param config - Configuration to validate
 * @returns Array of validation errors
 */
export function validateAllNumericRanges(config: AppConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  const numericFields: Array<{ path: string; value: number; constraint: { min: number; max: number } }> = [
    { path: 'trading.latencyThreshold', value: config.trading.latencyThreshold, constraint: VALUE_CONSTRAINTS.latencyThreshold },
    { path: 'trading.flashCrashThreshold', value: config.trading.flashCrashThreshold, constraint: VALUE_CONSTRAINTS.flashCrashThreshold },
    { path: 'trading.maxDrawdown', value: config.trading.maxDrawdown, constraint: VALUE_CONSTRAINTS.maxDrawdown },
    { path: 'trading.quorumSize', value: config.trading.quorumSize, constraint: VALUE_CONSTRAINTS.quorumSize },
    { path: 'trading.confidenceThreshold', value: config.trading.confidenceThreshold, constraint: VALUE_CONSTRAINTS.confidenceThreshold },
    { path: 'trading.maxPositionSize', value: config.trading.maxPositionSize, constraint: VALUE_CONSTRAINTS.maxPositionSize },
    { path: 'trading.stopLossPercent', value: config.trading.stopLossPercent, constraint: VALUE_CONSTRAINTS.stopLossPercent },
    { path: 'trading.takeProfitPercent', value: config.trading.takeProfitPercent, constraint: VALUE_CONSTRAINTS.takeProfitPercent },
    { path: 'trading.maxConcurrentTrades', value: config.trading.maxConcurrentTrades, constraint: VALUE_CONSTRAINTS.maxConcurrentTrades },
    { path: 'system.memoryThreshold', value: config.system.memoryThreshold, constraint: VALUE_CONSTRAINTS.memoryThreshold },
    { path: 'system.wsTimeout', value: config.system.wsTimeout, constraint: VALUE_CONSTRAINTS.wsTimeout },
    { path: 'system.healthCheckInterval', value: config.system.healthCheckInterval, constraint: VALUE_CONSTRAINTS.healthCheckInterval },
    { path: 'system.gracefulShutdownTimeout', value: config.system.gracefulShutdownTimeout, constraint: VALUE_CONSTRAINTS.gracefulShutdownTimeout },
    { path: 'system.maxLogFileSize', value: config.system.maxLogFileSize, constraint: VALUE_CONSTRAINTS.maxLogFileSize },
    { path: 'system.logFileCount', value: config.system.logFileCount, constraint: VALUE_CONSTRAINTS.logFileCount },
    { path: 'system.port', value: config.system.port, constraint: VALUE_CONSTRAINTS.port },
    { path: 'exchange.rateLimit', value: config.exchange.rateLimit, constraint: VALUE_CONSTRAINTS.rateLimit },
    { path: 'risk.dailyLossLimit', value: config.risk.dailyLossLimit, constraint: VALUE_CONSTRAINTS.dailyLossLimit },
    { path: 'risk.maxTradesPerDay', value: config.risk.maxTradesPerDay, constraint: VALUE_CONSTRAINTS.maxTradesPerDay },
    { path: 'risk.cooldownAfterLoss', value: config.risk.cooldownAfterLoss, constraint: VALUE_CONSTRAINTS.cooldownAfterLoss },
    { path: 'risk.largeTradeThreshold', value: config.risk.largeTradeThreshold, constraint: VALUE_CONSTRAINTS.largeTradeThreshold },
    { path: 'risk.circuitBreakerThreshold', value: config.risk.circuitBreakerThreshold, constraint: VALUE_CONSTRAINTS.circuitBreakerThreshold },
  ];

  for (const field of numericFields) {
    const result = validateNumericRangeDetailed(
      field.path,
      field.value,
      field.constraint.min,
      field.constraint.max
    );

    if (!result.valid) {
      errors.push({
        field: field.path,
        value: field.value,
        message: result.error || `${field.path} is out of range`,
        code: 'RANGE_ERROR',
      });
    }
  }

  return errors;
}

// ============================================================================
// Required Fields Validation
// ============================================================================

/**
 * Validates that required fields are present
 * @param partialConfig - Partial configuration
 * @param env - Environment variables
 * @returns Array of validation errors
 */
export function validateRequiredFields(
  partialConfig: PartialConfig,
  env: Record<string, string | undefined>
): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  // Required fields that must be provided via environment variables
  const requiredEnvVars: Array<{ envVar: string; condition?: () => boolean }> = [
    { 
      envVar: 'EXCHANGE_API_KEY', 
      condition: () => partialConfig.trading?.tradingEnabled === true 
    },
    { 
      envVar: 'EXCHANGE_API_SECRET', 
      condition: () => partialConfig.trading?.tradingEnabled === true 
    },
  ];

  for (const { envVar, condition } of requiredEnvVars) {
    if (condition && !condition()) {
      continue;
    }

    const value = env[envVar];
    if (!value || value.trim() === '') {
      errors.push({
        field: envVar,
        value,
        message: `${envVar} is required when trading is enabled`,
        code: 'REQUIRED_FIELD_MISSING',
      });
    }
  }

  return errors;
}

// ============================================================================
// Dangerous Value Detection
// ============================================================================

/**
 * Check for dangerous configuration values and generate warnings
 * @param partialConfig - Partial configuration
 * @param warnings - Array to collect warnings
 */
function checkDangerousValues(partialConfig: PartialConfig, warnings: string[]): void {
  // Check trading dangerous values
  if (partialConfig.trading) {
    const trading = partialConfig.trading;

    if (trading.tradingEnabled === true && trading.paperTrading === false) {
      warnings.push('⚠️  CRITICAL: LIVE TRADING ENABLED - Real money is at risk!');
    }

    if (trading.maxDrawdown !== undefined && trading.maxDrawdown > 25) {
      warnings.push(`⚠️  HIGH RISK: Max drawdown set to ${trading.maxDrawdown}% - excessive risk!`);
    }

    if (trading.confidenceThreshold !== undefined && trading.confidenceThreshold < 0.5) {
      warnings.push(`⚠️  HIGH RISK: Confidence threshold set to ${trading.confidenceThreshold} - may cause over-trading!`);
    }

    if (trading.maxPositionSize !== undefined && trading.maxPositionSize > 50) {
      warnings.push(`⚠️  HIGH RISK: Max position size set to ${trading.maxPositionSize}% - excessive concentration risk!`);
    }
  }

  // Check system dangerous values
  if (partialConfig.system) {
    const system = partialConfig.system;

    if (system.memoryThreshold !== undefined && system.memoryThreshold > 95) {
      warnings.push(`⚠️  WARNING: Memory threshold set to ${system.memoryThreshold}% - risk of OOM crash!`);
    }

    if (system.logLevel === 'debug' && system.nodeEnv === 'production') {
      warnings.push('⚠️  WARNING: Debug logging enabled in production - performance impact!');
    }
  }

  // Check exchange dangerous values
  if (partialConfig.exchange) {
    const exchange = partialConfig.exchange;

    if (exchange.testnet === false) {
      warnings.push('⚠️  CRITICAL: Live exchange mode - real trades will be executed!');
    }
  }

  // Check risk dangerous values
  if (partialConfig.risk) {
    const risk = partialConfig.risk;

    if (risk.circuitBreakerEnabled === false) {
      warnings.push('⚠️  HIGH RISK: Circuit breaker disabled - no protection from runaway losses!');
    }

    if (risk.dailyLossLimit !== undefined && risk.dailyLossLimit > 20) {
      warnings.push(`⚠️  HIGH RISK: Daily loss limit set to ${risk.dailyLossLimit}% - excessive risk!`);
    }
  }
}

// ============================================================================
// Cross-Field Validation
// ============================================================================

/**
 * Validate cross-field constraints
 * @param config - Complete configuration
 * @returns Array of validation errors
 */
function validateCrossFields(config: AppConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  // Validate stop loss < take profit
  if (config.trading.stopLossPercent >= config.trading.takeProfitPercent) {
    errors.push({
      field: 'trading.stopLossPercent',
      value: config.trading.stopLossPercent,
      message: `Stop loss (${config.trading.stopLossPercent}%) must be less than take profit (${config.trading.takeProfitPercent}%)`,
      code: 'CROSS_FIELD_ERROR',
    });
  }

  // Validate health check interval < WebSocket timeout
  if (config.system.healthCheckInterval >= config.system.wsTimeout) {
    errors.push({
      field: 'system.healthCheckInterval',
      value: config.system.healthCheckInterval,
      message: `Health check interval (${config.system.healthCheckInterval}ms) should be less than WebSocket timeout (${config.system.wsTimeout}ms)`,
      code: 'CROSS_FIELD_ERROR',
    });
  }

  // Validate graceful shutdown > health check interval
  if (config.system.gracefulShutdownTimeout <= config.system.healthCheckInterval) {
    errors.push({
      field: 'system.gracefulShutdownTimeout',
      value: config.system.gracefulShutdownTimeout,
      message: `Graceful shutdown timeout (${config.system.gracefulShutdownTimeout}ms) should be greater than health check interval (${config.system.healthCheckInterval}ms)`,
      code: 'CROSS_FIELD_ERROR',
    });
  }

  // Validate trading enabled requires API credentials in production
  if (config.trading.tradingEnabled && 
      config.system.nodeEnv === 'production' && 
      config.exchange.testnet === false) {
    if (!config.exchange.apiKey || !config.exchange.apiSecret) {
      errors.push({
        field: 'exchange.apiKey',
        value: config.exchange.apiKey,
        message: 'API credentials are required when trading is enabled in production with live exchange',
        code: 'CROSS_FIELD_ERROR',
      });
    }
  }

  return errors;
}

// ============================================================================
// Safe Defaults Application
// ============================================================================

/**
 * Apply safe defaults to a partial configuration
 * @param partialConfig - Partial configuration
 * @returns Complete configuration with defaults applied
 */
export function applySafeDefaults(partialConfig: PartialConfig = {}): AppConfig {
  return mergeWithDefaults(partialConfig);
}

/**
 * Create a safe configuration from environment variables with validation
 * Fails fast on invalid configuration
 * 
 * @param env - Environment variables
 * @returns Validated configuration
 * @throws Error if configuration is invalid
 */
export function createValidatedConfig(
  env: Record<string, string | undefined> = process.env || {}
): AppConfig {
  const result = validateEnvVars(env);

  if (!result.valid) {
    const errorMessages = result.errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(
      `Configuration validation failed:\n${errorMessages}\n\n` +
      `Please check your environment variables and try again.`
    );
  }

  // Log warnings if any
  if (result.warnings.length > 0) {
    console.warn('Configuration warnings:');
    result.warnings.forEach(w => console.warn(`  ${w}`));
  }

  return result.config!;
}

// ============================================================================
// Boot-Time Validation
// ============================================================================

/**
 * Performs boot-time validation that fails fast on invalid config
 * This should be called at application startup
 * 
 * @param env - Environment variables
 * @returns Validated configuration
 * @throws Error if configuration is invalid
 */
export function bootValidation(
  env: Record<string, string | undefined> = process.env || {}
): AppConfig {
  console.log('🔧 Validating configuration...');

  const result = validateEnvVars(env);

  if (!result.valid) {
    console.error('❌ Configuration validation failed:');
    result.errors.forEach(e => {
      console.error(`   [${e.code}] ${e.field}: ${e.message}`);
    });
    
    throw new Error(
      `Configuration validation failed with ${result.errors.length} error(s). ` +
      `See logs above for details.`
    );
  }

  console.log('✅ Configuration validated successfully');

  if (result.warnings.length > 0) {
    console.warn('⚠️  Configuration warnings:');
    result.warnings.forEach(w => console.warn(`   ${w}`));
  }

  // Log configuration summary (excluding sensitive data)
  const config = result.config!;
  console.log('📋 Configuration summary:');
  console.log(`   Trading enabled: ${config.trading.tradingEnabled}`);
  console.log(`   Paper trading: ${config.trading.paperTrading}`);
  console.log(`   Exchange testnet: ${config.exchange.testnet}`);
  console.log(`   Environment: ${config.system.nodeEnv}`);
  console.log(`   Log level: ${config.system.logLevel}`);

  return config;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if configuration has been validated
 * @returns True if validated
 */
export function isConfigValidated(): boolean {
  return isValidated;
}

/**
 * Get the cached validated configuration
 * @returns Validated configuration or null if not validated
 */
export function getCachedConfig(): AppConfig | null {
  return cachedConfig;
}

/**
 * Get last validation errors
 * @returns Array of validation errors
 */
export function getLastValidationErrors(): ConfigValidationError[] {
  return [...lastValidationErrors];
}

/**
 * Get last validation warnings
 * @returns Array of validation warnings
 */
export function getLastValidationWarnings(): string[] {
  return [...lastValidationWarnings];
}

/**
 * Reset validation state (useful for testing)
 */
export function resetValidationState(): void {
  isValidated = false;
  cachedConfig = null;
  lastValidationErrors = [];
  lastValidationWarnings = [];
}

/**
 * Validate a specific configuration section
 * @param section - Section name
 * @param config - Section configuration
 * @returns Validation result
 */
export function validateSection<T extends 'trading' | 'system' | 'exchange' | 'risk'>(
  section: T,
  config: unknown
): { valid: boolean; errors: ConfigValidationError[] } {
  let schema: z.ZodSchema;

  switch (section) {
    case 'trading':
      schema = TradingConfigSchema;
      break;
    case 'system':
      schema = SystemConfigSchema;
      break;
    case 'exchange':
      schema = ExchangeConfigSchema;
      break;
    case 'risk':
      schema = RiskConfigSchema;
      break;
    default:
      return { valid: false, errors: [{ field: section, value: section, message: 'Unknown section' }] };
  }

  const result = schema.safeParse(config);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors: ConfigValidationError[] = result.error.errors.map((err: z.ZodIssue) => ({
    field: err.path.join('.'),
    value: err.path.reduce((obj: unknown, key: string | number) => {
      if (obj && typeof obj === 'object') {
        return (obj as Record<string | number, unknown>)[key];
      }
      return undefined;
    }, config),
    message: err.message,
    code: 'SECTION_VALIDATION_ERROR',
  }));

  return { valid: false, errors };
}
