import { OrchestratorMetricsInput, SymbolState } from './types';
import { LiquidationRiskCalculator, LiquidationRiskConfig } from './LiquidationRiskCalculator';

export interface LiquidationGuardConfig {
  emergencyMarginRatio: number;
  riskConfig?: Partial<LiquidationRiskConfig>;
  onAlert?: (message: string) => void;
}

export function liquidationRiskTriggered(
  state: SymbolState,
  config: LiquidationGuardConfig,
  metrics?: OrchestratorMetricsInput
): boolean {
  const calc = new LiquidationRiskCalculator({
    emergencyMarginRatio: config.emergencyMarginRatio,
    ...(config.riskConfig || {}),
  });
  const status = calc.calculate(state, metrics);
  state.liquidationRiskStatus = status;

  if (status.score === 'CRITICAL') {
    config.onAlert?.(`Liquidation risk CRITICAL for ${state.symbol} (marginRatio=${state.marginRatio ?? 'n/a'})`);
  } else if (status.score === 'RED') {
    config.onAlert?.(`Liquidation risk RED for ${state.symbol} (marginRatio=${state.marginRatio ?? 'n/a'})`);
  }

  return status.score === 'CRITICAL' || status.score === 'RED';
}
