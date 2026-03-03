export {
  SignalSide,
  ConfidenceLevel,
  BaseStrategy,
  type Strategy,
  type StrategyContext,
  type StrategySignal,
} from './StrategyInterface';

export { StrategyRegistry } from './StrategyRegistry';

export {
  StrategyContextBuilder,
  DEFAULT_CONTEXT_BUILDER_CONFIG,
  createContextBuilder,
  resolveRiskMultiplier,
  type ContextBuilderConfig,
  type ContextBuilderInput,
} from './StrategyContextBuilder';

export {
  SignalLifecycleManager,
  DEFAULT_LIFECYCLE_CONFIG,
  createSignalLifecycleManager,
  type SignalLifecycleConfig,
  type LifecycleStatistics,
} from './SignalLifecycleManager';

export { ExampleTrendFollowStrategy } from './examples/ExampleTrendFollow';
export { ExampleMeanRevertStrategy } from './examples/ExampleMeanRevert';
export { ExampleChopFilterStrategy } from './examples/ExampleChopFilter';
