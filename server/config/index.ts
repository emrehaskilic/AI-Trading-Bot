/**
 * Configuration Module Index
 * 
 * This is the main entry point for the configuration system.
 * It exports all configuration utilities and initializes the configuration
 * on import for fail-fast validation.
 * 
 * CRITICAL: All configuration is deterministic - no randomness, no AI/ML.
 * 
 * @module Config
 * @example
 * ```typescript
 * import { getConfig, validateConfig } from './config';
 * 
 * // Get the validated configuration
 * const config = getConfig();
 * 
 * // Validate custom configuration
 * const result = validateConfig({ trading: { latencyThreshold: 1000 } });
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Configuration interfaces
  TradingConfig,
  SystemConfig,
  ExchangeConfig,
  RiskConfig,
  AppConfig,
  ReadonlyConfig,
  PartialConfig,
  SafeDefaultsType,
  
  // Validation interfaces
  ConfigValidationError,
  ConfigValidationResult,
  ValidationRule,
  
  // Environment variable interfaces
  EnvVarMapping,
} from './types';

// ============================================================================
// Schema Exports
// ============================================================================

export {
  // Zod schemas
  TradingConfigSchema,
  SystemConfigSchema,
  ExchangeConfigSchema,
  RiskConfigSchema,
  AppConfigSchema,
  Schemas,
  
  // Environment variable mapping
  ENV_VAR_MAPPING,
  
  // Environment variable parsing schemas
  EnvVarSchemas,
  
  // Inferred types from schemas
  type TradingConfig as TradingConfigSchemaType,
  type SystemConfig as SystemConfigSchemaType,
  type ExchangeConfig as ExchangeConfigSchemaType,
  type RiskConfig as RiskConfigSchemaType,
  type AppConfig as AppConfigSchemaType,
} from './ConfigSchema';

// ============================================================================
// Safe Defaults Exports
// ============================================================================

export {
  // Safe default values
  SAFE_DEFAULTS,
  
  // Default configuration objects
  DEFAULT_TRADING_CONFIG,
  DEFAULT_SYSTEM_CONFIG,
  DEFAULT_EXCHANGE_CONFIG,
  DEFAULT_RISK_CONFIG,
  DEFAULT_APP_CONFIG,
  
  // Dangerous value detection
  DANGEROUS_VALUES,
  
  // Value constraints
  VALUE_CONSTRAINTS,
  
  // Helper functions
  getSafeDefault,
  isWithinConstraints,
  clampToConstraints,
  mergeWithDefaults,
  createSafeConfig,
} from './SafeDefaults';

// ============================================================================
// Validator Exports
// ============================================================================

export {
  // Main validation functions
  validateEnvVars,
  validateNumericRange,
  validateNumericRangeDetailed,
  validateAllNumericRanges,
  validateRequiredFields,
  validateSection,
  
  // Safe defaults application
  applySafeDefaults,
  createValidatedConfig,
  
  // Boot-time validation
  bootValidation,
  
  // Utility functions
  isConfigValidated,
  getCachedConfig,
  getLastValidationErrors,
  getLastValidationWarnings,
  resetValidationState,
} from './ConfigValidator';

// ============================================================================
// Configuration Initialization
// ============================================================================

import { bootValidation, getCachedConfig } from './ConfigValidator';
import type { AppConfig, ReadonlyConfig } from './types';

/** Private configuration instance */
let configInstance: ReadonlyConfig | null = null;

/** Whether initialization has been attempted */
let initializationAttempted = false;

/** Initialization error if any */
let initializationError: Error | null = null;

/**
 * Initialize the configuration system
 * This function validates environment variables and creates the configuration
 * 
 * @param env - Optional environment variables object
 * @returns Validated configuration
 * @throws Error if configuration is invalid
 */
export function initializeConfig(
  env: Record<string, string | undefined> = process.env || {}
): ReadonlyConfig {
  initializationAttempted = true;
  
  try {
    const config = bootValidation(env);
    configInstance = Object.freeze({ ...config }) as ReadonlyConfig;
    initializationError = null;
    return configInstance;
  } catch (error) {
    initializationError = error instanceof Error ? error : new Error(String(error));
    throw initializationError;
  }
}

/**
 * Get the validated configuration
 * 
 * @returns The validated configuration
 * @throws Error if configuration has not been initialized
 */
export function getConfig(): ReadonlyConfig {
  if (configInstance === null) {
    // Auto-initialize if not already done
    if (!initializationAttempted) {
      return initializeConfig();
    }
    throw new Error(
      'Configuration has not been initialized. ' +
      'Call initializeConfig() first or import this module to auto-initialize.'
    );
  }
  return configInstance;
}

/**
 * Get a specific section of the configuration
 * 
 * @param section - Configuration section name
 * @returns The configuration section
 * @throws Error if configuration has not been initialized
 */
export function getConfigSection<T extends keyof AppConfig>(
  section: T
): Readonly<AppConfig[T]> {
  const config = getConfig();
  return config[section];
}

/**
 * Get trading configuration
 * @returns Trading configuration
 */
export function getTradingConfig(): Readonly<AppConfig['trading']> {
  return getConfigSection('trading');
}

/**
 * Get system configuration
 * @returns System configuration
 */
export function getSystemConfig(): Readonly<AppConfig['system']> {
  return getConfigSection('system');
}

/**
 * Get exchange configuration
 * @returns Exchange configuration
 */
export function getExchangeConfig(): Readonly<AppConfig['exchange']> {
  return getConfigSection('exchange');
}

/**
 * Get risk configuration
 * @returns Risk configuration
 */
export function getRiskConfig(): Readonly<AppConfig['risk']> {
  return getConfigSection('risk');
}

/**
 * Check if configuration has been initialized
 * @returns True if initialized
 */
export function isInitialized(): boolean {
  return configInstance !== null;
}

/**
 * Get initialization error if any
 * @returns Initialization error or null
 */
export function getInitializationError(): Error | null {
  return initializationError;
}

/**
 * Reset the configuration (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
  initializationAttempted = false;
  initializationError = null;
  
  // Also reset validator state
  const { resetValidationState } = require('./ConfigValidator');
  resetValidationState();
}

// ============================================================================
// Validation Wrapper
// ============================================================================

import type { ConfigValidationResult, PartialConfig } from './types';
import { validateEnvVars, applySafeDefaults } from './ConfigValidator';

/**
 * Validate a partial configuration without applying it
 * 
 * @param partialConfig - Partial configuration to validate
 * @returns Validation result
 */
export function validateConfig(partialConfig: PartialConfig = {}): ConfigValidationResult {
  const mergedConfig = applySafeDefaults(partialConfig);
  
  // Convert to environment variable format for validation
  const env: Record<string, string> = {};
  
  // Helper to flatten config to env vars
  const flattenConfig = (obj: Record<string, unknown>, prefix = ''): void => {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        flattenConfig(value as Record<string, unknown>, fullKey);
      } else {
        env[fullKey] = String(value);
      }
    }
  };
  
  flattenConfig(mergedConfig as unknown as Record<string, unknown>);
  
  return validateEnvVars(env);
}

// ============================================================================
// Auto-initialization (fail-fast on import)
// ============================================================================

/**
 * Auto-initialize configuration on module import
 * This ensures fail-fast behavior - the application will crash immediately
 * if the configuration is invalid, rather than failing later at runtime.
 */
function autoInitialize(): void {
  try {
    // Only auto-initialize if process.env is available (Node.js environment)
    if (typeof process !== 'undefined' && process.env) {
      initializeConfig(process.env);
    }
  } catch (error) {
    // In production, we want to fail fast
    // In development/test, we might want to allow the module to load
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    if (nodeEnv === 'production') {
      console.error('❌ Fatal: Configuration validation failed in production');
      throw error;
    } else {
      console.warn('⚠️  Configuration validation failed (non-production mode):');
      console.warn(error instanceof Error ? error.message : String(error));
      console.warn('The application may not function correctly.');
    }
  }
}

// Attempt auto-initialization
autoInitialize();

// ============================================================================
// Module Export Summary
// ============================================================================

/**
 * Configuration module summary:
 * 
 * EXPORTS:
 * - Types: TradingConfig, SystemConfig, ExchangeConfig, RiskConfig, AppConfig, etc.
 * - Schemas: TradingConfigSchema, SystemConfigSchema, etc.
 * - Defaults: SAFE_DEFAULTS, DEFAULT_APP_CONFIG, etc.
 * - Validators: validateEnvVars, validateNumericRange, bootValidation, etc.
 * - Functions: getConfig, getTradingConfig, initializeConfig, etc.
 * 
 * USAGE:
 * ```typescript
 * import { getConfig, getTradingConfig } from './config';
 * 
 * const config = getConfig();
 * const tradingConfig = getTradingConfig();
 * ```
 * 
 * AUTO-INITIALIZATION:
 * The configuration is automatically validated when the module is imported.
 * This ensures fail-fast behavior - invalid config crashes immediately.
 * 
 * SAFETY FEATURES:
 * - All numeric values have defined constraints
 * - Dangerous values trigger warnings
 * - Safe defaults are applied for missing values
 * - Configuration is immutable after initialization
 */
