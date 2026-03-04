/**
 * API Module - Centralized exports for all API-related functionality
 */

// Export all types
export * from './types';

// Export client and API helpers
export {
  // Main API client
  apiClient,
  
  // HTTP methods
  get,
  post,
  put,
  del,
  
  // API modules
  healthApi,
  riskApi,
  dryRunApi,
  executionApi,
  analyticsApi,
  backtestApi,
  abTestApi,
  portfolioApi,
  latencyApi,
  exchangeApi,
  backfillApi,
  
  // WebSocket
  createWebSocketClient,
  
  // Error handling
  getErrorMessage,
  getErrorStatus,
  isNetworkError,
  isServerError,
  isClientError,
  
  // Type exports
  type RequestOptions,
  type WebSocketClientOptions,
} from './client';
