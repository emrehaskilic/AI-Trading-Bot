import { MarketImpactSimulator } from '../dryrun/MarketImpactSimulator';
import { decimalToNumber, parseDecimal } from '../utils/decimal';
import { ExecutionDecision, ExecutionResult, IExecutor } from './types';

type DryRunSubmit = (decision: ExecutionDecision) => Promise<ExecutionResult>;

export class DryRunExecutor implements IExecutor {
  constructor(
    private readonly submit: DryRunSubmit,
    private readonly marketImpactSimulator?: MarketImpactSimulator
  ) {}

  async execute(decision: ExecutionDecision): Promise<ExecutionResult> {
    if (!this.marketImpactSimulator) {
      const result = await this.submit(decision);
      if (result.ok) {
        return {
          ...result,
          requestedPrice: result.requestedPrice ?? decision.price,
          filledPrice: result.filledPrice ?? result.executedPrice ?? decision.price,
        };
      }
      return result;
    }
    const price = decision.price ? decimalToNumber(parseDecimal(decision.price)) : 0;
    const qty = decimalToNumber(parseDecimal(decision.quantity));
    const simulatedPrice = this.marketImpactSimulator.simulateImpact(decision.side, qty, price);
    const nextDecision: ExecutionDecision = {
      ...decision,
      price: Number.isFinite(simulatedPrice) ? simulatedPrice.toFixed(8) : decision.price,
    };
    const result = await this.submit(nextDecision);
    if (result.ok) {
      return {
        ...result,
        requestedPrice: result.requestedPrice ?? decision.price,
        filledPrice: result.filledPrice ?? result.executedPrice ?? nextDecision.price,
      };
    }
    return result;
  }
}
