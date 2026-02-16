// Backward-compatible exports. Strategy override policy has been replaced
// by deterministic safety guardrails for autonomous AI mode.
export { SafetyGuardrails as AutonomousMetricsPolicy } from './SafetyGuardrails';
export type { SafetyGuardrailResult as AutonomousPolicyDecision } from './SafetyGuardrails';
