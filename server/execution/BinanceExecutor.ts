import { ExecutionConnector } from '../connectors/ExecutionConnector';
import { OrderType, TimeInForce } from '../connectors/executionTypes';
import { decimalToNumber, parseDecimal } from '../utils/decimal';
import { ExecutionDecision, ExecutionResult, IExecutor } from './types';

function mapOrderType(input?: OrderType): OrderType {
    if (!input) return 'MARKET';
    if (input === 'STOP_LOSS') return 'STOP_MARKET';
    if (input === 'TAKE_PROFIT') return 'TAKE_PROFIT_MARKET';
    return input;
}

function normalizeTimeInForce(input?: TimeInForce): TimeInForce | undefined {
    return input;
}

export class BinanceExecutor implements IExecutor {
    private connector: ExecutionConnector;

    constructor(connector: ExecutionConnector) {
        this.connector = connector;
    }

    public async execute(decision: ExecutionDecision): Promise<ExecutionResult> {
        if (!this.connector.isExecutionEnabled()) {
            return { ok: false, error: 'EXECUTION_DISABLED' };
        }

        try {
            const quantityFp = parseDecimal(decision.quantity);
            const quantity = decimalToNumber(quantityFp);
            const orderType = mapOrderType(decision.type);
            const price = decision.price ? decimalToNumber(parseDecimal(decision.price)) : undefined;
            const stopPrice = decision.stopPrice ? decimalToNumber(parseDecimal(decision.stopPrice)) : undefined;
            const res = await (this.connector as any).placeOrder({
                symbol: decision.symbol,
                side: decision.side,
                type: orderType || 'MARKET',
                quantity,
                price: orderType === 'LIMIT' ? price : undefined,
                stopPrice,
                timeInForce: normalizeTimeInForce(decision.timeInForce),
                reduceOnly: decision.reduceOnly ? true : undefined,
                clientOrderId: decision.clientOrderId || `bot_${Date.now()}`
            });
            return {
                ok: true,
                orderId: res.orderId,
                executedQuantity: decision.quantity,
                executedPrice: decision.price,
                requestedPrice: decision.price,
                filledPrice: decision.price,
            };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }
}
